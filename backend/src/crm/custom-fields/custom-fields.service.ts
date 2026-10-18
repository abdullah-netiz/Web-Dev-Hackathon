import { Injectable } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import type { SessionUser } from '../../auth/types/session-user';
import { invalidRequest, notFound, versionConflict } from '../../common/http-errors';
import { PrismaService } from '../../common/prisma.service';
import {
  CustomFieldsRepository,
  type CustomFieldRow,
} from './custom-fields.repository';
import type {
  CreateCustomFieldInput,
  UpdateCustomFieldInput,
} from './dto/custom-field.dto';

@Injectable()
export class CustomFieldsService {
  constructor(
    private readonly repository: CustomFieldsRepository,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  list(
    workspaceId: string,
    args: { entity?: CustomFieldRow['entity']; includeArchived?: boolean },
  ) {
    return this.repository.list(workspaceId, {
      entity: args.entity,
      includeArchived: args.includeArchived ?? false,
    });
  }

  async create(
    user: SessionUser,
    input: CreateCustomFieldInput,
    ip?: string,
  ): Promise<CustomFieldRow> {
    if (input.type === 'SELECT' && input.options.length === 0) {
      throw invalidRequest(
        'A dropdown field needs at least one option.',
        'Add the options the dropdown should offer.',
      );
    }
    return this.prisma.runInTransaction(async (tx) => {
      if (input.pipelineId) {
        const pipeline = await tx.pipeline.findFirst({
          where: { id: input.pipelineId, workspaceId: user.workspaceId },
          select: { id: true, name: true },
        });
        if (!pipeline) {
          throw notFound('pipeline');
        }
      }
      const field = await this.repository.create(user.workspaceId, input, tx);
      await this.audit.record(
        {
          workspaceId: user.workspaceId,
          actorId: user.id,
          actorLabel: user.name,
          action: 'field.created',
          entityType: 'custom_field_definition',
          entityId: field.id,
          summary: `Added ${field.entity.toLowerCase()} field "${field.label}".`,
          after: field,
          ip,
        },
        tx,
      );
      return field;
    });
  }

  async update(
    user: SessionUser,
    id: string,
    input: UpdateCustomFieldInput,
    ip?: string,
  ): Promise<CustomFieldRow> {
    const { version, ...changes } = input;
    if (changes.type === 'SELECT' && (changes.options?.length ?? 0) === 0) {
      throw invalidRequest(
        'A dropdown field needs at least one option.',
        'Add the options the dropdown should offer.',
      );
    }
    return this.prisma.runInTransaction(async (tx) => {
      const before = await this.repository.findById(user.workspaceId, id, tx);
      if (!before) {
        throw notFound('custom field');
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
          action: 'field.updated',
          entityType: 'custom_field_definition',
          entityId: id,
          summary: `Updated field "${after.label}".`,
          before,
          after,
          ip,
        },
        tx,
      );
      return after;
    });
  }

  async archive(user: SessionUser, id: string, ip?: string): Promise<void> {
    await this.prisma.runInTransaction(async (tx) => {
      const before = await this.repository.findById(user.workspaceId, id, tx);
      if (!before) {
        throw notFound('custom field');
      }
      const archived = await this.repository.archive(user.workspaceId, id, tx);
      if (archived === 0) {
        throw versionConflict();
      }
      await this.audit.record(
        {
          workspaceId: user.workspaceId,
          actorId: user.id,
          actorLabel: user.name,
          action: 'field.archived',
          entityType: 'custom_field_definition',
          entityId: id,
          summary: `Archived field "${before.label}".`,
          before,
          ip,
        },
        tx,
      );
    });
  }
}
