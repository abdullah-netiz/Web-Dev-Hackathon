import { z } from 'zod';
import { isPermissionKey } from '../../common/permissions';
import { optionalString, versionSchema } from '../../common/zod';

/** Role permissions must be known catalogue keys; an unknown key is rejected, never silently dropped (F1.3). */
export const permissionKeysSchema = z
  .array(z.string().min(1).max(60))
  .max(50)
  .superRefine((keys, ctx) => {
    const unknown = keys.filter((key) => !isPermissionKey(key));
    if (unknown.length > 0) {
      ctx.addIssue({
        code: 'custom',
        message: `Unknown permission key(s): ${unknown.join(', ')}.`,
      });
    }
  });

export const createRoleSchema = z.object({
  name: z.string().trim().min(1).max(60),
  permissions: permissionKeysSchema.default([]),
});

export const updateRoleSchema = z.object({
  name: optionalString(60),
  permissions: permissionKeysSchema.optional(),
  version: versionSchema,
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
