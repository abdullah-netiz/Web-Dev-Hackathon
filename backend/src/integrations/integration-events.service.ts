import { Injectable, Logger } from '@nestjs/common';
import { Prisma, Provider } from '@prisma/client';

import { PrismaService } from '../common/prisma.service';
import { cursorWhere, pageResult, type Pagination } from '../common/pagination';

export type RecordEventInput = {
  workspaceId?: string | null;
  provider: Provider;
  direction: 'IN' | 'OUT';
  type: string;
  externalEventId?: string | null;
  payload?: unknown;
  relatedType?: string;
  relatedId?: string;
};

/**
 * Synchronization history (I5.4) and the idempotency guard (I1.8, I2.4): the unique
 * (provider, externalEventId) index turns a duplicate delivery into `{ duplicate: true }`.
 */
@Injectable()
export class IntegrationEventsService {
  private readonly logger = new Logger(IntegrationEventsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordEventInput): Promise<{ id: string; duplicate: boolean }> {
    try {
      const event = await this.prisma.integrationEvent.create({
        data: {
          workspaceId: input.workspaceId ?? null,
          provider: input.provider,
          direction: input.direction,
          type: input.type,
          externalEventId: input.externalEventId ?? null,
          payload: redact(input.payload) as Prisma.InputJsonValue,
          relatedType: input.relatedType,
          relatedId: input.relatedId,
        },
      });
      return { id: event.id, duplicate: false };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        this.logger.log(`Duplicate ${input.provider} event ${input.externalEventId} ignored`);
        return { id: '', duplicate: true };
      }
      throw error;
    }
  }

  async markProcessed(id: string, related?: { relatedType: string; relatedId: string }) {
    if (!id) return;
    await this.prisma.integrationEvent.update({ where: { id }, data: { status: 'PROCESSED', processedAt: new Date(), ...related } });
  }

  async markFailed(id: string, error: string) {
    if (!id) return;
    await this.prisma.integrationEvent.update({ where: { id }, data: { status: 'FAILED', error: error.slice(0, 1000), processedAt: new Date() } });
  }

  /** Rejected requests (bad signature) are recorded without consuming the real event id (I1.2). */
  async markRejected(input: RecordEventInput, reason: string) {
    await this.prisma.integrationEvent.create({
      data: {
        workspaceId: input.workspaceId ?? null,
        provider: input.provider,
        direction: input.direction,
        type: input.type,
        externalEventId: null,
        status: 'REJECTED',
        error: reason,
        payload: redact(input.payload) as Prisma.InputJsonValue,
      },
    });
  }

  async list(workspaceId: string, query: Pagination & { provider?: Provider; status?: string }) {
    const where: Prisma.IntegrationEventWhereInput = {
      workspaceId,
      ...(query.provider ? { provider: query.provider } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...cursorWhere(query.cursor),
    };
    const rows = await this.prisma.integrationEvent.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.limit + 1 });
    return pageResult(rows, query.limit);
  }
}

const SECRET_KEYS = /token|secret|password|authorization|signature|api_key|apikey|card|cvc|account_number|authtoken/i;

/** Payloads are stored for debugging but never with secrets (I5.3). */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined || depth > 6) return value ?? null;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, SECRET_KEYS.test(key) ? '[redacted]' : redact(item, depth + 1)]),
    );
  }
  if (typeof value === 'string' && value.length > 2000) return `${value.slice(0, 2000)}…`;
  return value;
}
