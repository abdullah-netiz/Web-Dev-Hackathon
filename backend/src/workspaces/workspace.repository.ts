import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';

export interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  settings: {
    ackWindowSec: number;
    escalationLevels: number;
    idlePeriodSec: number;
    maxOpenLeads: number;
    roundRobinCursor: number;
    acknowledgedOnLeavePolicy: string;
    version: number;
  } | null;
}

const WORKSPACE_INCLUDE = {
  settings: {
    select: {
      ackWindowSec: true,
      escalationLevels: true,
      idlePeriodSec: true,
      maxOpenLeads: true,
      roundRobinCursor: true,
      acknowledgedOnLeavePolicy: true,
      version: true,
    },
  },
} satisfies Prisma.WorkspaceInclude;

@Injectable()
export class WorkspaceRepository {
  constructor(private readonly prisma: PrismaService) {}

  get(workspaceId: string, tx?: Prisma.TransactionClient): Promise<WorkspaceRow | null> {
    return (tx ?? this.prisma).workspace.findUnique({
      where: { id: workspaceId },
      include: WORKSPACE_INCLUDE,
    });
  }

  findBySlug(slug: string): Promise<{ id: string } | null> {
    return this.prisma.workspace.findUnique({ where: { slug }, select: { id: true } });
  }

  async updateName(
    workspaceId: string,
    name: string,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await (tx ?? this.prisma).workspace.updateMany({
      where: { id: workspaceId },
      data: { name },
    });
    return result.count;
  }

  async updateSettings(
    workspaceId: string,
    version: number,
    data: Prisma.WorkspaceSettingsUpdateManyMutationInput,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await (tx ?? this.prisma).workspaceSettings.updateMany({
      where: { workspaceId, version },
      data: { ...data, version: { increment: 1 } },
    });
    return result.count;
  }
}
