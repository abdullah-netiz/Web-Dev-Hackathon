import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../common/prisma.service';
import { AssignmentService } from './assignment.service';
import { ESCALATION_JOB, LEADS_QUEUE, escalationJobId } from './leads.constants';
import { LeadsRepository } from './leads.repository';

export type EscalationOutcomeStatus = 'ignored' | 'escalated' | 'recovered';

export interface EscalationResult {
  status: EscalationOutcomeStatus;
  toUserId?: string;
  level?: number;
}

interface ExpiryWork {
  outcome: EscalationResult;
  enqueue?: { leadId: string; assignmentId: string; dueAt: Date };
}

/**
 * Owns the acknowledgement timer and the escalation chain (F3.4, F3.5). The
 * delayed job is the only clock: the worker re-reads the assignment inside a
 * transaction and escalates only while it is still PENDING (F3.8).
 */
@Injectable()
export class EscalationService {
  constructor(
    private readonly repository: LeadsRepository,
    private readonly assignment: AssignmentService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
    @InjectQueue(LEADS_QUEUE) private readonly queue: Queue,
  ) {}

  async enqueue(leadId: string, assignmentId: string, dueAt: Date): Promise<void> {
    const delay = Math.max(0, dueAt.getTime() - Date.now());
    await this.queue.add(
      ESCALATION_JOB,
      { leadId, assignmentId },
      {
        jobId: escalationJobId(leadId, assignmentId),
        delay,
        attempts: 5,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: true,
        removeOnFail: 1_000,
      },
    );
  }

  async handleExpiry(assignmentId: string): Promise<EscalationResult> {
    const work = await this.prisma.runInTransaction((tx) => this.expireAndEscalate(assignmentId, tx));
    if (work.enqueue) {
      await this.enqueue(work.enqueue.leadId, work.enqueue.assignmentId, work.enqueue.dueAt);
    }
    return work.outcome;
  }

  private async expireAndEscalate(
    assignmentId: string,
    tx: Prisma.TransactionClient,
  ): Promise<ExpiryWork> {
    const assignment = await this.repository.findAssignmentWithLead(assignmentId, tx);
    if (!assignment || assignment.status !== 'PENDING') {
      return { outcome: { status: 'ignored' } };
    }
    if (assignment.dueAt.getTime() > Date.now()) {
      return {
        outcome: { status: 'ignored' },
        enqueue: { leadId: assignment.leadId, assignmentId, dueAt: assignment.dueAt },
      };
    }

    const expired = await this.repository.expireAssignmentById(assignmentId, tx);
    if (expired === 0) {
      return { outcome: { status: 'ignored' } };
    }

    const lead = assignment.lead;
    const settings = await this.repository.ensureSettings(lead.workspaceId, tx);
    const nextLevel = assignment.level + 1;
    const pastUserIds = await this.repository.assignmentUserIds(lead.id, tx);

    if (nextLevel > settings.escalationLevels) {
      const reason = lead.escalationCount >= 2 ? 'ESCALATED_TWICE' : 'OVERDUE';
      await tx.lead.update({ where: { id: lead.id }, data: { recoveryReason: reason } });
      await this.audit.record(
        {
          workspaceId: lead.workspaceId,
          actorLabel: 'Lead engine',
          action: 'lead.recovery',
          entityType: 'lead',
          entityId: lead.id,
          summary: `Lead "${lead.name}" exhausted its escalation chain and entered the recovery queue (${reason}).`,
        },
        tx,
      );
      return { outcome: { status: 'recovered' } };
    }

    const managerStep = nextLevel >= settings.escalationLevels;
    let target = await this.assignment.pickNext(
      lead.workspaceId,
      { excludeUserIds: pastUserIds, managerOnly: managerStep },
      tx,
    );
    if (!target) {
      target = await this.assignment.pickNext(
        lead.workspaceId,
        { excludeUserIds: pastUserIds, managerOnly: true },
        tx,
      );
    }
    if (!target) {
      const reason = lead.escalationCount >= 2 ? 'ESCALATED_TWICE' : 'OVERDUE';
      await tx.lead.update({ where: { id: lead.id }, data: { recoveryReason: reason } });
      await this.audit.record(
        {
          workspaceId: lead.workspaceId,
          actorLabel: 'Lead engine',
          action: 'lead.recovery',
          entityType: 'lead',
          entityId: lead.id,
          summary: `No available employee for lead "${lead.name}"; it entered the recovery queue (${reason}).`,
        },
        tx,
      );
      return { outcome: { status: 'recovered' } };
    }

    const dueAt = new Date(Date.now() + settings.ackWindowSec * 1000);
    const created = await this.repository.createAssignment(
      lead.workspaceId,
      {
        leadId: lead.id,
        userId: target.id,
        status: 'PENDING',
        level: nextLevel,
        dueAt,
      },
      tx,
    );
    const jobId = escalationJobId(lead.id, created.id);
    await tx.leadAssignment.update({ where: { id: created.id }, data: { jobId } });
    await tx.lead.update({
      where: { id: lead.id },
      data: {
        ownerId: target.id,
        status: 'ASSIGNED',
        escalationCount: { increment: 1 },
        recoveryReason: 'NONE',
        lastActivityAt: new Date(),
      },
    });
    await this.audit.record(
      {
        workspaceId: lead.workspaceId,
        actorLabel: 'Lead engine',
        action: 'lead.escalated',
        entityType: 'lead',
        entityId: lead.id,
        summary: `Lead "${lead.name}" escalated to level ${nextLevel} and was reassigned to ${target.name}.`,
      },
      tx,
    );

    return {
      outcome: { status: 'escalated', toUserId: target.id, level: nextLevel },
      enqueue: { leadId: lead.id, assignmentId: created.id, dueAt },
    };
  }
}
