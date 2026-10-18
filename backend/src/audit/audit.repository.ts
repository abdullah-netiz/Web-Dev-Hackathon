import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';

export interface AuditListArgs {
  take: number;
  skip?: number;
  cursor?: { id: string };
  action?: string;
}

@Injectable()
export class AuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    data: Prisma.AuditEventUncheckedCreateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await (tx ?? this.prisma).auditEvent.create({ data });
  }

  async listForWorkspace(workspaceId: string, args: AuditListArgs) {
    return this.prisma.auditEvent.findMany({
      where: { workspaceId, ...(args.action ? { action: args.action } : {}) },
      orderBy: { createdAt: 'desc' },
      take: args.take,
      skip: args.skip,
      cursor: args.cursor,
    });
  }
}
