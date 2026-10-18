import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../../audit/audit.service';
import type { SessionUser } from '../../auth/types/session-user';
import { businessRule, notFound, versionConflict } from '../../common/http-errors';
import { keysetArgs, paginatedResponse, type ListQuery } from '../../common/pagination';
import { PrismaService } from '../../common/prisma.service';
import {
  OpportunitiesRepository,
  type OpportunityRow,
  type OpportunityWriteData,
} from './opportunities.repository';
import type {
  CreateOpportunityInput,
  UpdateOpportunityInput,
} from './dto/opportunity.dto';

interface Stage {
  id: string;
  name: string;
  pipelineId: string;
  requiredFieldKeys: string[];
}

@Injectable()
export class OpportunitiesService {
  constructor(
    private readonly repository: OpportunitiesRepository,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  async list(
    workspaceId: string,
    query: ListQuery,
    filters: { stageId?: string; ownerId?: string } = {},
  ) {
    const rows = await this.repository.list(workspaceId, {
      ...keysetArgs(query),
      search: query.q,
      stageId: filters.stageId,
      ownerId: filters.ownerId,
    });
    return paginatedResponse(rows, query.limit);
  }

  async get(workspaceId: string, id: string): Promise<OpportunityRow> {
    const opportunity = await this.repository.findById(workspaceId, id);
    if (!opportunity) {
      throw notFound('opportunity');
    }
    return opportunity;
  }

  async create(
    user: SessionUser,
    input: CreateOpportunityInput,
    ip?: string,
  ): Promise<OpportunityRow> {
    return this.prisma.runInTransaction(async (tx) => {
      const pipelineId =
        input.pipelineId ?? (await this.repository.findDefaultPipelineId(user.workspaceId));
      if (!pipelineId) {
        throw businessRule(
          'No pipeline exists yet in this workspace.',
          'Create a pipeline before adding opportunities.',
        );
      }

      const stage = await this.resolveStage(user.workspaceId, pipelineId, input.stageId ?? null);
      await this.assertReferences(user.workspaceId, input, tx);
      assertRequiredFields(stage, input.custom ?? {});

      const opportunity = await this.repository.create(
        user.workspaceId,
        {
          ...toWriteData(input),
          name: input.name,
          pipelineId,
          stageId: stage.id,
        },
        tx,
      );

      await this.audit.record(
        {
          workspaceId: user.workspaceId,
          actorId: user.id,
          actorLabel: user.name,
          action: 'opportunity.created',
          entityType: 'opportunity',
          entityId: opportunity.id,
          summary: `Created opportunity "${opportunity.name}".`,
          after: opportunity,
          ip,
        },
        tx,
      );
      return opportunity;
    });
  }

  async update(
    user: SessionUser,
    id: string,
    input: UpdateOpportunityInput,
    ip?: string,
  ): Promise<OpportunityRow> {
    const { version, ...changes } = input;
    return this.prisma.runInTransaction(async (tx) => {
      const before = await this.repository.findById(user.workspaceId, id, tx);
      if (!before) {
        throw notFound('opportunity');
      }
      await this.assertReferences(user.workspaceId, changes, tx);

      const pipelineId = changes.pipelineId ?? before.pipelineId;
      let stage: Stage | null = null;
      if (changes.stageId || changes.pipelineId) {
        stage = await this.resolveStage(
          user.workspaceId,
          pipelineId,
          changes.stageId ?? null,
        );
        assertRequiredFields(stage, mergeCustom(before.custom, changes.custom));
      }

      const changed = await this.repository.updateWithVersion(
        user.workspaceId,
        id,
        version,
        {
          ...toWriteData(changes),
          ...(changes.pipelineId ? { pipelineId } : {}),
          ...(stage ? { stageId: stage.id } : {}),
        },
        tx,
      );
      if (changed === 0) {
        throw versionConflict();
      }

      const after = (await this.repository.findById(user.workspaceId, id, tx))!;
      const movedStage = before.stageId !== after.stageId;
      await this.audit.record(
        {
          workspaceId: user.workspaceId,
          actorId: user.id,
          actorLabel: user.name,
          action: movedStage ? 'opportunity.stage_changed' : 'opportunity.updated',
          entityType: 'opportunity',
          entityId: id,
          summary: movedStage
            ? `Moved opportunity "${after.name}" from ${before.stage.name} to ${after.stage.name}.`
            : `Updated opportunity "${after.name}".`,
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
        throw notFound('opportunity');
      }
      await this.repository.delete(user.workspaceId, id, tx);
      await this.audit.record(
        {
          workspaceId: user.workspaceId,
          actorId: user.id,
          actorLabel: user.name,
          action: 'opportunity.deleted',
          entityType: 'opportunity',
          entityId: id,
          summary: `Deleted opportunity "${before.name}".`,
          before,
          ip,
        },
        tx,
      );
    });
  }

  private async resolveStage(
    workspaceId: string,
    pipelineId: string,
    stageId: string | null,
  ): Promise<Stage> {
    if (stageId) {
      const stage = await this.repository.findStage(workspaceId, stageId);
      if (!stage) {
        throw notFound('stage');
      }
      if (stage.pipelineId !== pipelineId) {
        throw businessRule(
          'That stage belongs to a different pipeline.',
          'Pick a stage from the opportunity’s pipeline.',
        );
      }
      return stage;
    }

    const first = await this.repository.findFirstStage(workspaceId, pipelineId);
    if (!first) {
      throw businessRule(
        'That pipeline has no stages yet.',
        'Add a stage to the pipeline before adding opportunities.',
      );
    }
    return first;
  }

  private async assertReferences(
    workspaceId: string,
    input: Partial<CreateOpportunityInput>,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    const checks: Array<[string | undefined, 'company' | 'contact' | 'user']> = [
      [input.companyId, 'company'],
      [input.contactId, 'contact'],
      [input.ownerId, 'user'],
    ];
    for (const [id, kind] of checks) {
      if (!id) {
        continue;
      }
      const found =
        kind === 'company'
          ? await client.company.findFirst({ where: { id, workspaceId }, select: { id: true } })
          : kind === 'contact'
            ? await client.contact.findFirst({ where: { id, workspaceId }, select: { id: true } })
            : await client.user.findFirst({ where: { id, workspaceId }, select: { id: true } });
      if (!found) {
        throw businessRule(
          `That ${kind} does not exist in this workspace.`,
          `Pick a ${kind} from this workspace.`,
        );
      }
    }
  }
}

/** Moving to a stage that declares required fields needs those fields filled (§F2.1). */
function assertRequiredFields(stage: Stage, custom: Record<string, unknown>): void {
  const missing = stage.requiredFieldKeys.filter((key) => {
    const value = custom[key];
    return value === undefined || value === null || value === '';
  });
  if (missing.length > 0) {
    throw businessRule(
      `The stage "${stage.name}" requires these fields: ${missing.join(', ')}.`,
      'Fill in the required fields before moving to this stage.',
    );
  }
}

function mergeCustom(
  existing: Prisma.JsonValue,
  incoming: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const base =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};
  return { ...base, ...(incoming ?? {}) };
}

function toWriteData(input: Partial<CreateOpportunityInput>): OpportunityWriteData {
  return {
    name: input.name,
    companyId: input.companyId,
    contactId: input.contactId,
    ownerId: input.ownerId,
    value: input.value,
    currency: input.currency,
    closeDate: input.closeDate,
    description: input.description,
    custom: input.custom as Prisma.InputJsonValue | undefined,
  };
}
