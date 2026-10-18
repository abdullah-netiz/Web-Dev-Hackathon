import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { keysetArgs, paginatedResponse, type ListQuery } from '../common/pagination';
import { PrismaService } from '../common/prisma.service';
import { AuditRepository } from './audit.repository';

export interface AuditInput {
  workspaceId: string;
  actorId?: string | null;
  actorLabel?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  summary: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  return value === undefined ? undefined : (value as Prisma.InputJsonValue);
}

/**
 * The single writer for the append-only audit log (F4). Callers pass their
 * transaction so the audit row commits with the change it describes (§4.3).
 */
@Injectable()
export class AuditService {
  constructor(
    private readonly repository: AuditRepository,
    private readonly prisma: PrismaService,
  ) {}

  async record(input: AuditInput, tx?: Prisma.TransactionClient): Promise<void> {
    await this.repository.create(
      {
        workspaceId: input.workspaceId,
        actorId: input.actorId ?? null,
        actorLabel: input.actorLabel ?? null,
        action: input.action,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        summary: input.summary,
        before: toJson(input.before),
        after: toJson(input.after),
        ip: input.ip ?? null,
      },
      tx,
    );
  }

  async list(workspaceId: string, query: ListQuery, filters: { action?: string } = {}) {
    const rows = await this.repository.listForWorkspace(workspaceId, {
      ...keysetArgs(query),
      action: filters.action,
    });
    return paginatedResponse(rows, query.limit);
  }
}
