import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Availability, BaseLevel, Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { actorLabel, type AuthContext } from '../auth/auth.types';
import { isManagerRole, type Permission } from '../auth/permissions';
import { DomainEvents } from '../common/domain-events';
import { randomToken } from '../common/encryption';
import { DomainError } from '../common/http-exception.filter';
import { PrismaService } from '../common/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

const USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  baseLevel: true,
  roleId: true,
  role: { select: { id: true, name: true, permissions: true } },
  availability: true,
  maxOpenLeads: true,
  backupUserId: true,
  timeZone: true,
  isActive: true,
  telegramChatId: true,
  lastAssignedAt: true,
  version: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export type WorkspaceSettingsInput = Partial<{
  name: string;
  currency: string;
  timeZone: string;
  ackWindowSec: number;
  escalationLevels: number;
  levelWindowSec: number;
  idleSec: number;
  maxOpenLeadsDefault: number;
  acknowledgedLeadsOnAbsence: 'KEEP' | 'REASSIGN';
}>;

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly authService: AuthService,
    private readonly events: DomainEvents,
    private readonly realtime: RealtimeGateway,
  ) {}

  // ── Workspace & settings ──

  async get(workspaceId: string) {
    return this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  }

  async updateSettings(auth: AuthContext, input: WorkspaceSettingsInput) {
    const before = await this.get(auth.workspaceId);
    const after = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.workspace.update({ where: { id: auth.workspaceId }, data: input });
      await this.audit.recordTx(tx, {
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        actorLabel: actorLabel(auth),
        action: 'workspace.settings_updated',
        targetType: 'workspace',
        targetId: auth.workspaceId,
        before: pick(before, Object.keys(input)),
        after: pick(updated, Object.keys(input)),
      });
      return updated;
    });
    return after;
  }

  // ── Users ──

  async listUsers(workspaceId: string, includeInactive = false) {
    const users = await this.prisma.user.findMany({
      where: { workspaceId, ...(includeInactive ? {} : { isActive: true }) },
      select: USER_SELECT,
      orderBy: [{ baseLevel: 'asc' }, { firstName: 'asc' }],
    });
    return users.map((user) => this.decorate(user));
  }

  async getUser(workspaceId: string, userId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, workspaceId }, select: USER_SELECT });
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found.' });
    return this.decorate(user);
  }

  /** Owner/Admin invite a user. Returns a temporary password once; the user changes it after first login. */
  async inviteUser(auth: AuthContext, input: { email: string; firstName: string; lastName: string; baseLevel?: BaseLevel; roleId?: string | null; timeZone?: string }) {
    this.assertCanAssignLevel(auth, input.baseLevel ?? 'USER');
    const email = input.email.toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new ConflictException({ code: 'EMAIL_TAKEN', message: 'A user with this email already exists.' });
    }
    if (input.roleId) await this.assertRoleInWorkspace(auth.workspaceId, input.roleId);
    const temporaryPassword = `Tmp-${randomToken(6)}`;
    const passwordHash = await this.authService.hashPassword(temporaryPassword);

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          workspaceId: auth.workspaceId,
          email,
          passwordHash,
          firstName: input.firstName,
          lastName: input.lastName,
          baseLevel: input.baseLevel ?? 'USER',
          roleId: input.roleId ?? null,
          timeZone: input.timeZone ?? 'UTC',
          availability: 'OFFLINE',
        },
        select: USER_SELECT,
      });
      await this.audit.recordTx(tx, {
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        actorLabel: actorLabel(auth),
        action: 'user.invited',
        targetType: 'user',
        targetId: created.id,
        after: { email, baseLevel: created.baseLevel, roleId: created.roleId },
      });
      return created;
    });
    return { user: this.decorate(user), temporaryPassword };
  }

  async updateUser(
    auth: AuthContext,
    userId: string,
    input: Partial<{ firstName: string; lastName: string; baseLevel: BaseLevel; roleId: string | null; maxOpenLeads: number | null; backupUserId: string | null; timeZone: string; version: number }>,
  ) {
    const target = await this.getUser(auth.workspaceId, userId);
    const isSelf = auth.userId === userId;
    const changesPrivileges = input.baseLevel !== undefined || input.roleId !== undefined || input.maxOpenLeads !== undefined || input.backupUserId !== undefined;

    // F1.2: an Admin cannot modify the Owner; only the Owner can change base levels.
    if (target.baseLevel === 'OWNER' && !isSelf) throw new ForbiddenException({ code: 'OWNER_PROTECTED', message: 'The Owner can only be modified by themselves.' });
    if (input.baseLevel !== undefined) this.assertCanAssignLevel(auth, input.baseLevel);
    if (changesPrivileges && !isSelf && !this.can(auth, 'users.manage')) {
      throw new ForbiddenException({ code: 'PERMISSION_DENIED', message: 'You need users.manage to change roles, levels or limits.' });
    }
    if (changesPrivileges && isSelf && auth.baseLevel === 'USER') {
      throw new ForbiddenException({ code: 'PERMISSION_DENIED', message: 'You cannot change your own role or limits.' });
    }
    if (!isSelf && !changesPrivileges && !this.can(auth, 'users.manage')) {
      throw new ForbiddenException({ code: 'PERMISSION_DENIED', message: 'You can only edit your own profile.' });
    }
    if (input.roleId) await this.assertRoleInWorkspace(auth.workspaceId, input.roleId);
    if (input.backupUserId) await this.getUser(auth.workspaceId, input.backupUserId);

    const { version, ...data } = input;
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.user.updateMany({
        where: { id: userId, workspaceId: auth.workspaceId, ...(version ? { version } : {}) },
        data: { ...data, version: { increment: 1 } },
      });
      if (result.count === 0) throw new DomainError('VERSION_CONFLICT', 'This user was changed by someone else. Reload and try again.', 409);
      const after = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: USER_SELECT });
      if (changesPrivileges) {
        await this.audit.recordTx(tx, {
          workspaceId: auth.workspaceId,
          actorId: auth.userId,
          actorLabel: actorLabel(auth),
          action: 'user.privileges_updated',
          targetType: 'user',
          targetId: userId,
          before: { baseLevel: target.baseLevel, roleId: target.roleId, maxOpenLeads: target.maxOpenLeads, backupUserId: target.backupUserId },
          after: { baseLevel: after.baseLevel, roleId: after.roleId, maxOpenLeads: after.maxOpenLeads, backupUserId: after.backupUserId },
        });
      }
      return after;
    });
    return this.decorate(updated);
  }

  /** F3.2 / F3.6: status change by the user or an Admin; the lead engine reacts through the event bus. */
  async setAvailability(auth: AuthContext, userId: string, availability: Availability) {
    const isSelf = auth.userId === userId;
    if (!isSelf && !this.can(auth, 'users.manage')) {
      throw new ForbiddenException({ code: 'PERMISSION_DENIED', message: 'You need users.manage to change another user’s availability.' });
    }
    const target = await this.getUser(auth.workspaceId, userId);
    if (target.availability === availability) return target;
    const updated = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({ where: { id: userId }, data: { availability }, select: USER_SELECT });
      await this.audit.recordTx(tx, {
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        actorLabel: actorLabel(auth),
        action: 'user.availability_changed',
        targetType: 'user',
        targetId: userId,
        before: { availability: target.availability },
        after: { availability },
      });
      return user;
    });
    this.realtime.toWorkspace(auth.workspaceId, 'availability:changed', { userId, availability });
    this.events.emit('user.availability_changed', { workspaceId: auth.workspaceId, userId, from: target.availability, to: availability, actorId: auth.userId });
    return this.decorate(updated);
  }

  /** Deactivation instead of deletion keeps history consistent (Q4); pending leads are reassigned by the lead engine. */
  async deactivateUser(auth: AuthContext, userId: string) {
    const target = await this.getUser(auth.workspaceId, userId);
    if (target.baseLevel === 'OWNER') throw new ForbiddenException({ code: 'OWNER_PROTECTED', message: 'The Owner cannot be deactivated.' });
    if (auth.userId === userId) throw new ForbiddenException({ code: 'SELF_DEACTIVATION', message: 'You cannot deactivate yourself.' });
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { isActive: false, availability: 'OFFLINE' } });
      await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.recordTx(tx, {
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        actorLabel: actorLabel(auth),
        action: 'user.deactivated',
        targetType: 'user',
        targetId: userId,
        before: { isActive: true, availability: target.availability },
        after: { isActive: false, availability: 'OFFLINE' },
      });
    });
    this.realtime.toWorkspace(auth.workspaceId, 'availability:changed', { userId, availability: 'OFFLINE' });
    this.events.emit('user.deactivated', { workspaceId: auth.workspaceId, userId, actorId: auth.userId });
    return { deactivated: true };
  }

  // ── Roles ──

  async listRoles(workspaceId: string) {
    const roles = await this.prisma.role.findMany({ where: { workspaceId }, include: { _count: { select: { users: true } } }, orderBy: { name: 'asc' } });
    return roles.map((role) => ({ ...role, userCount: role._count.users, isManager: isManagerRole(role.permissions), _count: undefined }));
  }

  async createRole(auth: AuthContext, input: { name: string; description?: string; permissions: Permission[] }) {
    const role = await this.prisma.$transaction(async (tx) => {
      const created = await tx.role.create({ data: { workspaceId: auth.workspaceId, name: input.name, description: input.description, permissions: input.permissions } });
      await this.audit.recordTx(tx, {
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        actorLabel: actorLabel(auth),
        action: 'role.created',
        targetType: 'role',
        targetId: created.id,
        after: { name: created.name, permissions: created.permissions },
      });
      return created;
    });
    return role;
  }

  async updateRole(auth: AuthContext, roleId: string, input: Partial<{ name: string; description: string; permissions: Permission[]; version: number }>) {
    const before = await this.assertRoleInWorkspace(auth.workspaceId, roleId);
    const { version, ...data } = input;
    const role = await this.prisma.$transaction(async (tx) => {
      const result = await tx.role.updateMany({ where: { id: roleId, workspaceId: auth.workspaceId, ...(version ? { version } : {}) }, data: { ...data, version: { increment: 1 } } });
      if (result.count === 0) throw new DomainError('VERSION_CONFLICT', 'This role was changed by someone else. Reload and try again.', 409);
      const after = await tx.role.findUniqueOrThrow({ where: { id: roleId } });
      await this.audit.recordTx(tx, {
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        actorLabel: actorLabel(auth),
        action: 'role.updated',
        targetType: 'role',
        targetId: roleId,
        before: { name: before.name, permissions: before.permissions },
        after: { name: after.name, permissions: after.permissions },
      });
      return after;
    });
    return role;
  }

  /** Deleting a role leaves its users without a role (SetNull); nothing dangles (Q4). */
  async deleteRole(auth: AuthContext, roleId: string) {
    const role = await this.assertRoleInWorkspace(auth.workspaceId, roleId);
    await this.prisma.$transaction(async (tx) => {
      const affected = await tx.user.findMany({ where: { roleId }, select: { id: true } });
      await tx.role.delete({ where: { id: roleId } });
      await this.audit.recordTx(tx, {
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        actorLabel: actorLabel(auth),
        action: 'role.deleted',
        targetType: 'role',
        targetId: roleId,
        before: { name: role.name, permissions: role.permissions, usersAffected: affected.map((u) => u.id) },
        after: null,
      });
    });
    return { deleted: true };
  }

  // ── helpers ──

  private can(auth: AuthContext, permission: Permission) {
    return auth.baseLevel !== 'USER' || auth.permissions.has(permission);
  }

  private assertCanAssignLevel(auth: AuthContext, level: BaseLevel) {
    if (level === 'OWNER') throw new ForbiddenException({ code: 'OWNER_PROTECTED', message: 'There is exactly one Owner per workspace.' });
    if (level === 'ADMIN' && auth.baseLevel !== 'OWNER') throw new ForbiddenException({ code: 'OWNER_ONLY', message: 'Only the Owner can grant the Admin level.' });
  }

  private async assertRoleInWorkspace(workspaceId: string, roleId: string) {
    const role = await this.prisma.role.findFirst({ where: { id: roleId, workspaceId } });
    if (!role) throw new NotFoundException({ code: 'ROLE_NOT_FOUND', message: 'Role not found.' });
    return role;
  }

  private decorate<T extends { role: { permissions: string[] } | null; telegramChatId: string | null }>(user: T) {
    const { telegramChatId, ...rest } = user;
    return { ...rest, isManager: user.role ? isManagerRole(user.role.permissions) : false, telegramLinked: Boolean(telegramChatId) };
  }
}

function pick<T extends object>(object: T, keys: string[]) {
  return Object.fromEntries(keys.filter((key) => key in object).map((key) => [key, (object as Record<string, unknown>)[key]]));
}
