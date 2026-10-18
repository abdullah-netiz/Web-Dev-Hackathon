import { Injectable } from '@nestjs/common';
import type { PipelineStage, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

const STAGE_SELECT = {
  id: true,
  pipelineId: true,
  name: true,
  order: true,
  isWon: true,
  isLost: true,
  requiredFieldKeys: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PipelineStageSelect;

export const PIPELINE_SELECT = {
  id: true,
  workspaceId: true,
  name: true,
  isDefault: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  stages: { orderBy: { order: 'asc' }, select: STAGE_SELECT },
} satisfies Prisma.PipelineSelect;

export type PipelineWithStages = Prisma.PipelineGetPayload<{ select: typeof PIPELINE_SELECT }>;

export interface PipelineWriteData {
  name?: string;
  isDefault?: boolean;
}

export interface StageWriteData {
  name?: string;
  order?: number;
  isWon?: boolean;
  isLost?: boolean;
  requiredFieldKeys?: string[];
}

@Injectable()
export class PipelinesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(workspaceId: string): Promise<PipelineWithStages[]> {
    return this.prisma.pipeline.findMany({
      where: { workspaceId },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      select: PIPELINE_SELECT,
    });
  }

  async findById(
    workspaceId: string,
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<PipelineWithStages | null> {
    return (tx ?? this.prisma).pipeline.findFirst({
      where: { id, workspaceId },
      select: PIPELINE_SELECT,
    });
  }

  async create(
    workspaceId: string,
    data: PipelineWriteData & { name: string },
    tx?: Prisma.TransactionClient,
  ): Promise<PipelineWithStages> {
    const { id } = await (tx ?? this.prisma).pipeline.create({
      data: { ...data, workspaceId },
      select: { id: true },
    });
    return (await this.findById(workspaceId, id, tx))!;
  }

  async updateWithVersion(
    workspaceId: string,
    id: string,
    version: number,
    data: PipelineWriteData,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await (tx ?? this.prisma).pipeline.updateMany({
      where: { id, workspaceId, version },
      data: { ...data, version: { increment: 1 } },
    });
    return result.count;
  }

  async clearDefault(workspaceId: string, tx?: Prisma.TransactionClient): Promise<void> {
    await (tx ?? this.prisma).pipeline.updateMany({
      where: { workspaceId, isDefault: true },
      data: { isDefault: false },
    });
  }

  async delete(workspaceId: string, id: string, tx?: Prisma.TransactionClient): Promise<number> {
    const result = await (tx ?? this.prisma).pipeline.deleteMany({ where: { id, workspaceId } });
    return result.count;
  }

  async findStage(
    workspaceId: string,
    stageId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<PipelineStage | null> {
    return (tx ?? this.prisma).pipelineStage.findFirst({ where: { id: stageId, workspaceId } });
  }

  async countStages(pipelineId: string, tx?: Prisma.TransactionClient): Promise<number> {
    return (tx ?? this.prisma).pipelineStage.count({ where: { pipelineId } });
  }

  async createStage(
    workspaceId: string,
    pipelineId: string,
    data: StageWriteData & { name: string; order: number },
    tx?: Prisma.TransactionClient,
  ): Promise<PipelineStage> {
    return (tx ?? this.prisma).pipelineStage.create({
      data: { ...data, workspaceId, pipelineId },
    });
  }

  async updateStageWithVersion(
    workspaceId: string,
    stageId: string,
    version: number,
    data: StageWriteData,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await (tx ?? this.prisma).pipelineStage.updateMany({
      where: { id: stageId, workspaceId, version },
      data: { ...data, version: { increment: 1 } },
    });
    return result.count;
  }

  async setStageOrder(
    workspaceId: string,
    stageId: string,
    order: number,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await (tx ?? this.prisma).pipelineStage.updateMany({
      where: { id: stageId, workspaceId },
      data: { order },
    });
  }

  async maxStageOrder(pipelineId: string, tx?: Prisma.TransactionClient): Promise<number> {
    const result = await (tx ?? this.prisma).pipelineStage.aggregate({
      where: { pipelineId },
      _max: { order: true },
    });
    return result._max.order ?? -1;
  }

  async moveOpportunitiesToStage(
    workspaceId: string,
    fromStageId: string,
    toStageId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await (tx ?? this.prisma).opportunity.updateMany({
      where: { workspaceId, stageId: fromStageId },
      data: { stageId: toStageId, version: { increment: 1 } },
    });
    return result.count;
  }

  async deleteStage(
    workspaceId: string,
    stageId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await (tx ?? this.prisma).pipelineStage.deleteMany({
      where: { id: stageId, workspaceId },
    });
    return result.count;
  }
}
