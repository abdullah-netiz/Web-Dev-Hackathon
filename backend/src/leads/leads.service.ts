import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { SessionUser } from '../auth/types/session-user';
import { businessRule, forbidden, notFound, versionConflict } from '../common/http-errors';
import { keysetArgs, type ListQuery } from '../common/pagination';
import { PrismaService } from '../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { AssignmentService } from './assignment.service';
import { EscalationService } from './escalation.service';
import type {
  CreateLeadInput,
  PublicIntakeInput,
  UpdateLeadInput,
  UpdateLeadSettingsInput,
} from './dto/lead.dto';
import { escalationJobId } from './leads.constants';
import { LeadsRepository, type LeadDetailRow, type LeadListRow } from './leads.repository';

interface Enqueue {
  leadId: string;
  assignmentId: string;
  dueAt: Date;
  ownerId?: string | null;
}

@Injectable()
export class LeadsService {
  constructor(
    private readonly repository: LeadsRepository,
    private readonly assignment: AssignmentService,
    private readonly escalation: EscalationService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async intake(workspaceSlug: string, input: PublicIntakeInput, ip?: string) {
    const workspace = await this.repository.workspaceBySlug(workspaceSlug);
    if (!workspace) {
      throw notFound('workspace');
    }
    return this.createLead(
      workspace.id,
      null,
      { ...input, source: 'WEB_FORM', ownerId: undefined },
      ip,
    );
  }

  create(actor: SessionUser, input: CreateLeadInput, ip?: string) {
    if (input.ownerId && !actor.permissions.includes('leads.reassign')) {
      throw forbidden(
        'Choosing the owner of a new lead needs the reassign permission.',
        'Let the lead be assigned automatically, or ask a manager to assign it.',
      );
    }
    return this.createLead(actor.workspaceId, actor, input, ip);
  }

  private async createLead(
    workspaceId: string,
    actor: SessionUser | null,
    input: CreateLeadInput,
    ip?: string,
  ): Promise<LeadDetailRow> {
    const result = await this.prisma.runInTransaction(async (tx) => {
      let explicitOwner: { id: string; name: string } | null = null;
      if (input.ownerId) {
        const owner = await this.repository.userInWorkspace(workspaceId, input.ownerId, tx);
        if (!owner) {
          throw notFound('user');
        }
        explicitOwner = owner;
      }

      const created = await this.repository.create(
        workspaceId,
        {
          name: input.name,
          phone: input.phone ?? null,
          email: input.email ?? null,
          source: input.source,
          message: input.message ?? null,
          contactId: input.contactId ?? null,
          status: 'NEW',
          lastActivityAt: new Date(),
        },
        tx,
      );

      await this.audit.record(
        {
          workspaceId,
          actorId: actor?.id ?? null,
          actorLabel: actor?.name ?? 'Public web form',
          action: 'lead.created',
          entityType: 'lead',
          entityId: created.id,
          summary: `Lead "${input.name}" captured from ${input.source.toLowerCase().replace('_', ' ')}.`,
          ip,
        },
        tx,
      );

      const target = explicitOwner ?? (await this.assignment.pickNext(workspaceId, {}, tx));
      if (!target) {
        return { leadId: created.id, ownerId: null, enqueue: null };
      }

      const settings = await this.repository.ensureSettings(workspaceId, tx);
      const dueAt = new Date(Date.now() + settings.ackWindowSec * 1000);
      const row = await this.repository.createAssignment(
        workspaceId,
        {
          leadId: created.id,
          userId: target.id,
          status: 'PENDING',
          level: 1,
          dueAt,
          assignedById: actor?.id ?? null,
        },
        tx,
      );
      await tx.leadAssignment.update({
        where: { id: row.id },
        data: { jobId: escalationJobId(created.id, row.id) },
      });
      await tx.lead.update({
        where: { id: created.id },
        data: { ownerId: target.id, status: 'ASSIGNED' },
      });
      await this.audit.record(
        {
          workspaceId,
          actorId: actor?.id ?? null,
          actorLabel: actor?.name ?? 'Lead engine',
          action: 'lead.assigned',
          entityType: 'lead',
          entityId: created.id,
          summary: `Assigned lead "${input.name}" to ${target.name} (level 1).`,
          ip,
        },
        tx,
      );
      return {
        leadId: created.id,
        ownerId: target.id,
        enqueue: {
          leadId: created.id,
          assignmentId: row.id,
          dueAt,
          ownerId: target.id,
        } satisfies Enqueue,
      };
    });

    if (result.enqueue) {
      await this.escalation.enqueue(
        result.enqueue.leadId,
        result.enqueue.assignmentId,
        result.enqueue.dueAt,
      );
    }
    const lead = (await this.get(workspaceId, result.leadId))!;
    this.realtime.emitLead(workspaceId, 'lead.created', {
      id: lead.id,
      name: lead.name,
      source: lead.source,
      status: lead.status,
      ownerId: result.ownerId,
    });
    return lead;
  }

  async list(
    workspaceId: string,
    query: ListQuery & {
      status?: LeadListRow['status'];
      ownerId?: string;
      unassigned?: boolean;
    },
  ) {
    const rows = await this.repository.list(workspaceId, {
      ...keysetArgs(query),
      status: query.status,
      ownerId: query.ownerId,
      unassigned: query.unassigned,
      q: query.q,
    });
    const hasMore = rows.length > query.limit;
    const data = hasMore ? rows.slice(0, query.limit) : rows;
    return {
      data,
      meta: { hasMore, nextCursor: hasMore ? (data[data.length - 1]?.id ?? null) : null },
    };
  }

  async get(workspaceId: string, id: string): Promise<LeadDetailRow | null> {
    return this.repository.findById(workspaceId, id);
  }

  async update(actor: SessionUser, id: string, input: UpdateLeadInput, ip?: string) {
    const { version, ...changes } = input;
    return this.prisma.runInTransaction(async (tx) => {
      const before = await this.repository.findById(actor.workspaceId, id, tx);
      if (!before) {
        throw notFound('lead');
      }
      const changed = await this.repository.updateWithVersion(actor.workspaceId, id, version, changes, tx);
      if (changed === 0) {
        throw versionConflict();
      }
      await this.audit.record(
        {
          workspaceId: actor.workspaceId,
          actorId: actor.id,
          actorLabel: actor.name,
          action: 'lead.updated',
          entityType: 'lead',
          entityId: id,
          summary: `Updated lead "${before.name}".`,
          before,
          ip,
        },
        tx,
      );
      return this.repository.findById(actor.workspaceId, id, tx);
    });
  }

  async acknowledge(actor: SessionUser, id: string, ip?: string) {
    await this.prisma.runInTransaction(async (tx) => {
      const lead = await this.repository.findById(actor.workspaceId, id, tx);
      if (!lead) {
        throw notFound('lead');
      }
      const pending = await this.repository.findPendingAssignment(id, tx);
      if (!pending) {
        throw businessRule(
          'This lead is not waiting for an acknowledgement.',
          'It may already be acknowledged, escalated or closed.',
        );
      }
      const canActOnBehalf = actor.permissions.includes('leads.reassign');
      if (pending.userId !== actor.id && !canActOnBehalf) {
        throw forbidden(
          'Only the current owner can acknowledge this lead.',
          'Ask a manager to reassign it to you first.',
        );
      }
      const changed = await this.repository.acknowledgeAssignmentById(pending.id, tx);
      if (changed === 0) {
        throw versionConflict();
      }
      const seconds = Math.max(0, Math.round((Date.now() - pending.createdAt.getTime()) / 1000));
      await tx.lead.update({
        where: { id },
        data: {
          status: 'ACKNOWLEDGED',
          timeToFirstResponseSec: seconds,
          lastActivityAt: new Date(),
          recoveryReason: 'NONE',
        },
      });
      await this.audit.record(
        {
          workspaceId: actor.workspaceId,
          actorId: actor.id,
          actorLabel: actor.name,
          action: 'lead.acknowledged',
          entityType: 'lead',
          entityId: id,
          summary: `${actor.name} acknowledged lead "${lead.name}" after ${seconds}s.`,
          ip,
        },
        tx,
      );
    });
    const acknowledged = (await this.get(actor.workspaceId, id))!;
    this.realtime.emitLead(actor.workspaceId, 'lead.acknowledged', {
      id: acknowledged.id,
      name: acknowledged.name,
      status: acknowledged.status,
      ownerId: actor.id,
    });
    return acknowledged;
  }

  async assign(actor: SessionUser, id: string, ownerId: string, ip?: string) {
    const enqueue = await this.prisma.runInTransaction(async (tx) => {
      const lead = await this.repository.findById(actor.workspaceId, id, tx);
      if (!lead) {
        throw notFound('lead');
      }
      const target = await this.repository.userInWorkspace(actor.workspaceId, ownerId, tx);
      if (!target) {
        throw notFound('user');
      }
      const pending = await this.repository.findPendingAssignment(id, tx);
      if (pending) {
        await this.repository.expireAssignmentById(pending.id, tx);
      }
      const settings = await this.repository.ensureSettings(actor.workspaceId, tx);
      const dueAt = new Date(Date.now() + settings.ackWindowSec * 1000);
      const row = await this.repository.createAssignment(
        actor.workspaceId,
        {
          leadId: id,
          userId: target.id,
          status: 'PENDING',
          level: 1,
          dueAt,
          assignedById: actor.id,
        },
        tx,
      );
      await tx.leadAssignment.update({
        where: { id: row.id },
        data: { jobId: escalationJobId(id, row.id) },
      });
      await tx.lead.update({
        where: { id },
        data: { ownerId: target.id, status: 'ASSIGNED', recoveryReason: 'NONE', lastActivityAt: new Date() },
      });
      await this.audit.record(
        {
          workspaceId: actor.workspaceId,
          actorId: actor.id,
          actorLabel: actor.name,
          action: 'lead.reassigned',
          entityType: 'lead',
          entityId: id,
          summary: `${actor.name} reassigned lead "${lead.name}" to ${target.name}.`,
          ip,
        },
        tx,
      );
      return { leadId: id, assignmentId: row.id, dueAt, ownerId: target.id } satisfies Enqueue;
    });

    await this.escalation.enqueue(enqueue.leadId, enqueue.assignmentId, enqueue.dueAt);
    const reassigned = (await this.get(actor.workspaceId, id))!;
    this.realtime.emitLead(actor.workspaceId, 'lead.assigned', {
      id: reassigned.id,
      name: reassigned.name,
      status: reassigned.status,
      ownerId: enqueue.ownerId,
    });
    return reassigned;
  }

  async close(actor: SessionUser, id: string, ip?: string) {
    await this.prisma.runInTransaction(async (tx) => {
      const lead = await this.repository.findById(actor.workspaceId, id, tx);
      if (!lead) {
        throw notFound('lead');
      }
      const pending = await this.repository.findPendingAssignment(id, tx);
      if (pending) {
        await this.repository.expireAssignmentById(pending.id, tx);
      }
      await tx.lead.update({
        where: { id },
        data: { status: 'CLOSED', lastActivityAt: new Date() },
      });
      await this.audit.record(
        {
          workspaceId: actor.workspaceId,
          actorId: actor.id,
          actorLabel: actor.name,
          action: 'lead.closed',
          entityType: 'lead',
          entityId: id,
          summary: `${actor.name} closed lead "${lead.name}".`,
          ip,
        },
        tx,
      );
    });
    const closed = (await this.get(actor.workspaceId, id))!;
    this.realtime.emitLead(actor.workspaceId, 'lead.closed', {
      id: closed.id,
      name: closed.name,
      status: closed.status,
    });
    return closed;
  }

  async recovery(workspaceId: string) {
    const settings = await this.repository.ensureSettings(workspaceId);
    const now = new Date();
    const idleBefore = new Date(now.getTime() - settings.idlePeriodSec * 1000);
    const rows = await this.repository.recoveryCandidates(workspaceId, { now, idleBefore });
    const data = rows.map((row) => {
      const pending = row.assignments[0];
      const reason =
        pending && pending.dueAt.getTime() <= now.getTime()
          ? 'OVERDUE'
          : row.escalationCount >= 2
            ? 'ESCALATED_TWICE'
            : row.lastActivityAt && row.lastActivityAt.getTime() < idleBefore.getTime()
              ? 'IDLE'
              : row.recoveryReason;
      return { ...row, recoveryReason: reason };
    });
    return { data };
  }

  async getSettings(workspaceId: string) {
    return this.repository.ensureSettings(workspaceId);
  }

  async updateSettings(actor: SessionUser, input: UpdateLeadSettingsInput, ip?: string) {
    const { version, ...changes } = input;
    return this.prisma.runInTransaction(async (tx) => {
      const before = await this.repository.ensureSettings(actor.workspaceId, tx);
      const changed = await tx.workspaceSettings.updateMany({
        where: { workspaceId: actor.workspaceId, version },
        data: { ...changes, version: { increment: 1 } },
      });
      if (changed.count === 0) {
        throw versionConflict();
      }
      const after = await this.repository.ensureSettings(actor.workspaceId, tx);
      await this.audit.record(
        {
          workspaceId: actor.workspaceId,
          actorId: actor.id,
          actorLabel: actor.name,
          action: 'workspace.lead_settings_updated',
          entityType: 'workspace_settings',
          entityId: before.id,
          summary: `${actor.name} updated the lead assignment settings.`,
          before,
          after,
          ip,
        },
        tx,
      );
      return after;
    });
  }

  /** Immediate reassignment when an owner goes On leave or Offline (F3.6, F3.8). */
  async reassignPendingForUser(workspaceId: string, userId: string, ip?: string) {
    const pending = await this.repository.pendingAssignmentsForUser(workspaceId, userId);
    for (const item of pending) {
      const enqueue = await this.prisma.runInTransaction(async (tx) => {
        const assignment = await this.repository.findAssignmentWithLead(item.id, tx);
        if (!assignment || assignment.status !== 'PENDING') {
          return null;
        }
        const expired = await this.repository.expireAssignmentById(item.id, tx);
        if (expired === 0) {
          return null;
        }
        const pastUserIds = await this.repository.assignmentUserIds(item.leadId, tx);
        let target = await this.assignment.pickNext(workspaceId, { excludeUserIds: pastUserIds }, tx);
        if (!target) {
          target = await this.assignment.pickNext(
            workspaceId,
            { excludeUserIds: pastUserIds, managerOnly: true },
            tx,
          );
        }
        if (!target) {
          await tx.lead.update({ where: { id: item.leadId }, data: { recoveryReason: 'OVERDUE' } });
          await this.audit.record(
            {
              workspaceId,
              actorLabel: 'Lead engine',
              action: 'lead.recovery',
              entityType: 'lead',
              entityId: item.leadId,
              summary: 'Owner became unavailable and no other employee was available; lead entered the recovery queue (OVERDUE).',
              ip,
            },
            tx,
          );
          return null;
        }
        const settings = await this.repository.ensureSettings(workspaceId, tx);
        const dueAt = new Date(Date.now() + settings.ackWindowSec * 1000);
        const row = await this.repository.createAssignment(
          workspaceId,
          { leadId: item.leadId, userId: target.id, status: 'PENDING', level: 1, dueAt },
          tx,
        );
        await tx.leadAssignment.update({
          where: { id: row.id },
          data: { jobId: escalationJobId(item.leadId, row.id) },
        });
        await tx.lead.update({
          where: { id: item.leadId },
          data: { ownerId: target.id, status: 'ASSIGNED', lastActivityAt: new Date() },
        });
        await this.audit.record(
          {
            workspaceId,
            actorLabel: 'Lead engine',
            action: 'lead.reassigned',
            entityType: 'lead',
            entityId: item.leadId,
            summary: `Owner became unavailable; lead reassigned to ${target.name}.`,
            ip,
          },
          tx,
        );
        return { leadId: item.leadId, assignmentId: row.id, dueAt, ownerId: target.id } satisfies Enqueue;
      });
      if (enqueue) {
        await this.escalation.enqueue(enqueue.leadId, enqueue.assignmentId, enqueue.dueAt);
        const lead = await this.get(workspaceId, enqueue.leadId);
        if (lead) {
          this.realtime.emitLead(workspaceId, 'lead.assigned', {
            id: lead.id,
            name: lead.name,
            status: lead.status,
            ownerId: enqueue.ownerId,
          });
        }
      }
    }
  }
}
