import { Injectable } from '@nestjs/common';

import { hasPermission, type AuthContext } from '../auth/auth.types';
import { PrismaService } from '../common/prisma.service';
import {
  escalationsSince,
  newLeadsToday,
  openOpportunities,
  paymentsCollectedSince,
  pendingPayments,
  recoveryQueue,
  respondedLeads,
  startOfDay,
  startOfMonth,
  upcomingAppointments,
  WIDGETS,
  type Scope,
} from './definitions';

/**
 * Operational dashboard (F5). Every figure comes from `definitions.ts`, and each one carries the
 * `drillDown` filter the frontend passes to the matching list endpoint (F5.3). Users without
 * dashboard.company see personal figures only (F5.4); amounts are hidden without crm.view_values (F1.4).
 */
@Injectable()
export class MetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard(auth: AuthContext) {
    const workspace = await this.prisma.workspace.findUniqueOrThrow({ where: { id: auth.workspaceId } });
    const companyWide = hasPermission(auth, 'dashboard.company');
    const scope: Scope = { workspaceId: auth.workspaceId, ...(companyWide ? {} : { userId: auth.userId }) };
    const now = new Date();
    const dayStart = startOfDay(now, workspace.timeZone);
    const monthStart = startOfMonth(now, workspace.timeZone);
    const last24h = new Date(now.getTime() - 24 * 3600_000);
    const canSeeValues = hasPermission(auth, 'crm.view_values');
    const prefs = await this.prisma.dashboardPref.findUnique({ where: { userId: auth.userId } });
    const responseTrend = await this.responseTrend(scope, workspace.timeZone);

    const [newLeads, openByStage, stages, responded, recovery, escalations, availability, appointments, collected, refunded, pending] = await Promise.all([
      this.prisma.lead.count({ where: newLeadsToday(scope, dayStart) }),
      this.prisma.opportunity.groupBy({ by: ['stageId'], where: openOpportunities(scope), _sum: { value: true }, _count: { _all: true } }),
      this.prisma.pipelineStage.findMany({ where: { workspaceId: auth.workspaceId }, select: { id: true, name: true, pipelineId: true, order: true } }),
      this.prisma.lead.aggregate({ where: respondedLeads(scope), _avg: { timeToFirstResponseSec: true }, _count: { _all: true } }),
      this.prisma.lead.groupBy({ by: ['recoveryReason'], where: recoveryQueue(scope), _count: { _all: true } }),
      this.prisma.leadAssignment.count({ where: escalationsSince(scope, last24h) }),
      this.prisma.user.groupBy({ by: ['availability'], where: { workspaceId: auth.workspaceId, isActive: true }, _count: { _all: true } }),
      this.prisma.appointment.findMany({ where: upcomingAppointments(scope, now), orderBy: { startsAt: 'asc' }, take: 5, include: { contact: { select: { id: true, firstName: true, lastName: true } }, user: { select: { id: true, firstName: true, lastName: true } } } }),
      this.prisma.payment.aggregate({ where: paymentsCollectedSince(scope, monthStart), _sum: { amount: true }, _count: { _all: true } }),
      this.prisma.payment.aggregate({ where: paymentsCollectedSince(scope, monthStart), _sum: { refundedAmount: true } }),
      this.prisma.payment.aggregate({ where: pendingPayments(scope), _sum: { amount: true }, _count: { _all: true } }),
    ]);

    const stageById = new Map(stages.map((stage) => [stage.id, stage]));
    const openValue = openByStage.reduce((sum, row) => sum + Number(row._sum.value ?? 0), 0);
    const collectedValue = Number(collected._sum.amount ?? 0) - Number(refunded._sum.refundedAmount ?? 0);
    const pendingValue = Number(pending._sum.amount ?? 0);

