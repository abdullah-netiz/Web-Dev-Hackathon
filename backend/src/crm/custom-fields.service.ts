import { Injectable, NotFoundException } from '@nestjs/common';
import type { CustomFieldDefinition, CustomFieldEntity, CustomFieldType } from '@prisma/client';
import { z, type ZodType } from 'zod';

import { AuditService } from '../audit/audit.service';
import { actorLabel, type AuthContext } from '../auth/auth.types';
import { DomainError } from '../common/http-exception.filter';
import { PrismaService } from '../common/prisma.service';

/**
 * Metadata-driven custom fields (F2.2, F2.3). Definitions are per workspace and entity; OPPORTUNITY
 * fields may be scoped to one pipeline. Values live in the entity's `custom` JSONB and are validated
 * server-side against the definitions on every write (Q3).
 */
@Injectable()
export class CustomFieldsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(workspaceId: string, entity?: CustomFieldEntity, includeArchived = false) {
    return this.prisma.customFieldDefinition.findMany({
      where: { workspaceId, ...(entity ? { entity } : {}), ...(includeArchived ? {} : { isArchived: false }) },
      orderBy: [{ entity: 'asc' }, { order: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async create(auth: AuthContext, input: { entity: CustomFieldEntity; label: string; type: CustomFieldType; options?: string[]; pipelineId?: string | null; isRequired?: boolean }) {
    const key = toKey(input.label);
    if (input.type === 'DROPDOWN' && !(input.options && input.options.length > 0)) {
      throw new DomainError('OPTIONS_REQUIRED', 'A dropdown field needs at least one option.', 422, 'Add options and try again.');
    }
    if (input.pipelineId) {
      const pipeline = await this.prisma.pipeline.findFirst({ where: { id: input.pipelineId, workspaceId: auth.workspaceId } });
      if (!pipeline) throw new NotFoundException({ code: 'PIPELINE_NOT_FOUND', message: 'Pipeline not found.' });
      if (input.entity !== 'OPPORTUNITY') throw new DomainError('PIPELINE_SCOPE_INVALID', 'Only opportunity fields can be scoped to a pipeline.', 422);
    }
    const existing = await this.prisma.customFieldDefinition.findUnique({ where: { workspaceId_entity_key: { workspaceId: auth.workspaceId, entity: input.entity, key } } });
    if (existing) throw new DomainError('FIELD_EXISTS', `A field with key "${key}" already exists for ${input.entity.toLowerCase()}.`, 409, 'Choose another label.');
    const order = await this.prisma.customFieldDefinition.count({ where: { workspaceId: auth.workspaceId, entity: input.entity } });

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.customFieldDefinition.create({
        data: { workspaceId: auth.workspaceId, entity: input.entity, key, label: input.label, type: input.type, options: input.options ?? [], pipelineId: input.pipelineId ?? null, isRequired: input.isRequired ?? false, order },
      });
      await this.audit.recordTx(tx, {
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        actorLabel: actorLabel(auth),
        action: 'field.created',
        targetType: 'customField',
        targetId: created.id,
        after: { entity: created.entity, key, label: created.label, type: created.type, options: created.options, pipelineId: created.pipelineId },
      });
      return created;
    });
  }

  async update(auth: AuthContext, id: string, input: Partial<{ label: string; options: string[]; isRequired: boolean; order: number; version: number }>) {
    const before = await this.getOrThrow(auth.workspaceId, id);
    const { version, ...data } = input;
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.customFieldDefinition.updateMany({ where: { id, workspaceId: auth.workspaceId, ...(version ? { version } : {}) }, data: { ...data, version: { increment: 1 } } });
      if (result.count === 0) throw new DomainError('VERSION_CONFLICT', 'This field was changed by someone else. Reload and try again.', 409);
      const after = await tx.customFieldDefinition.findUniqueOrThrow({ where: { id } });
      await this.audit.recordTx(tx, {
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        actorLabel: actorLabel(auth),
        action: 'field.updated',
        targetType: 'customField',
        targetId: id,
        before: { label: before.label, options: before.options, isRequired: before.isRequired },
        after: { label: after.label, options: after.options, isRequired: after.isRequired },
      });
      return after;
    });
  }

