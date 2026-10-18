import { randomUUID } from 'node:crypto';

import { InjectQueue } from '@nestjs/bullmq';
import { ForbiddenException, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { Prisma, type Lead, type LeadSource, type LeadStatus } from '@prisma/client';
import { Queue } from 'bullmq';

import { AuditService } from '../audit/audit.service';
import { actorLabel, hasPermission, type AuthContext } from '../auth/auth.types';
import { isManagerRole } from '../auth/permissions';
import { DomainEvents } from '../common/domain-events';
import { DomainError } from '../common/http-exception.filter';
import { PrismaService } from '../common/prisma.service';
import { cursorWhere, pageResult, type Pagination, skipFor } from '../common/pagination';
import { ActivitiesService } from '../crm/activities.service';
import { compileFilters, type Filters } from '../crm/list-filters';
import { RecordsService } from '../crm/records.service';
import { escalationJobId, JOB_NAMES, QUEUES } from '../jobs/queues';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { canEscalate, computeRecoveryReason, nextEscalationTarget, pickRoundRobin, timeToFirstResponseSec, type Candidate } from './assignment.logic';

const LEAD_INCLUDE = {
  contact: { select: { id: true, firstName: true, lastName: true, phone: true, email: true, companyId: true } },
  currentAssignee: { select: { id: true, firstName: true, lastName: true, availability: true } },
  opportunity: { select: { id: true, name: true, stageId: true } },
} satisfies Prisma.LeadInclude;

type Tx = Prisma.TransactionClient;
type Actor = { id: string | null; label: string };
const SYSTEM: Actor = { id: null, label: 'system' };

/**
 * The lead engine (F3). A lead must never be without an accountable owner:
 *  - assignment runs in a transaction that locks the workspace row (round-robin cursor) and the lead row
 *  - each PENDING assignment has a BullMQ delayed job; the DB partial unique index allows one PENDING per lead
 *  - the processor re-reads state before escalating (at-least-once jobs, exactly-once effect) (F3.8, Q5)
 */
@Injectable()
export class LeadsService implements OnModuleInit {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly activities: ActivitiesService,
    private readonly records: RecordsService,
    private readonly realtime: RealtimeGateway,
    private readonly events: DomainEvents,
    @InjectQueue(QUEUES.escalation) private readonly escalationQueue: Queue,
    @InjectQueue(QUEUES.alerts) private readonly alertsQueue: Queue,
  ) {}

  onModuleInit() {
    // Acknowledged by action (Section 7): any recorded action on the lead by its assignee counts.
    this.events.on('lead.activity', async ({ workspaceId, leadId, actorId, type }) => {
      if (!actorId) return;
      await this.acknowledgeIfAssignee(workspaceId, leadId, actorId, type);
    });
    this.events.on('opportunity.activity', async ({ workspaceId, opportunityId, actorId, type }) => {
      if (!actorId) return;
      const leads = await this.prisma.lead.findMany({ where: { workspaceId, opportunityId, status: 'ASSIGNED' }, select: { id: true } });
      for (const lead of leads) await this.acknowledgeIfAssignee(workspaceId, lead.id, actorId, type);
    });
    this.events.on('user.availability_changed', async ({ workspaceId, userId, to, actorId }) => {
      if (to === 'ON_LEAVE' || to === 'OFFLINE') await this.reassignForAbsentUser(workspaceId, userId, { id: actorId, label: actorId ? 'user' : 'system' }, `assignee set to ${to}`);
    });
    this.events.on('user.deactivated', async ({ workspaceId, userId, actorId }) => {
      await this.reassignForAbsentUser(workspaceId, userId, { id: actorId, label: actorId ? 'user' : 'system' }, 'assignee deactivated', true);
    });
  }

  // ───────────── Intake (F3.1) ─────────────

  /** Public form or inbound message: contact is found/created, lead created and assigned. */
  async captureLead(workspaceId: string, input: { source: LeadSource; title: string; notes?: string; contactId?: string; contact?: { firstName: string; lastName?: string; email?: string; phone?: string }; opportunityId?: string }, actor: Actor = SYSTEM) {
    let contactId = input.contactId;
    if (!contactId) {
      if (!input.contact) throw new DomainError('CONTACT_REQUIRED', 'A contact or contact details are required.', 422);
      if (input.contact.phone) {
        const { contact } = await this.records.findOrCreateByPhone(workspaceId, input.contact.phone, `${input.contact.firstName} ${input.contact.lastName ?? ''}`.trim());
        contactId = contact.id;
        if (input.contact.email && !contact.email) await this.prisma.contact.update({ where: { id: contact.id }, data: { email: input.contact.email.toLowerCase() } });
      } else {
        const existing = input.contact.email ? await this.prisma.contact.findFirst({ where: { workspaceId, email: input.contact.email.toLowerCase() } }) : null;
        contactId = existing?.id ?? (await this.prisma.contact.create({ data: { workspaceId, firstName: input.contact.firstName, lastName: input.contact.lastName ?? '', email: input.contact.email?.toLowerCase(), source: input.source.toLowerCase() } })).id;
      }
    } else {
      const contact = await this.prisma.contact.findFirst({ where: { id: contactId, workspaceId } });
      if (!contact) throw new NotFoundException({ code: 'CONTACT_NOT_FOUND', message: 'Contact not found.' });
    }

    const lead = await this.prisma.$transaction(async (tx) => {
      const created = await tx.lead.create({ data: { workspaceId, contactId: contactId as string, opportunityId: input.opportunityId ?? null, title: input.title, source: input.source, notes: input.notes, status: 'NEW' } });
      await this.activities.logTx(tx, { workspaceId, entityType: 'LEAD', entityId: created.id, type: 'created', actorId: actor.id, payload: { source: input.source } });
      return created;
    });
    this.realtime.toWorkspace(workspaceId, 'lead:created', { leadId: lead.id, source: lead.source, title: lead.title });

    await this.assign(workspaceId, lead.id, actor, { reason: 'initial assignment' });
    return this.getLeadInternal(workspaceId, lead.id);
  }

  async createManual(auth: AuthContext, input: { title: string; notes?: string; contactId?: string; contact?: { firstName: string; lastName?: string; email?: string; phone?: string }; opportunityId?: string }) {
    return this.captureLead(auth.workspaceId, { ...input, source: 'MANUAL' }, { id: auth.userId, label: actorLabel(auth) });
  }

  // ───────────── Assignment (F3.3) ─────────────

  /**
   * Assign the lead to the next eligible employee (or a specific one). Runs in a SERIALIZABLE-safe
   * transaction: locks the workspace row (cursor + settings) and the lead row, inserts the PENDING
   * assignment (the partial unique index rejects a second one), then schedules the window job.
   */
  async assign(workspaceId: string, leadId: string, actor: Actor, options: { toUserId?: string; level?: number; reason: string; excludeUserIds?: string[]; manual?: boolean }) {
    const result = await this.prisma.$transaction(async (tx) => {
      const [workspace] = await tx.$queryRaw<{ id: string; ackWindowSec: number; levelWindowSec: number; maxOpenLeadsDefault: number }[]>`SELECT "id", "ackWindowSec", "levelWindowSec", "maxOpenLeadsDefault" FROM "Workspace" WHERE "id" = ${workspaceId} FOR UPDATE`;
      if (!workspace) throw new NotFoundException({ code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found.' });
      const [lead] = await tx.$queryRaw<Lead[]>`SELECT * FROM "Lead" WHERE "id" = ${leadId} AND "workspaceId" = ${workspaceId} FOR UPDATE`;
      if (!lead) throw new NotFoundException({ code: 'LEAD_NOT_FOUND', message: 'Lead not found.' });
      if (lead.status === 'CLOSED') throw new DomainError('LEAD_CLOSED', 'This lead is closed and cannot be assigned.', 409);

      const candidates = await this.loadCandidates(tx, workspaceId);
      let target: Candidate | undefined;
      if (options.toUserId) {
        target = candidates.find((candidate) => candidate.userId === options.toUserId);
        if (!target) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'Target user not found or inactive.' });
        if (!options.manual && (target.availability === 'ON_LEAVE' || target.availability === 'OFFLINE')) {
          throw new DomainError('USER_UNAVAILABLE', 'That employee is not available to receive leads.', 409);
        }
      } else {
        const picked = pickRoundRobin(candidates, workspace.maxOpenLeadsDefault, options.excludeUserIds ?? []);
        if (!picked) {
          // Nobody eligible: fall back to a manager so the lead is never ownerless; else leave NEW for the recovery queue.
          const manager = candidates.find((candidate) => candidate.isManager && candidate.availability !== 'ON_LEAVE' && candidate.availability !== 'OFFLINE');
          if (!manager) {
            await tx.lead.update({ where: { id: leadId }, data: { recoveryReason: 'OVERDUE', lastActivityAt: new Date() } });
            await this.audit.recordTx(tx, { workspaceId, actorId: actor.id, actorLabel: actor.label, action: 'lead.unassignable', targetType: 'lead', targetId: leadId, after: { reason: 'no available employee or manager' } });
            return null;
          }
          target = manager;
        } else {
          target = picked;
        }
      }

      // Close the previous pending assignment, if any (reassignment path)
      const previous = lead.currentAssignmentId ? await tx.leadAssignment.findUnique({ where: { id: lead.currentAssignmentId } }) : null;
      if (previous && previous.status === 'PENDING') {
        await tx.leadAssignment.update({ where: { id: previous.id }, data: { status: 'REASSIGNED', resolvedAt: new Date(), reason: options.reason } });
      }

      const level = options.level ?? 0;
      const windowSec = level === 0 ? workspace.ackWindowSec : workspace.levelWindowSec;
      const now = new Date();
      const dueAt = new Date(now.getTime() + windowSec * 1000);
      const assignmentId = randomUUID();
      const jobId = escalationJobId(leadId, assignmentId);

      await tx.leadAssignment.create({ data: { id: assignmentId, workspaceId, leadId, assigneeId: target.userId, level, status: 'PENDING', reason: options.reason, assignedAt: now, dueAt, jobId, createdById: actor.id } });
      await tx.lead.update({
        where: { id: leadId },
        data: { status: 'ASSIGNED', currentAssigneeId: target.userId, currentAssignmentId: assignmentId, escalationLevel: level, firstAssignedAt: lead.firstAssignedAt ?? now, lastAssignedAt: now, dueAt, lastActivityAt: now, recoveryReason: 'NONE', version: { increment: 1 } },
      });
      await tx.user.update({ where: { id: target.userId }, data: { lastAssignedAt: now } });
      await tx.workspace.update({ where: { id: workspaceId }, data: { roundRobinCursor: { increment: 1 } } });
      await this.activities.logTx(tx, { workspaceId, entityType: 'LEAD', entityId: leadId, type: previous ? 'reassignment' : 'assignment', actorId: actor.id, payload: { toUserId: target.userId, fromUserId: previous?.assigneeId ?? null, level, reason: options.reason, dueAt } });
      await this.audit.recordTx(tx, {
        workspaceId, actorId: actor.id, actorLabel: actor.label, action: previous ? 'lead.reassigned' : 'lead.assigned', targetType: 'lead', targetId: leadId,
        before: previous ? { assigneeId: previous.assigneeId, assignmentId: previous.id, level: previous.level } : null,
        after: { assigneeId: target.userId, assignmentId, level, dueAt, reason: options.reason },
      });
      return { assignmentId, jobId, dueAt, windowSec, targetUserId: target.userId, previousAssigneeId: previous?.assigneeId ?? null, level };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 });

    if (!result) {
      this.realtime.toWorkspace(workspaceId, 'lead:recovery', { leadId, reason: 'OVERDUE', detail: 'No available employee' });
      return null;
    }

    // Schedule after commit: a job that fires for a rolled-back assignment is a harmless no-op (state re-check).
    await this.escalationQueue.add(JOB_NAMES.escalate, { workspaceId, leadId, assignmentId: result.assignmentId }, { jobId: result.jobId, delay: result.windowSec * 1000 });
    const payload = { leadId, assigneeId: result.targetUserId, previousAssigneeId: result.previousAssigneeId, level: result.level, dueAt: result.dueAt, reason: options.reason };
    this.realtime.toWorkspace(workspaceId, result.previousAssigneeId ? 'lead:reassigned' : 'lead:assigned', payload);
    this.realtime.toUser(result.targetUserId, 'notification', { title: 'New lead assigned to you', body: options.reason, link: `/leads/${leadId}`, leadId });
    return result;
  }

  // ───────────── Acknowledgement (F3.4) ─────────────

  async acknowledge(auth: AuthContext, leadId: string) {
    const lead = await this.getLeadInternal(auth.workspaceId, leadId);
    if (lead.status !== 'ASSIGNED') throw new DomainError('NOT_PENDING', `This lead is ${lead.status.toLowerCase()}; there is nothing to acknowledge.`, 409);
    if (lead.currentAssigneeId !== auth.userId && !hasPermission(auth, 'leads.reassign')) {
      throw new ForbiddenException({ code: 'NOT_ASSIGNEE', message: 'Only the assigned employee (or a manager) can acknowledge this lead.' });
    }
    return this.acknowledgeInternal(auth.workspaceId, leadId, { id: auth.userId, label: actorLabel(auth) }, 'acknowledge');
  }

  private async acknowledgeIfAssignee(workspaceId: string, leadId: string, actorId: string, type: string) {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, workspaceId }, select: { status: true, currentAssigneeId: true } });
    if (!lead || lead.status !== 'ASSIGNED' || lead.currentAssigneeId !== actorId) {
      if (lead) await this.prisma.lead.updateMany({ where: { id: leadId, workspaceId }, data: { lastActivityAt: new Date() } });
      return;
    }
    const actor = await this.prisma.user.findUnique({ where: { id: actorId }, select: { firstName: true, lastName: true, email: true } });
    await this.acknowledgeInternal(workspaceId, leadId, { id: actorId, label: actor ? `${actor.firstName} ${actor.lastName} <${actor.email}>` : 'user' }, type);
  }

  private async acknowledgeInternal(workspaceId: string, leadId: string, actor: Actor, via: string) {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const [lead] = await tx.$queryRaw<Lead[]>`SELECT * FROM "Lead" WHERE "id" = ${leadId} AND "workspaceId" = ${workspaceId} FOR UPDATE`;
      if (!lead || lead.status !== 'ASSIGNED' || !lead.currentAssignmentId) return null;
      const now = new Date();
      const assignment = await tx.leadAssignment.update({ where: { id: lead.currentAssignmentId }, data: { status: 'ACKNOWLEDGED', resolvedAt: now } });
      const ttfr = lead.firstAckedAt ? lead.timeToFirstResponseSec : timeToFirstResponseSec(lead.firstAssignedAt, now);
      await tx.lead.update({ where: { id: leadId }, data: { status: 'ACKNOWLEDGED', dueAt: null, firstAckedAt: lead.firstAckedAt ?? now, timeToFirstResponseSec: ttfr, lastActivityAt: now, recoveryReason: 'NONE', version: { increment: 1 } } });
      await this.activities.logTx(tx, { workspaceId, entityType: 'LEAD', entityId: leadId, type: 'acknowledgement', actorId: actor.id, payload: { via, assignmentId: assignment.id, timeToFirstResponseSec: ttfr } });
      await this.audit.recordTx(tx, { workspaceId, actorId: actor.id, actorLabel: actor.label, action: 'lead.acknowledged', targetType: 'lead', targetId: leadId, before: { status: 'ASSIGNED', assignmentId: assignment.id }, after: { status: 'ACKNOWLEDGED', via, timeToFirstResponseSec: ttfr } });
      return { jobId: assignment.jobId, assigneeId: assignment.assigneeId, ttfr };
    });
    if (!outcome) return this.getLeadInternal(workspaceId, leadId);
    await this.removeJob(outcome.jobId);
    this.realtime.toWorkspace(workspaceId, 'lead:acknowledged', { leadId, assigneeId: outcome.assigneeId, timeToFirstResponseSec: outcome.ttfr });
    return this.getLeadInternal(workspaceId, leadId);
  }

  // ───────────── Escalation (F3.5, F3.8) ─────────────

  /** Called by the BullMQ processor when a window expires. Idempotent: re-checks state under lock. */
  async escalate(workspaceId: string, leadId: string, assignmentId: string) {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const [lead] = await tx.$queryRaw<Lead[]>`SELECT * FROM "Lead" WHERE "id" = ${leadId} AND "workspaceId" = ${workspaceId} FOR UPDATE`;
      const assignment = await tx.leadAssignment.findUnique({ where: { id: assignmentId } });
      if (!lead || !assignment || !canEscalate(assignment, lead)) return { skipped: true as const, reason: 'assignment no longer pending' };
      if (assignment.dueAt.getTime() > Date.now() + 1000) return { skipped: true as const, reason: 'not due yet' };

      const workspace = await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
      const candidates = await this.loadCandidates(tx, workspaceId);
      const previousAssignees = (await tx.leadAssignment.findMany({ where: { leadId }, select: { assigneeId: true } })).map((row) => row.assigneeId);
      const target = nextEscalationTarget({ currentLevel: assignment.level, maxLevels: workspace.escalationLevels, currentAssigneeId: assignment.assigneeId, previousAssignees, candidates, maxOpenLeadsDefault: workspace.maxOpenLeadsDefault });

      await tx.leadAssignment.update({ where: { id: assignmentId }, data: { status: 'EXPIRED', resolvedAt: new Date() } });
      if (!target) {
        // Chain exhausted: the current owner keeps accountability; the lead is flagged for recovery (F3.7).
        await tx.lead.update({ where: { id: leadId }, data: { recoveryReason: 'ESCALATED_TWICE', escalationCount: { increment: 1 }, version: { increment: 1 } } });
        await tx.leadAssignment.create({ data: { workspaceId, leadId, assigneeId: assignment.assigneeId, level: assignment.level, status: 'PENDING', reason: 'escalation chain exhausted; owner kept, lead in recovery queue', dueAt: new Date(Date.now() + workspace.levelWindowSec * 1000), jobId: null } }).then(async (kept) => {
          await tx.lead.update({ where: { id: leadId }, data: { currentAssignmentId: kept.id, dueAt: kept.dueAt } });
        });
        await this.audit.recordTx(tx, { workspaceId, actorId: null, actorLabel: 'system', action: 'lead.escalation_exhausted', targetType: 'lead', targetId: leadId, before: { assigneeId: assignment.assigneeId, level: assignment.level }, after: { recoveryReason: 'ESCALATED_TWICE' } });
        return { skipped: false as const, exhausted: true as const, assigneeId: assignment.assigneeId };
      }
      return { skipped: false as const, exhausted: false as const, target, fromUserId: assignment.assigneeId, fromLevel: assignment.level };
    });

    if (outcome.skipped) {
      this.logger.debug(`Escalation skipped for lead ${leadId}: ${outcome.reason}`);
      return outcome;
    }
    if (outcome.exhausted) {
      this.realtime.toWorkspace(workspaceId, 'lead:recovery', { leadId, reason: 'ESCALATED_TWICE' });
      return outcome;
    }

    const assigned = await this.assign(workspaceId, leadId, SYSTEM, { toUserId: outcome.target.userId, level: outcome.target.level, reason: outcome.target.reason, manual: true });
    await this.prisma.lead.update({ where: { id: leadId }, data: { escalationCount: { increment: 1 } } });
    if (assigned) {
      await this.audit.record({ workspaceId, actorId: null, actorLabel: 'system', action: 'lead.escalated', targetType: 'lead', targetId: leadId, before: { assigneeId: outcome.fromUserId, level: outcome.fromLevel }, after: { assigneeId: outcome.target.userId, level: outcome.target.level, reason: outcome.target.reason } });
      await this.activities.log({ workspaceId, entityType: 'LEAD', entityId: leadId, type: 'escalation', actorId: null, payload: { fromUserId: outcome.fromUserId, toUserId: outcome.target.userId, level: outcome.target.level, reason: outcome.target.reason } });
      this.realtime.toWorkspace(workspaceId, 'lead:escalated', { leadId, fromUserId: outcome.fromUserId, toUserId: outcome.target.userId, level: outcome.target.level, reason: outcome.target.reason });
      // F3.9 / I4: alert the new owner outside the application
      await this.alertsQueue.add(JOB_NAMES.sendAlert, { workspaceId, leadId, assignmentId: assigned.assignmentId, userId: outcome.target.userId, reason: outcome.target.reason, level: outcome.target.level }, { jobId: `alert-${assigned.assignmentId}` });
    }
    return outcome;
  }

  // ───────────── Manual reassignment, absence, close ─────────────

  async reassign(auth: AuthContext, leadId: string, toUserId: string, reason?: string) {
    await this.getLeadInternal(auth.workspaceId, leadId);
    const result = await this.assign(auth.workspaceId, leadId, { id: auth.userId, label: actorLabel(auth) }, { toUserId, level: 0, reason: reason ?? 'manual reassignment', manual: true });
    if (!result) throw new DomainError('REASSIGN_FAILED', 'The lead could not be reassigned.', 409);
    return this.getLeadInternal(auth.workspaceId, leadId);
  }

  /** F3.6: unacknowledged leads of an absent employee are reassigned at once; acknowledged ones follow the workspace policy. */
  async reassignForAbsentUser(workspaceId: string, userId: string, actor: Actor, reason: string, includeAcknowledged = false) {
    const workspace = await this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    const statuses: LeadStatus[] = includeAcknowledged || workspace.acknowledgedLeadsOnAbsence === 'REASSIGN' ? ['ASSIGNED', 'ACKNOWLEDGED'] : ['ASSIGNED'];
    const leads = await this.prisma.lead.findMany({ where: { workspaceId, currentAssigneeId: userId, status: { in: statuses } }, select: { id: true, status: true, currentAssignmentId: true } });
    let moved = 0;
    for (const lead of leads) {
      try {
        if (lead.status === 'ACKNOWLEDGED' && lead.currentAssignmentId) {
          await this.prisma.lead.update({ where: { id: lead.id }, data: { status: 'ASSIGNED' } });
        }
        const result = await this.assign(workspaceId, lead.id, actor, { reason, excludeUserIds: [userId] });
        if (result) moved += 1;
      } catch (error) {
        this.logger.warn(`Reassignment of lead ${lead.id} failed: ${(error as Error).message}`);
      }
    }
    if (leads.length > 0) this.logger.log(`Reassigned ${moved}/${leads.length} leads from absent user ${userId}`);
    return { moved, total: leads.length };
  }

  async close(auth: AuthContext, leadId: string, reason: string) {
    const lead = await this.getLeadInternal(auth.workspaceId, leadId);
    if (lead.currentAssigneeId !== auth.userId && !hasPermission(auth, 'leads.reassign')) throw new ForbiddenException({ code: 'NOT_ASSIGNEE', message: 'Only the assignee or a manager can close this lead.' });
    const jobId = await this.prisma.$transaction(async (tx) => {
      const assignment = lead.currentAssignmentId ? await tx.leadAssignment.update({ where: { id: lead.currentAssignmentId }, data: { status: lead.status === 'ASSIGNED' ? 'CANCELLED' : undefined, resolvedAt: new Date() } }) : null;
      await tx.lead.update({ where: { id: leadId }, data: { status: 'CLOSED', dueAt: null, closedReason: reason, recoveryReason: 'NONE', lastActivityAt: new Date(), version: { increment: 1 } } });
      await this.activities.logTx(tx, { workspaceId: auth.workspaceId, entityType: 'LEAD', entityId: leadId, type: 'closed', actorId: auth.userId, payload: { reason } });
      await this.audit.recordTx(tx, { workspaceId: auth.workspaceId, actorId: auth.userId, actorLabel: actorLabel(auth), action: 'lead.closed', targetType: 'lead', targetId: leadId, before: { status: lead.status }, after: { status: 'CLOSED', reason } });
      return assignment?.jobId ?? null;
    });
    await this.removeJob(jobId);
    this.realtime.toWorkspace(auth.workspaceId, 'lead:updated', { leadId, status: 'CLOSED' });
    return this.getLeadInternal(auth.workspaceId, leadId);
  }

  // ───────────── Recovery (F3.7) and reconciliation (Q5) ─────────────

  /** Runs every 30 s: recomputes recoveryReason from Section 7 definitions for open leads in every workspace. */
  async recoverySweep() {
    const workspaces = await this.prisma.workspace.findMany({ select: { id: true, idleSec: true } });
    const now = new Date();
    let changed = 0;
    for (const workspace of workspaces) {
      const leads = await this.prisma.lead.findMany({ where: { workspaceId: workspace.id, status: { not: 'CLOSED' } }, select: { id: true, status: true, dueAt: true, escalationCount: true, lastActivityAt: true, recoveryReason: true } });
      for (const lead of leads) {
        const reason = computeRecoveryReason(lead, now, workspace.idleSec);
        if (reason !== lead.recoveryReason) {
          await this.prisma.lead.update({ where: { id: lead.id }, data: { recoveryReason: reason } });
          this.realtime.toWorkspace(workspace.id, 'lead:recovery', { leadId: lead.id, reason });
          changed += 1;
        }
      }
    }
    return { changed };
  }

  /** On startup: every PENDING assignment whose window passed while we were down gets its job re-enqueued. */
  async reconcile() {
    const pending = await this.prisma.leadAssignment.findMany({ where: { status: 'PENDING' }, select: { id: true, leadId: true, workspaceId: true, dueAt: true, jobId: true } });
    let enqueued = 0;
    for (const assignment of pending) {
      const jobId = assignment.jobId ?? escalationJobId(assignment.leadId, assignment.id);
      const existing = await this.escalationQueue.getJob(jobId);
      if (existing) continue;
      const delay = Math.max(0, assignment.dueAt.getTime() - Date.now());
      await this.escalationQueue.add(JOB_NAMES.escalate, { workspaceId: assignment.workspaceId, leadId: assignment.leadId, assignmentId: assignment.id }, { jobId, delay });
      if (!assignment.jobId) await this.prisma.leadAssignment.update({ where: { id: assignment.id }, data: { jobId } });
      enqueued += 1;
    }
    this.logger.log(`Reconciliation: ${pending.length} pending assignments, ${enqueued} jobs re-enqueued`);
    return { pending: pending.length, enqueued };
  }

  // ───────────── Queries ─────────────

  async list(auth: AuthContext, query: Pagination & { filters?: Filters; status?: LeadStatus; mine?: boolean }) {
    const scopeToSelf = !hasPermission(auth, 'leads.view_all') || query.mine;
    const base: Prisma.LeadWhereInput = {
      workspaceId: auth.workspaceId,
      ...(scopeToSelf ? { currentAssigneeId: auth.userId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...compileFilters(query.filters, ['title']),
    };
    const [rows, total] = await Promise.all([
      this.prisma.lead.findMany({ where: { ...base, ...cursorWhere(query.cursor) }, include: LEAD_INCLUDE, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: skipFor(query), take: query.limit + 1 }),
      this.prisma.lead.count({ where: base }),
    ]);
    return pageResult(rows, query.limit, total);
  }

  /** F3.7: one page lists leads needing recovery with the reason for each. */
  async recoveryQueue(auth: AuthContext, pagination: Pagination) {
    const scopeToSelf = !hasPermission(auth, 'leads.view_all');
    const where: Prisma.LeadWhereInput = { workspaceId: auth.workspaceId, recoveryReason: { not: 'NONE' }, status: { not: 'CLOSED' }, ...(scopeToSelf ? { currentAssigneeId: auth.userId } : {}) };
    const [rows, total, byReason] = await Promise.all([
      this.prisma.lead.findMany({ where: { ...where, ...cursorWhere(pagination.cursor) }, include: LEAD_INCLUDE, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: skipFor(pagination), take: pagination.limit + 1 }),
      this.prisma.lead.count({ where }),
      this.prisma.lead.groupBy({ by: ['recoveryReason'], where, _count: { _all: true } }),
    ]);
    const page = pageResult(rows, pagination.limit, total);
    return { ...page, meta: { ...page.meta, byReason: Object.fromEntries(byReason.map((row) => [row.recoveryReason, row._count._all])) } };
  }

  async get(auth: AuthContext, leadId: string) {
    const lead = await this.getLeadInternal(auth.workspaceId, leadId);
    if (!hasPermission(auth, 'leads.view_all') && lead.currentAssigneeId !== auth.userId) throw new NotFoundException({ code: 'LEAD_NOT_FOUND', message: 'Lead not found.' });
    const assignments = await this.prisma.leadAssignment.findMany({ where: { leadId }, include: { assignee: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { assignedAt: 'asc' } });
    return { ...lead, assignments, remainingSec: lead.dueAt ? Math.max(0, Math.round((lead.dueAt.getTime() - Date.now()) / 1000)) : null };
  }

  async getLeadInternal(workspaceId: string, leadId: string) {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, workspaceId }, include: LEAD_INCLUDE });
    if (!lead) throw new NotFoundException({ code: 'LEAD_NOT_FOUND', message: 'Lead not found.' });
    return lead;
  }

  // ───────────── helpers ─────────────

  private async loadCandidates(tx: Tx, workspaceId: string): Promise<Candidate[]> {
    const users = await tx.user.findMany({ where: { workspaceId, isActive: true }, include: { role: { select: { permissions: true } } } });
    const open = await tx.lead.groupBy({ by: ['currentAssigneeId'], where: { workspaceId, status: { in: ['ASSIGNED', 'ACKNOWLEDGED'] }, currentAssigneeId: { not: null } }, _count: { _all: true } });
    const openCount = new Map(open.map((row) => [row.currentAssigneeId as string, row._count._all]));
    return users.map((user) => ({
      userId: user.id,
      availability: user.availability,
      maxOpenLeads: user.maxOpenLeads,
      openLeadCount: openCount.get(user.id) ?? 0,
      backupUserId: user.backupUserId,
      isManager: user.isEscalationManager || (user.baseLevel !== 'USER' ? user.baseLevel === 'ADMIN' : isManagerRole(user.role?.permissions ?? [])),
      lastAssignedAt: user.lastAssignedAt,
    }));
  }

  private async removeJob(jobId: string | null) {
    if (!jobId) return;
    try {
      const job = await this.escalationQueue.getJob(jobId);
      await job?.remove();
    } catch (error) {
      // A job already picked up by a worker cannot be removed; its state re-check makes it a no-op.
      this.logger.debug(`Could not remove job ${jobId}: ${(error as Error).message}`);
    }
  }
}
