import { Injectable } from '@nestjs/common';
import type { SessionUser } from '../auth/types/session-user';
import { WIDGETS, WIDGET_KEYS, type WidgetUnit } from './definitions';
import { MetricsRepository } from './metrics.repository';

export interface WidgetResult {
  key: string;
  label: string;
  unit: WidgetUnit;
  scope: 'workspace' | 'personal';
  value: number | null;
  breakdown?: unknown;
  next?: unknown;
  redacted?: boolean;
  drilldown: { route: string; query: Record<string, string> };
}

@Injectable()
export class MetricsService {
  constructor(private readonly repository: MetricsRepository) {}

  async dashboard(user: SessionUser, selected?: string[]) {
    const workspaceId = user.workspaceId;
    const personal = user.baseLevel === 'USER';
    const canSeeValues = user.permissions.includes('crm.view_values');
    const ownerId = personal ? user.id : undefined;
    const settings = await this.repository.getSettings(workspaceId);
    const idlePeriodSec = settings?.idlePeriodSec ?? 86_400;

    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const dayAgo = new Date(now.getTime() - 86_400_000);
    const idleBefore = new Date(now.getTime() - idlePeriodSec * 1000);
    const wanted = (key: string) => !selected || selected.includes(key);

    const widgets: WidgetResult[] = [];

    if (wanted('leads_new_today')) {
      widgets.push({
        key: 'leads_new_today',
        label: 'New leads today',
        unit: 'count',
        scope: personal ? 'personal' : 'workspace',
        value: await this.repository.countLeadsCreatedSince(workspaceId, startOfToday, ownerId),
        drilldown: { route: '/leads', query: { createdFrom: startOfToday.toISOString() } },
      });
    }

    if (wanted('avg_first_response')) {
      const avg = await this.repository.averageFirstResponseSeconds(
        workspaceId,
        new Date(now.getTime() - 30 * 86_400_000),
        ownerId,
      );
      widgets.push({
        key: 'avg_first_response',
        label: 'Average time to first response',
        unit: 'seconds',
        scope: personal ? 'personal' : 'workspace',
        value: avg === null ? null : Math.round(avg),
        drilldown: { route: '/leads', query: { status: 'ACKNOWLEDGED' } },
      });
    }

    if (wanted('recovery_queue')) {
      widgets.push({
        key: 'recovery_queue',
        label: 'Recovery queue',
        unit: 'count',
        scope: personal ? 'personal' : 'workspace',
        value: await this.repository.countRecovery(workspaceId, { now, idleBefore }, ownerId),
        drilldown: { route: '/leads/recovery', query: {} },
      });
    }

    if (wanted('escalations_24h')) {
      widgets.push({
        key: 'escalations_24h',
        label: 'Escalations (24h)',
        unit: 'count',
        scope: personal ? 'personal' : 'workspace',
        value: await this.repository.countEscalationsSince(workspaceId, dayAgo, personal ? user.id : undefined),
        drilldown: { route: '/audit', query: { action: 'lead.escalated' } },
      });
    }

    if (wanted('pipeline_value_by_stage')) {
      const rows = await this.repository.openPipelineByStage(workspaceId);
      widgets.push({
        key: 'pipeline_value_by_stage',
        label: 'Open pipeline value by stage',
        unit: 'currency',
        scope: 'workspace',
        value: canSeeValues ? rows.reduce((sum, row) => sum + row.value, 0) : null,
        redacted: !canSeeValues,
        breakdown: rows.map((row) => ({
          stageId: row.stageId,
          stage: row.stage,
          count: row.count,
          value: canSeeValues ? row.value : null,
          drilldown: { route: '/opportunities', query: { stageId: row.stageId } },
        })),
        drilldown: { route: '/opportunities', query: {} },
      });
    }

    if (wanted('team_availability')) {
      widgets.push({
        key: 'team_availability',
        label: 'Team availability',
        unit: 'people',
        scope: 'workspace',
        value: null,
        breakdown: await this.repository.availabilityBreakdown(workspaceId),
        drilldown: { route: '/users', query: {} },
      });
    }

    if (wanted('upcoming_appointments')) {
      const result = await this.repository.upcomingAppointments(workspaceId, now, personal ? user.id : undefined);
      widgets.push({
        key: 'upcoming_appointments',
        label: 'Upcoming appointments',
        unit: 'count',
        scope: personal ? 'personal' : 'workspace',
        value: result.count,
        next: result.next,
        drilldown: { route: '/appointments', query: {} },
      });
    }

    if (wanted('payments_this_month')) {
      const payments = await this.repository.paymentsThisMonth(workspaceId, monthStart);
      widgets.push({
        key: 'payments_this_month',
        label: 'Payments received this month',
        unit: 'currency',
        scope: 'workspace',
        value: canSeeValues ? payments.net : null,
        redacted: !canSeeValues,
        breakdown: {
          received: canSeeValues ? payments.received : null,
          refunds: canSeeValues ? payments.refunds : null,
          count: payments.count,
        },
        drilldown: { route: '/payments', query: { status: 'PAID' } },
      });
    }

    return {
      scope: personal ? 'personal' : 'workspace',
      canSeeValues,
      generatedAt: now.toISOString(),
      widgets,
    };
  }

  async getPrefs(user: SessionUser) {
    const prefs = await this.repository.getPrefs(user.workspaceId, user.id);
    const widgets = (prefs?.widgets ?? WIDGET_KEYS).filter((key) => WIDGET_KEYS.includes(key));
    return { widgets: widgets.length > 0 ? widgets : WIDGET_KEYS, updatedAt: prefs?.updatedAt ?? null };
  }

  async savePrefs(user: SessionUser, widgets: string[]) {
    const clean = widgets.filter((key) => WIDGET_KEYS.includes(key));
    const saved = await this.repository.savePrefs(user.workspaceId, user.id, clean);
    return { widgets: saved.widgets, updatedAt: saved.updatedAt };
  }

  catalogue() {
    return WIDGETS;
  }
}
