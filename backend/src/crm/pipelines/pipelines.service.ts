import { Injectable } from '@nestjs/common';
import type { PipelineStage } from '@prisma/client';
import { AuditService } from '../../audit/audit.service';
import type { SessionUser } from '../../auth/types/session-user';
import { businessRule, notFound, versionConflict } from '../../common/http-errors';
import { PrismaService } from '../../common/prisma.service';
import {
  PipelinesRepository,
  type PipelineWithStages,
} from './pipelines.repository';
import type {
  CreatePipelineInput,
  CreateStageInput,
  UpdatePipelineInput,
  UpdateStageInput,
} from './dto/pipeline.dto';

@Injectable()
export class PipelinesService {
  constructor(
    private readonly repository: PipelinesRepository,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  list(workspaceId: string): Promise<PipelineWithStages[]> {
    return this.repository.list(workspaceId);
  }

  async get(workspaceId: string, id: string): Promise<PipelineWithStages> {
    const pipeline = await this.repository.findById(workspaceId, id);
    if (!pipeline) {
      throw notFound('pipeline');
    }
    return pipeline;
  }

  async create(
    user: SessionUser,
    input: CreatePipelineInput,
    ip?: string,
  ): Promise<PipelineWithStages> {
    return this.prisma.runInTransaction(async (tx) => {
      if (input.isDefault) {
        await this.repository.clearDefault(user.workspaceId, tx);
      }
      const pipeline = await this.repository.create(user.workspaceId, input, tx);
      await this.audit.record(
        {
          workspaceId: user.workspaceId,
          actorId: user.id,
          actorLabel: user.name,
          action: 'pipeline.created',
          entityType: 'pipeline',
          entityId: pipeline.id,
          summary: `Created pipeline "${pipeline.name}".`,
          after: pipeline,
          ip,
        },
        tx,
      );
      return pipeline;
    });
  }

  async update(
    user: SessionUser,
    id: string,
    input: UpdatePipelineInput,
    ip?: string,
  ): Promise<PipelineWithStages> {
    const { version, ...changes } = input;
    return this.prisma.runInTransaction(async (tx) => {
      const before = await this.repository.findById(user.workspaceId, id, tx);
      if (!before) {
        throw notFound('pipeline');
      }
      if (changes.isDefault) {
        await this.repository.clearDefault(user.workspaceId, tx);
      }
      const changed = await this.repository.updateWithVersion(
        user.workspaceId,
        id,
        version,
        changes,
        tx,
      );
      if (changed === 0) {
        throw versionConflict();
      }
      const after = (await this.repository.findById(user.workspaceId, id, tx))!;
      await this.audit.record(
        {
          workspaceId: user.workspaceId,
          actorId: user.id,
          actorLabel: user.name,
          action: 'pipeline.updated',
          entityType: 'pipeline',
          entityId: id,
          summary: `Updated pipeline "${after.name}".`,
          before,
          after,
          ip,
        },
        tx,
      );
      return after;
    });
  }

  async remove(user: SessionUser, id: string, ip?: string): Promise<void> {
    await this.prisma.runInTransaction(async (tx) => {
      const before = await this.repository.findById(user.workspaceId, id, tx);
      if (!before) {
        throw notFound('pipeline');
      }
      const stageIds = before.stages.map((stage) => stage.id);
      const inUse = await tx.opportunity.count({
        where: {
          workspaceId: user.workspaceId,
          ...(stageIds.length > 0 ? { stageId: { in: stageIds } } : { pipelineId: id }),
        },
      });
      if (inUse > 0) {
        throw businessRule(
          `This pipeline still has ${inUse} opportunit${inUse === 1 ? 'y' : 'ies'}.`,
          'Move or delete those opportunities before deleting the pipeline.',
        );
      }
      await this.repository.delete(user.workspaceId, id, tx);
      await this.audit.record(
        {
          workspaceId: user.workspaceId,
          actorId: user.id,
          actorLabel: user.name,
          action: 'pipeline.deleted',
          entityType: 'pipeline',
          entityId: id,
          summary: `Deleted pipeline "${before.name}".`,
          before,
          ip,
        },
        tx,
      );
    });
  }

  async createStage(
    user: SessionUser,
    pipelineId: string,
    input: CreateStageInput,
    ip?: string,
  ): Promise<PipelineStage> {
    return this.prisma.runInTransaction(async (tx) => {
      const pipeline = await this.repository.findById(user.workspaceId, pipelineId, tx);
      if (!pipeline) {
        throw notFound('pipeline');
      }
      const order = input.order ?? (await this.repository.maxStageOrder(pipelineId, tx)) + 1;
      const stage = await this.repository.createStage(
        user.workspaceId,
        pipelineId,
        { ...input, order },
        tx,
      );
      await this.audit.record(
        {
          workspaceId: user.workspaceId,
          actorId: user.id,
          actorLabel: user.name,
          action: 'stage.created',
          entityType: 'pipeline_stage',
          entityId: stage.id,
          summary: `Added stage "${stage.name}" to "${pipeline.name}".`,
          after: stage,
          ip,
        },
        tx,
      );
      return stage;
    });
  }

  async updateStage(
    user: SessionUser,
    pipelineId: string,
    stageId: string,
    input: UpdateStageInput,
    ip?: string,
  ): Promise<PipelineStage> {
    const { version, ...changes } = input;
    return this.prisma.runInTransaction(async (tx) => {
      const before = await this.repository.findStage(user.workspaceId, stageId, tx);
      if (!before || before.pipelineId !== pipelineId) {
        throw notFound('stage');
      }
      const changed = await this.repository.updateStageWithVersion(
        user.workspaceId,
        stageId,
        version,
        changes,
        tx,
      );
      if (changed === 0) {
        throw versionConflict();
      }
      const after = (await this.repository.findStage(user.workspaceId, stageId, tx))!;
      await this.audit.record(
        {
          workspaceId: user.workspaceId,
          actorId: user.id,
          actorLabel: user.name,
          action: 'stage.updated',
          entityType: 'pipeline_stage',
          entityId: stageId,
          summary: `Updated stage "${after.name}".`,
          before,
          after,
          ip,
        },
        tx,
      );
      return after;
    });
  }

  async reorderStages(
    user: SessionUser,
    pipelineId: string,
    stageIds: string[],
    ip?: string,
  ): Promise<PipelineWithStages> {
    return this.prisma.runInTransaction(async (tx) => {
      const pipeline = await this.repository.findById(user.workspaceId, pipelineId, tx);
      if (!pipeline) {
        throw notFound('pipeline');
      }
      const ownIds = new Set(pipeline.stages.map((stage) => stage.id));
      if (stageIds.length !== ownIds.size || stageIds.some((id) => !ownIds.has(id))) {
        throw businessRule(
          'The reorder list must contain exactly this pipeline’s stages.',
          'Reload the pipeline and reorder the stages it shows.',
        );
      }
      for (const [index, stageId] of stageIds.entries()) {
        await this.repository.setStageOrder(user.workspaceId, stageId, index, tx);
      }
      const after = (await this.repository.findById(user.workspaceId, pipelineId, tx))!;
      await this.audit.record(
        {
          workspaceId: user.workspaceId,
          actorId: user.id,
          actorLabel: user.name,
          action: 'stage.reordered',
          entityType: 'pipeline',
          entityId: pipelineId,
          summary: `Reordered stages in "${pipeline.name}".`,
          before: pipeline.stages,
          after: after.stages,
          ip,
        },
        tx,
      );
      return after;
    });
  }

  /** Stage deletion requires a destination so no opportunity is left without a stage (F2.5). */
  async deleteStage(
    user: SessionUser,
    pipelineId: string,
    stageId: string,
    moveToStageId: string,
    ip?: string,
  ): Promise<{ movedOpportunities: number }> {
    return this.prisma.runInTransaction(async (tx) => {
      const stage = await this.repository.findStage(user.workspaceId, stageId, tx);
      if (!stage || stage.pipelineId !== pipelineId) {
        throw notFound('stage');
      }
      if (stageId === moveToStageId) {
        throw businessRule(
          'Pick a different stage to move the opportunities to.',
          'Choose another stage from the same pipeline.',
        );
      }
      const target = await this.repository.findStage(user.workspaceId, moveToStageId, tx);
      if (!target || target.pipelineId !== pipelineId) {
        throw notFound('destination stage');
      }

      const moved = await this.repository.moveOpportunitiesToStage(
        user.workspaceId,
        stageId,
        moveToStageId,
        tx,
      );
      await this.repository.deleteStage(user.workspaceId, stageId, tx);
      await this.audit.record(
        {
          workspaceId: user.workspaceId,
          actorId: user.id,
          actorLabel: user.name,
          action: 'stage.deleted',
          entityType: 'pipeline_stage',
          entityId: stageId,
          summary: `Deleted stage "${stage.name}", moving ${moved} opportunit${moved === 1 ? 'y' : 'ies'} to "${target.name}".`,
          before: stage,
          after: target,
          ip,
        },
        tx,
      );
      return { movedOpportunities: moved };
    });
  }
}
