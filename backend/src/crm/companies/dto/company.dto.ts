import { z } from 'zod';
import { customFieldsSchema, optionalString, tagsSchema, versionSchema } from '../../../common/zod';

export const createCompanySchema = z.object({
  name: z.string().min(1).max(200),
  domain: optionalString(200),
  phone: optionalString(40),
  address: optionalString(500),
  notes: optionalString(5000),
  tags: tagsSchema,
  custom: customFieldsSchema,
});

export const updateCompanySchema = createCompanySchema.partial().extend({
  version: versionSchema,
});

export type CreateCompanyInput = z.infer<typeof createCompanySchema>;
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;
