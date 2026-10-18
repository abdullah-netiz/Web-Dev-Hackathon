import { z } from 'zod';
import { optionalString, versionSchema } from '../../../common/zod';

export const createPipelineSchema = z.object({
  name: z.string().min(1).max(120),
  isDefault: z.boolean().default(false),
});

export const updatePipelineSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  isDefault: z.boolean().optional(),
  version: versionSchema,
});

export const createStageSchema = z.object({
  name: z.string().min(1).max(120),
  order: z.coerce.number().int().min(0).optional(),
  isWon: z.boolean().default(false),
  isLost: z.boolean().default(false),
  requiredFieldKeys: z.array(z.string().min(1).max(60)).max(30).default([]),
});

export const updateStageSchema = createStageSchema.partial().extend({
  version: versionSchema,
});

export const reorderStagesSchema = z.object({
  stageIds: z.array(z.string().min(1).max(40)).min(1).max(50),
});

export const deleteStageSchema = z.object({
  moveToStageId: z.string().min(1).max(40),
});

export const stageParamsSchema = z.object({
  id: z.string().min(1).max(40),
  stageId: z.string().min(1).max(40),
});

export const listPipelinesSchema = z.object({ includeArchived: optionalString(5) });

export type CreatePipelineInput = z.infer<typeof createPipelineSchema>;
export type UpdatePipelineInput = z.infer<typeof updatePipelineSchema>;
export type CreateStageInput = z.infer<typeof createStageSchema>;
export type UpdateStageInput = z.infer<typeof updateStageSchema>;
