import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../common/prisma.service';
import { cursorWhere, pageResult, type Pagination } from '../common/pagination';

export type AuditInput = {
  workspaceId: string;
  actorId: string | null; // null = system
  actorLabel: string;
  action: string;
  targetType: string;
  targetId: string;
  before?: unknown;
  after?: unknown;
};

type Tx = Prisma.TransactionClient | PrismaService;

/**
 * Append-only audit history (F4). There is deliberately no update or delete method here, and no
 * route exposes one (F4.3). Writers pass their transaction so the event is atomic with the action.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  recordTx(tx: Tx, input: AuditInput) {
    return tx.auditEvent.create({
      data: {
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        actorLabel: input.actorLabel,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        before: toJson(input.before),
        after: toJson(input.after),
      },
    });
  }

  record(input: AuditInput) {
    return this.recordTx(this.prisma, input);
  }

  async list(workspaceId: string, query: Pagination & { action?: string; actorId?: string; targetType?: string; from?: string; to?: string }) {
    const where: Prisma.AuditEventWhereInput = {
      workspaceId,
      ...(query.action ? { action: { startsWith: query.action } } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.targetType ? { targetType: query.targetType } : {}),
      ...(query.from || query.to ? { createdAt: { gte: query.from ? new Date(query.from) : undefined, lte: query.to ? new Date(query.to) : undefined } } : {}),
      ...cursorWhere(query.cursor),
    };
    const rows = await this.prisma.auditEvent.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.limit + 1 });
    return pageResult(rows, query.limit);
  }

  async actions(workspaceId: string) {
    const rows = await this.prisma.auditEvent.groupBy({ by: ['action'], where: { workspaceId }, _count: { _all: true }, orderBy: { action: 'asc' } });
    return rows.map((row) => ({ action: row.action, count: row._count._all }));
  }
}

function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
