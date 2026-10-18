import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

const OPPORTUNITY_SELECT = {
  id: true,
  workspaceId: true,
  name: true,
  companyId: true,
  contactId: true,
  pipelineId: true,
  stageId: true,
  ownerId: true,
  value: true,
  currency: true,
  closeDate: true,
  description: true,
  custom: true,
  paymentStatus: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  company: { select: { id: true, name: true } },
  contact: { select: { id: true, firstName: true, lastName: true } },
  owner: { select: { id: true, name: true } },
  stage: { select: { id: true, name: true, isWon: true, isLost: true } },
} satisfies Prisma.OpportunitySelect;

export type OpportunityRow = Prisma.OpportunityGetPayload<{ select: typeof OPPORTUNITY_SELECT }>;

export interface OpportunityListArgs {
  take: number;
  skip?: number;
  cursor?: { id: string };
  search?: string;
  stageId?: string;
  ownerId?: string;
}

export interface OpportunityWriteData {
  name?: string;
  companyId?: string | null;
  contactId?: string | null;
  pipelineId?: string;
  stageId?: string;
  ownerId?: string | null;
  value?: number | null;
  currency?: string;
  closeDate?: Date | null;
  description?: string | null;
  custom?: Prisma.InputJsonValue;
}

@Injectable()
export class OpportunitiesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(workspaceId: string, args: OpportunityListArgs): Promise<OpportunityRow[]> {
    return this.prisma.opportunity.findMany({
      where: {
        workspaceId,
        ...(args.stageId ? { stageId: args.stageId } : {}),
        ...(args.ownerId ? { ownerId: args.ownerId } : {}),
        ...(args.search ? { name: { contains: args.search, mode: 'insensitive' } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: args.take,
      skip: args.skip,
      cursor: args.cursor,
      select: OPPORTUNITY_SELECT,
    });
  }

  async findById(
    workspaceId: string,
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<OpportunityRow | null> {
    return (tx ?? this.prisma).opportunity.findFirst({
      where: { id, workspaceId },
      select: OPPORTUNITY_SELECT,
    });
  }

  async findDefaultPipelineId(workspaceId: string): Promise<string | null> {
    const pipeline = await this.prisma.pipeline.findFirst({
      where: { workspaceId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      select: { id: true },
    });
    return pipeline?.id ?? null;
  }

  async findStage(workspaceId: string, stageId: string) {
    return this.prisma.pipelineStage.findFirst({
      where: { id: stageId, workspaceId },
      select: { id: true, name: true, pipelineId: true, requiredFieldKeys: true },
    });
  }

  async findFirstStage(workspaceId: string, pipelineId: string) {
    return this.prisma.pipelineStage.findFirst({
      where: { workspaceId, pipelineId },
      orderBy: { order: 'asc' },
      select: { id: true, name: true, pipelineId: true, requiredFieldKeys: true },
    });
  }

  async create(
    workspaceId: string,
    data: OpportunityWriteData & { name: string; pipelineId: string; stageId: string },
    tx?: Prisma.TransactionClient,
  ): Promise<OpportunityRow> {
    const { id } = await (tx ?? this.prisma).opportunity.create({
      data: { ...data, workspaceId },
      select: { id: true },
    });
    return (await this.findById(workspaceId, id, tx))!;
  }

  async updateWithVersion(
    workspaceId: string,
    id: string,
    version: number,
    data: OpportunityWriteData,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await (tx ?? this.prisma).opportunity.updateMany({
      where: { id, workspaceId, version },
      data: { ...data, version: { increment: 1 } },
    });
    return result.count;
  }

  async delete(workspaceId: string, id: string, tx?: Prisma.TransactionClient): Promise<number> {
    const result = await (tx ?? this.prisma).opportunity.deleteMany({ where: { id, workspaceId } });
    return result.count;
  }
}
