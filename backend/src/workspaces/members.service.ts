import { Injectable } from '@nestjs/common';
import type { Availability, BaseLevel, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { hashPassword } from '../auth/password';
import { SessionService } from '../auth/session.service';
import type { SessionUser } from '../auth/types/session-user';
import { businessRule, forbidden, notFound, versionConflict } from '../common/http-errors';
import { keysetArgs, paginatedResponse } from '../common/pagination';
import { PrismaService } from '../common/prisma.service';
import { LeadsService } from '../leads/leads.service';
import type { InviteMemberInput, UpdateMemberInput } from './dto/member.dto';
import { MembersRepository } from './members.repository';
import { RolesRepository } from './roles.repository';

@Injectable()
export class MembersService {
  constructor(
    private readonly repository: MembersRepository,
    private readonly roles: RolesRepository,
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly leads: LeadsService,
  ) {}

  async list(
    workspaceId: string,
    query: {
      limit: number;
      cursor?: string;
      q?: string;
      baseLevel?: BaseLevel;
      availability?: Availability;
      roleId?: string;
      includeInactive: boolean;
    },
  ) {
    const rows = await this.repository.list(workspaceId, {
      ...keysetArgs(query),
      q: query.q,
      baseLevel: query.baseLevel,
      availability: query.availability,
      roleId: query.roleId,
      includeInactive: query.includeInactive,
    });
    return paginatedResponse(rows, query.limit);
  }

  async invite(actor: SessionUser, input: InviteMemberInput, ip?: string) {
    const email = input.email.trim().toLowerCase();
    const existing = await this.repository.findByEmail(email);
    if (existing) {
      throw businessRule(
        'A member with that email already exists.',
        'Use a different email address, or ask them to sign in.',
      );
    }
    const passwordHash = await hashPassword(input.password);

    return this.prisma.runInTransaction(async (tx) => {
      let roleId = input.roleId ?? null;
      if (roleId) {
        const role = await this.roles.findById(actor.workspaceId, roleId, tx);
        if (!role) {
          throw notFound('role');
        }
      } else {
        const fallback = await this.roles.findByName(
          actor.workspaceId,
          input.baseLevel === 'ADMIN' ? 'Admin' : 'User',
          tx,
        );
        roleId = fallback?.id ?? null;
      }

      const member = await this.repository.create(
        {
          workspaceId: actor.workspaceId,
          email,
          passwordHash,
          name: input.name,
          baseLevel: input.baseLevel,
          roleId,
          ...(input.availability ? { availability: input.availability } : {}),
        },
        tx,
      );
      await this.audit.record(
        {
          workspaceId: actor.workspaceId,
          actorId: actor.id,
          actorLabel: actor.name,
          action: 'user.invited',
          entityType: 'user',
          entityId: member.id,
          summary: `${actor.name} invited ${member.name} (${member.baseLevel}).`,
          after: { email: member.email, baseLevel: member.baseLevel, roleId },
          ip,
        },
        tx,
      );
      return member;
    });
  }

  async update(actor: SessionUser, id: string, input: UpdateMemberInput, ip?: string) {
    const result = await this.prisma.runInTransaction(async (tx) => {
      const target = await this.repository.findById(actor.workspaceId, id, tx);
      if (!target) {
        throw notFound('member');
      }
      if (target.baseLevel === 'OWNER' && actor.baseLevel !== 'OWNER') {
        throw forbidden(
          'Only an owner can change the owner’s account.',
          'Ask the workspace owner to make this change.',
        );
      }
      if (input.baseLevel === 'OWNER' && actor.baseLevel !== 'OWNER') {
        throw forbidden(
          'Only an owner can grant ownership.',
          'Ask the workspace owner to transfer ownership.',
        );
      }
      if (target.baseLevel === 'OWNER' && input.baseLevel && input.baseLevel !== 'OWNER') {
        const otherOwners = await this.repository.countActiveOwners(actor.workspaceId, id, tx);
        if (otherOwners === 0) {
          throw businessRule(
            'A workspace must always have an owner.',
            'Make another member an owner before changing this one.',
          );
        }
      }
      if (input.roleId) {
        const role = await this.roles.findById(actor.workspaceId, input.roleId, tx);
        if (!role) {
          throw notFound('role');
        }
      }

      const data: Prisma.UserUncheckedUpdateManyInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.baseLevel !== undefined) data.baseLevel = input.baseLevel;
      if (input.roleId !== undefined) data.roleId = input.roleId ?? null;
      if (input.telegramChatId !== undefined) data.telegramChatId = input.telegramChatId ?? null;
      if (input.availability !== undefined) data.availability = input.availability;

      const changed = await this.repository.updateWithVersion(
        actor.workspaceId,
        id,
        input.version,
        data,
        tx,
      );
      if (changed === 0) {
        throw versionConflict();
      }
      const after = await this.repository.findById(actor.workspaceId, id, tx);
      await this.audit.record(
        {
          workspaceId: actor.workspaceId,
          actorId: actor.id,
          actorLabel: actor.name,
          action: 'user.updated',
          entityType: 'user',
          entityId: id,
          summary: `${actor.name} updated ${target.name}’s account.`,
          before: {
            name: target.name,
            baseLevel: target.baseLevel,
            roleId: target.roleId,
            availability: target.availability,
          },
          after: {
            name: after?.name,
            baseLevel: after?.baseLevel,
            roleId: after?.roleId,
            availability: after?.availability,
          },
          ip,
        },
        tx,
      );
      return after!;
    });

    if (input.availability === 'ON_LEAVE' || input.availability === 'OFFLINE') {
      await this.leads.reassignPendingForUser(actor.workspaceId, id, ip);
    }
    return result;
  }

  async deactivate(actor: SessionUser, id: string, ip?: string) {
    const target = await this.repository.findById(actor.workspaceId, id);
    if (!target) {
      throw notFound('member');
    }
    if (target.id === actor.id) {
      throw businessRule(
        'You cannot deactivate your own account.',
        'Ask another owner or admin to deactivate it.',
      );
    }
    if (target.baseLevel === 'OWNER') {
      throw businessRule(
        'The workspace owner cannot be deactivated.',
        'Transfer ownership to another member first.',
      );
    }
    if (!target.isActive) {
      throw businessRule('That member is already deactivated.', 'No action is needed.');
    }

    // Hand the member's unacknowledged leads to someone else before they go offline (F3.6, Q4).
    await this.leads.reassignPendingForUser(actor.workspaceId, id, ip);

    await this.prisma.runInTransaction(async (tx) => {
      const changed = await this.repository.updateWithVersion(
        actor.workspaceId,
        id,
        target.version,
        { isActive: false, availability: 'OFFLINE' },
        tx,
      );
      if (changed === 0) {
        throw versionConflict();
      }
      await this.audit.record(
        {
          workspaceId: actor.workspaceId,
          actorId: actor.id,
          actorLabel: actor.name,
          action: 'user.deactivated',
          entityType: 'user',
          entityId: id,
          summary: `${actor.name} deactivated ${target.name}.`,
          before: { isActive: target.isActive, availability: target.availability },
          after: { isActive: false, availability: 'OFFLINE' },
          ip,
        },
        tx,
      );
    });

    await this.sessions.revokeAllForUser(id);
    return (await this.repository.findById(actor.workspaceId, id))!;
  }

  async reactivate(actor: SessionUser, id: string, ip?: string) {
    const target = await this.repository.findById(actor.workspaceId, id);
    if (!target) {
      throw notFound('member');
    }
    if (target.isActive) {
      throw businessRule('That member is already active.', 'No action is needed.');
    }
    await this.prisma.runInTransaction(async (tx) => {
      const changed = await this.repository.updateWithVersion(
        actor.workspaceId,
        id,
        target.version,
        { isActive: true },
        tx,
      );
      if (changed === 0) {
        throw versionConflict();
      }
      await this.audit.record(
        {
          workspaceId: actor.workspaceId,
          actorId: actor.id,
          actorLabel: actor.name,
          action: 'user.reactivated',
          entityType: 'user',
          entityId: id,
          summary: `${actor.name} reactivated ${target.name}.`,
          before: { isActive: target.isActive },
          after: { isActive: true },
          ip,
        },
        tx,
      );
    });
    return (await this.repository.findById(actor.workspaceId, id))!;
  }
}
