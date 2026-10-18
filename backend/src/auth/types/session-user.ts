import type { Availability, BaseLevel } from '@prisma/client';

/** What a request carries once the session is resolved. Never contains passwordHash. */
export interface SessionUser {
  id: string;
  workspaceId: string;
  email: string;
  name: string;
  baseLevel: BaseLevel;
  availability: Availability;
  roleId: string | null;
  roleName: string | null;
  permissions: string[];
  sessionId: string;
}

export type SessionUserProfile = Omit<SessionUser, 'sessionId'>;

export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  user?: SessionUser;
}
