import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { hashPassword } from '../auth/password';
import { toSessionUser } from '../auth/serializer';
import { SessionService } from '../auth/session.service';
import type { SessionUser, SessionUserProfile } from '../auth/types/session-user';
import { businessRule, notFound, versionConflict } from '../common/http-errors';
import { ADMIN_DEFAULT_PERMISSIONS, USER_DEFAULT_PERMISSIONS } from '../common/permissions';
import { PrismaService } from '../common/prisma.service';
import type { SignupInput, UpdateWorkspaceInput } from './dto/workspace.dto';
import { WorkspaceRepository } from './workspace.repository';

@Injectable()
export class WorkspaceService {
  constructor(
    private readonly repository: WorkspaceRepository,
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Creates a new workspace, its default roles, the first user as Owner and a
   * session — all in one transaction so a half-built workspace can never exist (F1.1).
   */
  async signup(
    input: SignupInput,
    meta: { ip?: string; userAgent?: string },
  ): Promise<{ token: string; user: SessionUserProfile }> {
    const email = input.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      throw businessRule(
        'An account with that email already exists.',
        'Sign in instead, or use a different email address.',
      );
    }

    const slug = await this.uniqueSlug(input.workspaceName);
    const passwordHash = await hashPassword(input.password);

    const owner = await this.prisma.runInTransaction(async (tx) => {
      const workspace = await tx.workspace.create({
        data: { name: input.workspaceName, slug },
      });
      await tx.workspaceSettings.create({ data: { workspaceId: workspace.id } });
      await tx.role.create({
        data: {
          workspaceId: workspace.id,
          name: 'Admin',
          permissions: ADMIN_DEFAULT_PERMISSIONS,
          isSystem: true,
        },
      });
      await tx.role.create({
        data: {
          workspaceId: workspace.id,
          name: 'User',
          permissions: USER_DEFAULT_PERMISSIONS,
          isSystem: true,
        },
      });
      const created = await tx.user.create({
        data: {
          workspaceId: workspace.id,
          email,
          passwordHash,
          name: input.name,
          baseLevel: 'OWNER',
        },
        include: { role: true },
      });
      await this.audit.record(
        {
          workspaceId: workspace.id,
          actorId: created.id,
          actorLabel: created.name,
          action: 'workspace.created',
          entityType: 'workspace',
          entityId: workspace.id,
          summary: `${created.name} created the workspace "${input.workspaceName}".`,
          after: { name: input.workspaceName, slug },
        },
        tx,
      );
      return created;
    });

    const { token } = await this.sessions.create(owner.id, meta);
    return { token, user: toSessionUser(owner) };
  }

  async get(workspaceId: string) {
    const workspace = await this.repository.get(workspaceId);
    if (!workspace) {
      throw notFound('workspace');
    }
    return workspace;
  }

  async update(actor: SessionUser, input: UpdateWorkspaceInput, ip?: string) {
    return this.prisma.runInTransaction(async (tx) => {
      const before = await this.repository.get(actor.workspaceId, tx);
      if (!before) {
        throw notFound('workspace');
      }

      const settingsData: Prisma.WorkspaceSettingsUpdateManyMutationInput = {};
      if (input.ackWindowSec !== undefined) settingsData.ackWindowSec = input.ackWindowSec;
      if (input.escalationLevels !== undefined) settingsData.escalationLevels = input.escalationLevels;
      if (input.idlePeriodSec !== undefined) settingsData.idlePeriodSec = input.idlePeriodSec;
      if (input.maxOpenLeads !== undefined) settingsData.maxOpenLeads = input.maxOpenLeads;
      if (input.acknowledgedOnLeavePolicy !== undefined) {
        settingsData.acknowledgedOnLeavePolicy = input.acknowledgedOnLeavePolicy;
      }

      const changedSettings = await this.repository.updateSettings(
        actor.workspaceId,
        input.version,
        settingsData,
        tx,
      );
      if (changedSettings === 0) {
        throw versionConflict();
      }

      if (input.name !== undefined) {
        await this.repository.updateName(actor.workspaceId, input.name, tx);
      }

      const after = await this.repository.get(actor.workspaceId, tx);
      await this.audit.record(
        {
          workspaceId: actor.workspaceId,
          actorId: actor.id,
          actorLabel: actor.name,
          action: 'workspace.updated',
          entityType: 'workspace',
          entityId: actor.workspaceId,
          summary: `${actor.name} updated the workspace settings.`,
          before: {
            name: before.name,
            ackWindowSec: before.settings?.ackWindowSec,
            escalationLevels: before.settings?.escalationLevels,
            idlePeriodSec: before.settings?.idlePeriodSec,
            maxOpenLeads: before.settings?.maxOpenLeads,
            acknowledgedOnLeavePolicy: before.settings?.acknowledgedOnLeavePolicy,
          },
          after: {
            name: after?.name,
            ackWindowSec: after?.settings?.ackWindowSec,
            escalationLevels: after?.settings?.escalationLevels,
            idlePeriodSec: after?.settings?.idlePeriodSec,
            maxOpenLeads: after?.settings?.maxOpenLeads,
            acknowledgedOnLeavePolicy: after?.settings?.acknowledgedOnLeavePolicy,
          },
          ip,
        },
        tx,
      );
      return after!;
    });
  }

  /** A readable, collision-free slug the public intake form can use (F1.6). */
  private async uniqueSlug(name: string): Promise<string> {
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'workspace';
    let candidate = base;
    for (let suffix = 2; ; suffix += 1) {
      const clash = await this.repository.findBySlug(candidate);
      if (!clash) {
        return candidate;
      }
      candidate = `${base}-${suffix}`;
    }
  }
}
