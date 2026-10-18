import type { Prisma } from '@prisma/client';

import { isManagerRole } from '../auth/permissions';

/** One serialized shape for a user everywhere it is returned (Q12): members list, session, assignment pickers. */
export const USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  baseLevel: true,
  roleId: true,
  role: { select: { id: true, name: true, permissions: true } },
  availability: true,
  maxOpenLeads: true,
  backupUserId: true,
  timeZone: true,
  isActive: true,
  isEscalationManager: true,
  slackUserId: true,
  lastAssignedAt: true,
  inviteTokenHash: true,
  calendarToken: { select: { status: true } },
  version: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export type SelectedUser = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

export function toUserView(user: SelectedUser, openLeadCount = 0) {
  const { inviteTokenHash, calendarToken, role, ...rest } = user;
  return {
    ...rest,
    role,
    roleName: role?.name ?? (user.baseLevel === 'OWNER' ? 'Owner' : user.baseLevel === 'ADMIN' ? 'Admin' : null),
    // Managers for the escalation chain: explicit flag, Owner/Admin, or a role holding the team permissions (F3.5)
    isManager: user.isEscalationManager || user.baseLevel !== 'USER' || (role ? isManagerRole(role.permissions) : false),
    slackLinked: Boolean(user.slackUserId),
    calendarStatus: (calendarToken?.status ?? 'NOT_CONNECTED') as 'CONNECTED' | 'NEEDS_RECONNECT' | 'NOT_CONNECTED',
    invitePending: Boolean(inviteTokenHash),
    openLeadCount,
  };
}

export type UserView = ReturnType<typeof toUserView>;

/** Open leads per assignee (Section 7 "Available employee" uses the same count). */
export async function openLeadCounts(prisma: { lead: { groupBy: Function } }, workspaceId: string): Promise<Map<string, number>> {
  const rows = (await (prisma.lead.groupBy as (args: unknown) => Promise<{ currentAssigneeId: string | null; _count: { _all: number } }[]>)({
    by: ['currentAssigneeId'],
    where: { workspaceId, status: { in: ['ASSIGNED', 'ACKNOWLEDGED'] }, currentAssigneeId: { not: null } },
    _count: { _all: true },
  }));
  return new Map(rows.map((row) => [row.currentAssigneeId as string, row._count._all]));
}
