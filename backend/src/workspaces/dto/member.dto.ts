import { z } from 'zod';
import { listQuerySchema } from '../../common/pagination';
import { optionalString, versionSchema } from '../../common/zod';
import { availabilitySchema } from '../../leads/dto/lead.dto';

const nullableId = z.union([z.string().min(1).max(40), z.null()]);
const nullableText = z.union([z.string().trim().min(1).max(40), z.null()]);

/** A member can be invited as Admin or User; ownership is transferred, never invited (F1.2). */
export const inviteMemberSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.email().max(200),
  password: z.string().min(8).max(200),
  baseLevel: z.enum(['ADMIN', 'USER']).default('USER'),
  roleId: z.string().min(1).max(40).optional(),
  availability: availabilitySchema.optional(),
});

export const updateMemberSchema = z.object({
  name: optionalString(80),
  baseLevel: z.enum(['OWNER', 'ADMIN', 'USER']).optional(),
  roleId: nullableId.optional(),
  telegramChatId: nullableText.optional(),
  availability: availabilitySchema.optional(),
  version: versionSchema,
});

export const listMembersSchema = listQuerySchema.extend({
  baseLevel: z.enum(['OWNER', 'ADMIN', 'USER']).optional(),
  availability: availabilitySchema.optional(),
  roleId: optionalString(40),
  includeInactive: z.coerce.boolean().default(false),
});

export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
