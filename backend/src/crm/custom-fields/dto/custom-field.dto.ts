import { z } from 'zod';
import { optionalString, versionSchema } from '../../../common/zod';

export const customFieldTypeSchema = z.enum(['TEXT', 'NUMBER', 'DATE', 'SELECT', 'CHECKBOX']);
export const customFieldEntitySchema = z.enum(['CONTACT', 'COMPANY', 'OPPORTUNITY']);

export const createCustomFieldSchema = z.object({
  entity: customFieldEntitySchema,
  key: z.string().regex(/^[a-z][a-z0-9_]{0,59}$/, 'use lower_snake_case'),
  label: z.string().min(1).max(120),
  type: customFieldTypeSchema,
  options: z.array(z.string().min(1).max(80)).max(50).default([]),
  required: z.boolean().default(false),
  pipelineId: optionalString(40),
  order: z.coerce.number().int().min(0).default(0),
});

export const updateCustomFieldSchema = z.object({
  label: z.string().min(1).max(120).optional(),
  type: customFieldTypeSchema.optional(),
  options: z.array(z.string().min(1).max(80)).max(50).optional(),
  required: z.boolean().optional(),
  order: z.coerce.number().int().min(0).optional(),
  version: versionSchema,
});

export const listCustomFieldsSchema = z.object({
  entity: customFieldEntitySchema.optional(),
  includeArchived: z.enum(['true', 'false']).optional(),
});

export type CreateCustomFieldInput = z.infer<typeof createCustomFieldSchema>;
export type UpdateCustomFieldInput = z.infer<typeof updateCustomFieldSchema>;
