import type { Role, User } from '@prisma/client';
import { resolveEffectivePermissions } from '../common/permissions';
import type { SessionUserProfile } from './types/session-user';

export function toSessionUser(user: User & { role: Role | null }): SessionUserProfile {
  return {
    id: user.id,
    workspaceId: user.workspaceId,
    email: user.email,
    name: user.name,
    baseLevel: user.baseLevel,
    availability: user.availability,
    roleId: user.roleId,
    roleName: user.role?.name ?? null,
    permissions: resolveEffectivePermissions(user.baseLevel, user.role?.permissions ?? []),
  };
}
