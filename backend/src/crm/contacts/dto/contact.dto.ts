import { z } from 'zod';
import {
  customFieldsSchema,
  optionalEmail,
  optionalString,
  tagsSchema,
  versionSchema,
} from '../../../common/zod';

export const createContactSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: optionalString(100),
  email: optionalEmail(),
  phone: optionalString(40),
  companyId: optionalString(40),
  ownerId: optionalString(40),
  optedOut: z.boolean().default(false),
  tags: tagsSchema,
  custom: customFieldsSchema,
});

export const updateContactSchema = createContactSchema.partial().extend({
  version: versionSchema,
});

export type CreateContactInput = z.infer<typeof createContactSchema>;
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
