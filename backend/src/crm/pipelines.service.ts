import { Injectable, NotFoundException } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { actorLabel, type AuthContext } from '../auth/auth.types';
import { DomainError } from '../common/http-exception.filter';
import { PrismaService } from '../common/prisma.service';

/** Pipelines and stages (F2.5). Every structural change is audited (F4.1). */
@Injectable()
export class PipelinesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(workspaceId: string) {
    return this.prisma.pipeline.findMany({
      where: { workspaceId },
      include: { stages: { orderBy: { order: 'asc' }, include: { _count: { select: { opportunities: true } } } } },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async create(auth: AuthContext, input: { name: string; stages?: string[] }) {
    return this.prisma.$transaction(async (tx) => {
      const pipeline = await tx.pipeline.create({ data: { workspaceId: auth.workspaceId, name: input.name } });
      const names = input.stages?.length ? input.stages : ['New', 'In progress', 'Won', 'Lost'];
      await tx.pipelineStage.createMany({
        data: names.map((name, index) => ({ workspaceId: auth.workspaceId, pipelineId: pipeline.id, name, order: index, isWon: /^won$/i.test(name), isLost: /^lost$/i.test(name) })),
      });
      await this.audit.recordTx(tx, { workspaceId: auth.workspaceId, actorId: auth.userId, actorLabel: actorLabel(auth), action: 'pipeline.created', targetType: 'pipeline', targetId: pipeline.id, after: { name: pipeline.name, stages: names } });
      return tx.pipeline.findUniqueOrThrow({ where: { id: pipeline.id }, include: { stages: { orderBy: { order: 'asc' } } } });
    });
  }

  async addStage(auth: AuthContext, pipelineId: string, input: { name: string; isWon?: boolean; isLost?: boolean; requiredFieldKeys?: string[]; color?: string }) {
    await this.getPipeline(auth.workspaceId, pipelineId);
    const order = await this.prisma.pipelineStage.count({ where: { pipelineId } });
    return this.prisma.$transaction(async (tx) => {
      const stage = await tx.pipelineStage.create({ data: { workspaceId: auth.workspaceId, pipelineId, name: input.name, order, isWon: input.isWon ?? false, isLost: input.isLost ?? false, requiredFieldKeys: input.requiredFieldKeys ?? [], color: input.color } });
      await this.audit.recordTx(tx, { workspaceId: auth.workspaceId, actorId: auth.userId, actorLabel: actorLabel(auth), action: 'stage.created', targetType: 'stage', targetId: stage.id, after: { name: stage.name, order, requiredFieldKeys: stage.requiredFieldKeys } });
      return stage;
    });
  }

  async updateStage(auth: AuthContext, stageId: string, input: Partial<{ name: string; isWon: boolean; isLost: boolean; requiredFieldKeys: string[]; color: string; version: number }>) {
    const before = await this.getStage(auth.workspaceId, stageId);
    const { version, ...data } = input;
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.pipelineStage.updateMany({ where: { id: stageId, workspaceId: auth.workspaceId, ...(version ? { version } : {}) }, data: { ...data, version: { increment: 1 } } });
      if (result.count === 0) throw new DomainError('VERSION_CONFLICT', 'This stage was changed by someone else. Reload and try again.', 409);
      const after = await tx.pipelineStage.findUniqueOrThrow({ where: { id: stageId } });
      await this.audit.recordTx(tx, {
        workspaceId: auth.workspaceId, actorId: auth.userId, actorLabel: actorLabel(auth), action: 'stage.updated', targetType: 'stage', targetId: stageId,
        before: { name: before.name, isWon: before.isWon, isLost: before.isLost, requiredFieldKeys: before.requiredFieldKeys },
        after: { name: after.name, isWon: after.isWon, isLost: after.isLost, requiredFieldKeys: after.requiredFieldKeys },
      });
      return after;
    });
  }

