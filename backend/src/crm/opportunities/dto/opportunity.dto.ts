import { z } from 'zod';
import {
  customFieldsSchema,
  optionalString,
  versionSchema,
} from '../../../common/zod';

export const createOpportunitySchema = z.object({
  name: z.string().min(1).max(200),
  companyId: optionalString(40),
  contactId: optionalString(40),
  pipelineId: optionalString(40),
  stageId: optionalString(40),
  ownerId: optionalString(40),
  value: z.coerce.number().nonnegative().max(1_000_000_000_000).optional(),
  currency: z.string().length(3).default('USD'),
  closeDate: z.coerce.date().optional(),
  description: optionalString(5000),
  custom: customFieldsSchema,
});

export const updateOpportunitySchema = createOpportunitySchema.partial().extend({
  version: versionSchema,
});

export type CreateOpportunityInput = z.infer<typeof createOpportunitySchema>;
export type UpdateOpportunityInput = z.infer<typeof updateOpportunitySchema>;
