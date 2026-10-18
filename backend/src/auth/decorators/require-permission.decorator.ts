import { SetMetadata } from '@nestjs/common';

export const PERMISSION_KEY = 'auth:permission';

/** Declares the permissions a handler requires; enforced by PermissionGuard (F1.5). */
export const RequirePermission = (...permissions: string[]) =>
  SetMetadata(PERMISSION_KEY, permissions);
