import { z } from 'zod';
import { listQuerySchema } from '../../common/pagination';
import { optionalEmail, optionalString, versionSchema } from '../../common/zod';

export const leadSourceSchema = z.enum(['WEB_FORM', 'WHATSAPP', 'SMS', 'MANUAL', 'CALL']);
export const leadStatusSchema = z.enum(['NEW', 'ASSIGNED', 'ACKNOWLEDGED', 'CLOSED']);
export const availabilitySchema = z.enum(['AVAILABLE', 'BUSY', 'ON_LEAVE', 'OFFLINE']);

const reachable = (value: { phone?: string; email?: string; contactId?: string }) =>
  Boolean(value.phone || value.email || value.contactId);

export const createLeadSchema = z
  .object({
    name: z.string().min(1).max(200),
    phone: optionalString(40),
    email: optionalEmail(),
    message: optionalString(5000),
    contactId: optionalString(40),
    source: leadSourceSchema.default('MANUAL'),
    ownerId: optionalString(40),
  })
  .refine(reachable, {
    message: 'Provide a phone number, an email or a linked contact.',
    path: ['phone'],
  });

export const publicIntakeSchema = z
  .object({
    name: z.string().min(1).max(200),
    phone: optionalString(40),
    email: optionalEmail(),
    message: optionalString(5000),
  })
  .refine((value) => Boolean(value.phone || value.email), {
    message: 'Provide a phone number or an email so we can reach you.',
    path: ['phone'],
  });

export const updateLeadSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  phone: optionalString(40),
  email: optionalEmail(),
  message: optionalString(5000),
  contactId: optionalString(40),
  version: versionSchema,
});

export const assignLeadSchema = z.object({ ownerId: z.string().min(1).max(40) });

export const listLeadsSchema = listQuerySchema.extend({
  status: leadStatusSchema.optional(),
  ownerId: optionalString(40),
  unassigned: z.enum(['true', 'false']).optional(),
});

export const updateLeadSettingsSchema = z.object({
  ackWindowSec: z.coerce.number().int().min(30).max(86_400).optional(),
  escalationLevels: z.coerce.number().int().min(1).max(10).optional(),
  idlePeriodSec: z.coerce.number().int().min(300).max(7_776_000).optional(),
  maxOpenLeads: z.coerce.number().int().min(1).max(100).optional(),
  acknowledgedOnLeavePolicy: z.enum(['keep', 'reassign']).optional(),
  version: versionSchema,
});

export const publicIntakeQuerySchema = z.object({ workspace: z.string().min(1).max(60) });

export const updateAvailabilitySchema = z.object({ availability: availabilitySchema });

export type CreateLeadInput = z.infer<typeof createLeadSchema>;
export type PublicIntakeInput = z.infer<typeof publicIntakeSchema>;
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;
export type UpdateLeadSettingsInput = z.infer<typeof updateLeadSettingsSchema>;
