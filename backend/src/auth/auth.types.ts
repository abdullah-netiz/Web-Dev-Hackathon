import type { BaseLevel } from '@prisma/client';

import type { Permission } from './permissions';

/** Attached to every authenticated request by AuthGuard; the only source of workspaceId for queries. */
export type AuthContext = {
  userId: string;
  workspaceId: string;
  sessionId: string;
  email: string;
  name: string;
  baseLevel: BaseLevel;
  roleName: string | null;
  permissions: Set<Permission>;
};

export function hasPermission(auth: AuthContext, permission: Permission): boolean {
  if (auth.baseLevel === 'OWNER' || auth.baseLevel === 'ADMIN') return true;
  return auth.permissions.has(permission);
}

export function actorLabel(auth: AuthContext | null): string {
  return auth ? `${auth.name} <${auth.email}>` : 'system';
}