    const widgets = {
      newLeadsToday: { value: newLeads, drillDown: { endpoint: '/leads', query: { filters: { criteria: [{ field: 'createdAt', op: 'gte', value: dayStart.toISOString() }] } } } },
      openPipelineValueByStage: {
        value: canSeeValues ? openValue : null,
        count: openByStage.reduce((sum, row) => sum + row._count._all, 0),
        byStage: openByStage
          .map((row) => ({ stageId: row.stageId, stage: stageById.get(row.stageId)?.name ?? 'Unknown', order: stageById.get(row.stageId)?.order ?? 0, count: row._count._all, value: canSeeValues ? Number(row._sum.value ?? 0) : null }))
          .sort((a, b) => a.order - b.order),
        valueHidden: !canSeeValues,
        drillDown: { endpoint: '/opportunities', query: { filters: { criteria: [] } } },
      },
      avgTimeToFirstResponseSec: { value: responded._avg.timeToFirstResponseSec === null ? null : Math.round(responded._avg.timeToFirstResponseSec), sample: responded._count._all, drillDown: { endpoint: '/leads', query: { status: 'ACKNOWLEDGED' } } },
      recoveryQueueCount: { value: recovery.reduce((sum, row) => sum + row._count._all, 0), byReason: Object.fromEntries(recovery.map((row) => [row.recoveryReason, row._count._all])), drillDown: { endpoint: '/leads/recovery', query: {} } },
      escalationsLast24h: { value: escalations, drillDown: { endpoint: '/audit', query: { action: 'lead.escalated', from: last24h.toISOString() } } },
      employeeAvailability: { value: Object.fromEntries(availability.map((row) => [row.availability, row._count._all])), drillDown: { endpoint: '/users', query: {} } },
      upcomingAppointments: { value: appointments.length, items: appointments, drillDown: { endpoint: '/appointments', query: { from: now.toISOString() } } },
      paymentsReceivedThisMonth: { value: canSeeValues ? collectedValue : null, count: collected._count._all, currency: workspace.currency, valueHidden: !canSeeValues, drillDown: { endpoint: '/payments', query: { status: 'PAID', from: monthStart.toISOString() } } },
      projectedRevenue: { value: canSeeValues ? openValue + pendingValue : null, pendingPayments: pending._count._all, currency: workspace.currency, valueHidden: !canSeeValues, drillDown: { endpoint: '/payments', query: { status: 'PENDING' } } },
    };

    return {
      scope: companyWide ? 'company' : 'personal',
      generatedAt: now.toISOString(),
      timeZone: workspace.timeZone,
      hiddenWidgets: prefs?.hiddenWidgets ?? [],
      availableWidgets: WIDGETS,
      widgets,
      responseTrend,
    };
  }

  /**
   * Last 7 local days: leads created per day and the average time to first response of leads first
   * acknowledged that day (Section 7 definition, same as the headline figure).
   */
  private async responseTrend(scope: Scope, timeZone: string) {
    const rows = await this.prisma.$queryRaw<{ day: string; leads: number; avg_sec: number | null }[]>`
      WITH days AS (
        SELECT generate_series((now() AT TIME ZONE ${timeZone})::date - 6, (now() AT TIME ZONE ${timeZone})::date, interval '1 day')::date AS day
      )
      SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
        (SELECT count(*)::int FROM "Lead" l WHERE l."workspaceId" = ${scope.workspaceId}
          AND (${scope.userId ?? null}::text IS NULL OR l."currentAssigneeId" = ${scope.userId ?? null})
          AND (l."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone})::date = d.day) AS leads,
        (SELECT round(avg(l."timeToFirstResponseSec"))::int FROM "Lead" l WHERE l."workspaceId" = ${scope.workspaceId}
          AND (${scope.userId ?? null}::text IS NULL OR l."currentAssigneeId" = ${scope.userId ?? null})
          AND l."firstAckedAt" IS NOT NULL
          AND (l."firstAckedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone})::date = d.day) AS avg_sec
      FROM days d ORDER BY d.day`;
    return rows.map((row) => ({ day: row.day, leads: Number(row.leads), avgSec: row.avg_sec === null ? null : Number(row.avg_sec) }));
  }

  async setPrefs(userId: string, hiddenWidgets: string[]) {
    // Widget keys belong to the frontend layout, so any short key is accepted (F5.5)
    const valid = [...new Set(hiddenWidgets.filter((widget) => /^[A-Za-z0-9_.-]{1,60}$/.test(widget)))];
    return this.prisma.dashboardPref.upsert({ where: { userId }, create: { userId, hiddenWidgets: valid }, update: { hiddenWidgets: valid } });
  }
}
