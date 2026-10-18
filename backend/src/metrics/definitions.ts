import type { Prisma } from '@prisma/client';

/**
 * Section 7 metric definitions, each as the Prisma `where` (or rule) it is computed from. The dashboard,
 * drill-down lists and exports all use these, so the same figure means the same thing everywhere (F5.2, Q12).
 */

export type Scope = { workspaceId: string; userId?: string }; // userId set → personal figures (F5.4)

export function startOfDay(now: Date, timeZone: string): Date {
  // Local midnight in the workspace time zone, expressed in UTC
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const localMidnightAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'));
  const offsetMs = now.getTime() - Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return new Date(localMidnightAsUtc + offsetMs);
}

export function startOfMonth(now: Date, timeZone: string): Date {
  const day = startOfDay(now, timeZone);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const dayOfMonth = Number(parts.find((part) => part.type === 'day')?.value);
  return new Date(day.getTime() - (dayOfMonth - 1) * 86_400_000);
}

/** Lead: a record created by intake, any source. "New leads today" = created since local midnight. */
export const newLeadsToday = (scope: Scope, since: Date): Prisma.LeadWhereInput => ({
  workspaceId: scope.workspaceId,
  createdAt: { gte: since },
  ...(scope.userId ? { currentAssigneeId: scope.userId } : {}),
});

/** Open pipeline value: opportunities not in a won or lost stage, grouped by stage. */
export const openOpportunities = (scope: Scope): Prisma.OpportunityWhereInput => ({
  workspaceId: scope.workspaceId,
  stage: { isWon: false, isLost: false },
  ...(scope.userId ? { ownerId: scope.userId } : {}),
});

/** Time to first response: leads that have been acknowledged at least once; average of timeToFirstResponseSec. */
export const respondedLeads = (scope: Scope): Prisma.LeadWhereInput => ({
  workspaceId: scope.workspaceId,
  timeToFirstResponseSec: { not: null },
  ...(scope.userId ? { currentAssigneeId: scope.userId } : {}),
});

/** Recovery queue item: recoveryReason != NONE (computed by the sweep from Section 7 rules), not closed. */
export const recoveryQueue = (scope: Scope): Prisma.LeadWhereInput => ({
  workspaceId: scope.workspaceId,
  recoveryReason: { not: 'NONE' },
  status: { not: 'CLOSED' },
  ...(scope.userId ? { currentAssigneeId: scope.userId } : {}),
});

/** Escalation: an automatic reassignment caused by an expired window (assignments with level ≥ 1 created by the system). */
export const escalationsSince = (scope: Scope, since: Date): Prisma.LeadAssignmentWhereInput => ({
  workspaceId: scope.workspaceId,
  level: { gte: 1 },
  createdById: null,
  assignedAt: { gte: since },
  ...(scope.userId ? { assigneeId: scope.userId } : {}),
});

/** Upcoming appointments: scheduled, starting from now. */
export const upcomingAppointments = (scope: Scope, now: Date): Prisma.AppointmentWhereInput => ({
  workspaceId: scope.workspaceId,
  status: 'SCHEDULED',
  startsAt: { gte: now },
  ...(scope.userId ? { userId: scope.userId } : {}),
});

/** Collected revenue: payments confirmed by the provider webhook (PAID or partially refunded), minus refunds. */
export const paymentsCollectedSince = (scope: Scope, since: Date): Prisma.PaymentWhereInput => ({
  workspaceId: scope.workspaceId,
  status: { in: ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'] },
  paidAt: { gte: since },
  ...(scope.userId ? { requestedById: scope.userId } : {}),
});

/** Projected revenue: value of open opportunities plus payment requests not yet paid. */
export const pendingPayments = (scope: Scope): Prisma.PaymentWhereInput => ({
  workspaceId: scope.workspaceId,
  status: 'PENDING',
  ...(scope.userId ? { requestedById: scope.userId } : {}),
});

export const WIDGETS = [
  'newLeadsToday',
  'openPipelineValueByStage',
  'avgTimeToFirstResponseSec',
  'recoveryQueueCount',
  'escalationsLast24h',
  'employeeAvailability',
  'upcomingAppointments',
  'paymentsReceivedThisMonth',
  'projectedRevenue',
] as const;

export type Widget = (typeof WIDGETS)[number];
