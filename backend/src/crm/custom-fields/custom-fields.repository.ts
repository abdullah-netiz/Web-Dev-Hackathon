import { Injectable } from '@nestjs/common';
import type { CustomFieldEntity, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

export const CUSTOM_FIELD_SELECT = {
  id: true,
  workspaceId: true,
  entity: true,
  key: true,
  label: true,
  type: true,
  options: true,
  required: true,
  pipelineId: true,
  isArchived: true,
  order: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CustomFieldDefinitionSelect;

export type CustomFieldRow = Prisma.CustomFieldDefinitionGetPayload<{
  select: typeof CUSTOM_FIELD_SELECT;
}>;

export interface CustomFieldListArgs {
  entity?: CustomFieldEntity;
  includeArchived: boolean;
}

export interface CustomFieldWriteData {
  label?: string;
  type?: 'TEXT' | 'NUMBER' | 'DATE' | 'SELECT' | 'CHECKBOX';
  options?: string[];
  required?: boolean;
  pipelineId?: string | null;
  order?: number;
}

@Injectable()
export class CustomFieldsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(workspaceId: string, args: CustomFieldListArgs): Promise<CustomFieldRow[]> {
    return this.prisma.customFieldDefinition.findMany({
      where: {
        workspaceId,
        ...(args.entity ? { entity: args.entity } : {}),
        ...(args.includeArchived ? {} : { isArchived: false }),
      },
      orderBy: [{ entity: 'asc' }, { order: 'asc' }, { createdAt: 'asc' }],
      select: CUSTOM_FIELD_SELECT,
    });
  }

  async findById(
    workspaceId: string,
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<CustomFieldRow | null> {
    return (tx ?? this.prisma).customFieldDefinition.findFirst({
      where: { id, workspaceId },
      select: CUSTOM_FIELD_SELECT,
    });
  }

  async create(
    workspaceId: string,
    data: Omit<Prisma.CustomFieldDefinitionUncheckedCreateInput, 'workspaceId'>,
    tx?: Prisma.TransactionClient,
  ): Promise<CustomFieldRow> {
    const { id } = await (tx ?? this.prisma).customFieldDefinition.create({
      data: { ...data, workspaceId },
      select: { id: true },
    });
    return (await this.findById(workspaceId, id, tx))!;
  }

  async updateWithVersion(
    workspaceId: string,
    id: string,
    version: number,
    data: CustomFieldWriteData,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await (tx ?? this.prisma).customFieldDefinition.updateMany({
      where: { id, workspaceId, version },
      data: { ...data, version: { increment: 1 } },
    });
    return result.count;
  }

  /** Field deletion archives so existing JSONB values stay readable (F2.5). */
  async archive(workspaceId: string, id: string, tx?: Prisma.TransactionClient): Promise<number> {
    const result = await (tx ?? this.prisma).customFieldDefinition.updateMany({
      where: { id, workspaceId, isArchived: false },
      data: { isArchived: true, version: { increment: 1 } },
    });
    return result.count;
  }
}