  /** Archiving keeps stored values readable and avoids orphaned data (Q4). */
  async archive(auth: AuthContext, id: string) {
    const before = await this.getOrThrow(auth.workspaceId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.customFieldDefinition.update({ where: { id }, data: { isArchived: true } });
      await tx.pipelineStage.updateMany({ where: { workspaceId: auth.workspaceId, requiredFieldKeys: { has: before.key } }, data: { requiredFieldKeys: { set: [] } } });
      await this.audit.recordTx(tx, {
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        actorLabel: actorLabel(auth),
        action: 'field.archived',
        targetType: 'customField',
        targetId: id,
        before: { key: before.key, label: before.label, isArchived: false },
        after: { isArchived: true },
      });
    });
    return { archived: true };
  }

  /** Builds the Zod schema for an entity's custom values; unknown keys are rejected (Q3). */
  async schemaFor(workspaceId: string, entity: CustomFieldEntity, pipelineId?: string | null, partial = false): Promise<{ schema: ZodType; definitions: CustomFieldDefinition[] }> {
    const definitions = await this.prisma.customFieldDefinition.findMany({
      where: { workspaceId, entity, isArchived: false, ...(entity === 'OPPORTUNITY' ? { OR: [{ pipelineId: null }, { pipelineId: pipelineId ?? undefined }] } : {}) },
    });
    const shape: Record<string, ZodType> = {};
    for (const definition of definitions) {
      let field: ZodType = fieldSchema(definition);
      if (!definition.isRequired || partial) field = field.nullable().optional();
      shape[definition.key] = field;
    }
    return { schema: z.strictObject(shape), definitions };
  }

  /** Validates and normalises `custom` for a write; merges with existing values on partial updates. */
  async validateCustom(workspaceId: string, entity: CustomFieldEntity, custom: unknown, options: { pipelineId?: string | null; existing?: Record<string, unknown>; partial?: boolean } = {}) {
    const { schema, definitions } = await this.schemaFor(workspaceId, entity, options.pipelineId, options.partial ?? Boolean(options.existing));
    const merged = { ...(options.existing ?? {}), ...((custom as Record<string, unknown>) ?? {}) };
    // Values of archived fields are kept untouched
    const activeKeys = new Set(definitions.map((definition) => definition.key));
    const activeValues = Object.fromEntries(Object.entries(merged).filter(([key]) => activeKeys.has(key)));
    const result = schema.safeParse(activeValues);
    if (!result.success) {
      throw new DomainError('CUSTOM_FIELDS_INVALID', 'Some custom fields are invalid: ' + result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '), 422, 'Fix the fields and try again.');
    }
    const archivedValues = Object.fromEntries(Object.entries(merged).filter(([key]) => !activeKeys.has(key)));
    return { ...archivedValues, ...(result.data as Record<string, unknown>) };
  }

  private async getOrThrow(workspaceId: string, id: string) {
    const definition = await this.prisma.customFieldDefinition.findFirst({ where: { id, workspaceId } });
    if (!definition) throw new NotFoundException({ code: 'FIELD_NOT_FOUND', message: 'Custom field not found.' });
    return definition;
  }
}

function fieldSchema(definition: CustomFieldDefinition): ZodType {
  switch (definition.type) {
    case 'TEXT':
      return z.string().max(2000);
    case 'NUMBER':
      return z.number().finite();
    case 'DATE':
      return z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
    case 'DROPDOWN':
      return z.enum(definition.options as [string, ...string[]]);
    case 'CHECKBOX':
      return z.boolean();
    default:
      return z.unknown();
  }
}

export function toKey(label: string): string {
  const key = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  if (!key) throw new DomainError('INVALID_LABEL', 'Field label must contain letters or digits.', 422);
  return /^[0-9]/.test(key) ? `f_${key}` : key;
}
