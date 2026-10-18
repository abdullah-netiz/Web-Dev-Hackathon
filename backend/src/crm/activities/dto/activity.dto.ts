import { z } from 'zod';
import { optionalString } from '../../../common/zod';

export const activityEntitySchema = z.enum([
  'CONTACT',
  'COMPANY',
  'OPPORTUNITY',
  'LEAD',
  'CONVERSATION',
]);

export const activityTypeSchema = z.enum([
  'NOTE',
  'CALL',
  'EMAIL',
  'MEETING',
  'STAGE_CHANGE',
  'FIELD_EDIT',
  'ASSIGNMENT',
  'ACKNOWLEDGEMENT',
  'ESCALATION',
  'MESSAGE',
  'PAYMENT',
  'APPOINTMENT',
  'SYSTEM',
]);

export const createActivitySchema = z.object({
  entityType: activityEntitySchema,
  entityId: z.string().min(1).max(40),
  type: activityTypeSchema,
  title: z.string().min(1).max(200),
  body: optionalString(5000),
  meta: z.record(z.string().min(1).max(60), z.unknown()).optional(),
});

export const listActivitiesSchema = z.object({
  entityType: activityEntitySchema.optional(),
  entityId: optionalString(40),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).optional(),
});

export type CreateActivityInput = z.infer<typeof createActivitySchema>;