  /** Reorder in one transaction: the full ordered list of stage ids for the pipeline. */
  async reorderStages(auth: AuthContext, pipelineId: string, stageIds: string[]) {
    const pipeline = await this.getPipeline(auth.workspaceId, pipelineId);
    const current = await this.prisma.pipelineStage.findMany({ where: { pipelineId }, orderBy: { order: 'asc' } });
    const currentIds = current.map((stage) => stage.id);
    if (stageIds.length !== currentIds.length || !stageIds.every((id) => currentIds.includes(id))) {
      throw new DomainError('STAGE_LIST_MISMATCH', 'The list must contain every stage of the pipeline exactly once.', 422, 'Reload the pipeline and try again.');
    }
    await this.prisma.$transaction(async (tx) => {
      // two passes avoid transient unique collisions if a unique(order) index is added later
      for (const [index, id] of stageIds.entries()) await tx.pipelineStage.update({ where: { id }, data: { order: 1000 + index } });
      for (const [index, id] of stageIds.entries()) await tx.pipelineStage.update({ where: { id }, data: { order: index } });
      await this.audit.recordTx(tx, { workspaceId: auth.workspaceId, actorId: auth.userId, actorLabel: actorLabel(auth), action: 'stage.reordered', targetType: 'pipeline', targetId: pipeline.id, before: currentIds, after: stageIds });
    });
    return this.prisma.pipelineStage.findMany({ where: { pipelineId }, orderBy: { order: 'asc' } });
  }

  /**
   * Deleting a stage that contains opportunities requires a target stage (F2.5, Q4). The FK is
   * RESTRICT, so a delete without moving them cannot succeed even by accident.
   */
  async deleteStage(auth: AuthContext, stageId: string, moveToStageId?: string) {
    const stage = await this.getStage(auth.workspaceId, stageId);
    const count = await this.prisma.opportunity.count({ where: { stageId } });
    if (count > 0 && !moveToStageId) {
      throw new DomainError('STAGE_NOT_EMPTY', `This stage holds ${count} opportunit${count === 1 ? 'y' : 'ies'}.`, 409, 'Choose a stage to move them to, then delete.');
    }
    if (moveToStageId) {
      const target = await this.getStage(auth.workspaceId, moveToStageId);
      if (target.pipelineId !== stage.pipelineId) throw new DomainError('STAGE_OTHER_PIPELINE', 'The target stage must belong to the same pipeline.', 422);
      if (target.id === stage.id) throw new DomainError('STAGE_SAME', 'Choose a different target stage.', 422);
    }
    const remaining = await this.prisma.pipelineStage.count({ where: { pipelineId: stage.pipelineId } });
    if (remaining <= 1) throw new DomainError('LAST_STAGE', 'A pipeline needs at least one stage.', 409);

    await this.prisma.$transaction(async (tx) => {
      if (count > 0 && moveToStageId) {
        const moved = await tx.opportunity.findMany({ where: { stageId }, select: { id: true } });
        await tx.opportunity.updateMany({ where: { stageId }, data: { stageId: moveToStageId, version: { increment: 1 } } });
        await tx.activity.createMany({
          data: moved.map((opportunity) => ({ workspaceId: auth.workspaceId, entityType: 'OPPORTUNITY' as const, entityId: opportunity.id, type: 'stage_change', actorId: auth.userId, payload: { fromStageId: stageId, toStageId: moveToStageId, reason: 'stage deleted' } })),
        });
      }
      await tx.pipelineStage.delete({ where: { id: stageId } });
      await this.audit.recordTx(tx, {
        workspaceId: auth.workspaceId, actorId: auth.userId, actorLabel: actorLabel(auth), action: 'stage.deleted', targetType: 'stage', targetId: stageId,
        before: { name: stage.name, pipelineId: stage.pipelineId, opportunitiesMoved: count, movedTo: moveToStageId ?? null }, after: null,
      });
    });
    return { deleted: true, moved: count };
  }

  async getPipeline(workspaceId: string, pipelineId: string) {
    const pipeline = await this.prisma.pipeline.findFirst({ where: { id: pipelineId, workspaceId } });
    if (!pipeline) throw new NotFoundException({ code: 'PIPELINE_NOT_FOUND', message: 'Pipeline not found.' });
    return pipeline;
  }

  async getStage(workspaceId: string, stageId: string) {
    const stage = await this.prisma.pipelineStage.findFirst({ where: { id: stageId, workspaceId } });
    if (!stage) throw new NotFoundException({ code: 'STAGE_NOT_FOUND', message: 'Stage not found.' });
    return stage;
  }

  async defaultPipeline(workspaceId: string) {
    const pipeline = await this.prisma.pipeline.findFirst({ where: { workspaceId }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }], include: { stages: { orderBy: { order: 'asc' } } } });
    if (!pipeline || pipeline.stages.length === 0) throw new DomainError('NO_PIPELINE', 'This workspace has no pipeline with stages yet.', 409, 'Create a pipeline in Settings first.');
    return pipeline;
  }
}
