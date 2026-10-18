import { Injectable } from '@nestjs/common';
import type { ActivityEntity, Prisma } from '@prisma/client';

import { DomainEvents } from '../common/domain-events';
import { PrismaService } from '../common/prisma.service';
import { cursorWhere, pageResult, type Pagination, skipFor } from '../common/pagination';

type Tx = Prisma.TransactionClient | PrismaService;

/**
 * Activity history (F2.7): notes, stage changes, assignments, field edits, messages, payments,
 * appointments. Writers pass their transaction so the entry is atomic with the change.
 */
@Injectable()
export class ActivitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEvents,
  ) {}

  logTx(tx: Tx, input: { workspaceId: string; entityType: ActivityEntity; entityId: string; type: string; actorId: string | null; payload?: Record<string, unknown> }) {
    return tx.activity.create({ data: { workspaceId: input.workspaceId, entityType: input.entityType, entityId: input.entityId, type: input.type, actorId: input.actorId, payload: (input.payload ?? {}) as Prisma.InputJsonValue } });
  }

  log(input: { workspaceId: string; entityType: ActivityEntity; entityId: string; type: string; actorId: string | null; payload?: Record<string, unknown> }) {
    return this.logTx(this.prisma, input);
  }

  /** A recorded action on a lead counts as acknowledgement (Section 7); the lead engine listens. */
  notifyLeadActivity(workspaceId: string, leadId: string, actorId: string | null, type: string) {
    this.events.emit('lead.activity', { workspaceId, leadId, actorId, type });
  }

  async list(workspaceId: string, entityType: ActivityEntity, entityId: string, pagination: Pagination) {
    const rows = await this.prisma.activity.findMany({
      where: { workspaceId, entityType, entityId, ...cursorWhere(pagination.cursor) },
      include: { actor: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: skipFor(pagination), take: pagination.limit + 1,
    });
    return pageResult(rows, pagination.limit);
  }

  /** Combined timeline for a contact: its own activities plus those of its opportunities and leads (F2.8). */
  async contactTimeline(workspaceId: string, contactId: string, pagination: Pagination) {
    const [opportunities, leads] = await Promise.all([
      this.prisma.opportunity.findMany({ where: { workspaceId, contactId }, select: { id: true } }),
      this.prisma.lead.findMany({ where: { workspaceId, contactId }, select: { id: true } }),
    ]);
    const rows = await this.prisma.activity.findMany({
      where: {
        workspaceId,
        OR: [
          { entityType: 'CONTACT', entityId: contactId },
          { entityType: 'OPPORTUNITY', entityId: { in: opportunities.map((o) => o.id) } },
          { entityType: 'LEAD', entityId: { in: leads.map((l) => l.id) } },
        ],
        ...cursorWhere(pagination.cursor),
      },
      include: { actor: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: skipFor(pagination), take: pagination.limit + 1,
    });
    return pageResult(rows, pagination.limit);
  }
}
