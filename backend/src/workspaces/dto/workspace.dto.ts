import { z } from 'zod';
import { optionalString, versionSchema } from '../../common/zod';

export const signupSchema = z.object({
  workspaceName: z.string().trim().min(2).max(80),
  name: z.string().trim().min(1).max(80),
  email: z.email().max(200),
  password: z.string().min(8).max(200),
});

export const updateWorkspaceSchema = z.object({
  name: optionalString(80),
  ackWindowSec: z.coerce.number().int().min(30).max(86_400).optional(),
  escalationLevels: z.coerce.number().int().min(1).max(5).optional(),
  idlePeriodSec: z.coerce.number().int().min(300).max(604_800).optional(),
  maxOpenLeads: z.coerce.number().int().min(1).max(100).optional(),
  acknowledgedOnLeavePolicy: z.enum(['keep', 'reassign']).optional(),
  version: versionSchema,
});

export type SignupInput = z.infer<typeof signupSchema>;
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;
