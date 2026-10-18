import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { actorLabel, hasPermission, type AuthContext } from '../auth/auth.types';
import { ENV, type Env } from '../common/env';
import { DomainError } from '../common/http-exception.filter';
import { PrismaService } from '../common/prisma.service';
import { cursorWhere, pageResult, type Pagination, skipFor } from '../common/pagination';
import { ConnectionsService } from '../integrations/connections.service';
import { IntegrationEventsService } from '../integrations/integration-events.service';
import { SlackProvider } from '../integrations/providers/slack.provider';
import { ProviderError } from '../integrations/providers/twilio.provider';
import { RealtimeGateway } from '../realtime/realtime.gateway';

export type AlertJob = { workspaceId: string; leadId: string; assignmentId: string; userId: string; reason: string; level: number };

/**
 * Escalation alerts outside the application via Slack direct messages (F3.9, I4). Each employee's
 * destination is their Slack member ID: found automatically by email, or set by hand (I4.3).
 * Deliveries are recorded per assignment and retried a limited number of times (I4.4).
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly connections: ConnectionsService,
    private readonly events: IntegrationEventsService,
    private readonly slack: SlackProvider,
    private readonly realtime: RealtimeGateway,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ───────────── Per-user routing (I4.3) ─────────────

  /**
   * Links the caller (or, with users.manage, another employee) to a Slack member. Without an explicit
   * member ID the employee's email is looked up in the Slack workspace.
   */
  async link(auth: AuthContext, input: { slackUserId?: string; userId?: string }) {
    const userId = input.userId ?? auth.userId;
    if (userId !== auth.userId && !hasPermission(auth, 'users.manage')) {
      throw new DomainError('PERMISSION_DENIED', 'You can only set your own Slack destination.', 403);
    }
    const user = await this.prisma.user.findFirst({ where: { id: userId, workspaceId: auth.workspaceId, isActive: true } });
    if (!user) throw new DomainError('USER_NOT_FOUND', 'User not found.', 404);
    const token = await this.botToken(auth.workspaceId);

    let slackUserId = input.slackUserId?.trim();
    if (!slackUserId) {
      slackUserId = (await this.slack.lookupUserByEmail(token, user.email)) ?? undefined;
      if (!slackUserId) {
        throw new DomainError('SLACK_USER_NOT_FOUND', `No Slack member uses ${user.email}.`, 404, 'Enter the Slack member ID instead (Slack profile → ⋮ → Copy member ID).');
      }
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { slackUserId } });
      await this.audit.recordTx(tx, { workspaceId: auth.workspaceId, actorId: auth.userId, actorLabel: actorLabel(auth), action: 'alerts.slack_linked', targetType: 'user', targetId: userId, before: { slackUserId: user.slackUserId }, after: { slackUserId } });
    });
    // Confirmation DM proves the route works end to end
    try {
      await this.slack.send(token, slackUserId, `✅ You will receive lead escalation alerts here from ${this.env.APP_URL}.`);
    } catch (error) {
      throw new DomainError('SLACK_TEST_FAILED', `Linked, but the test message failed: ${(error as Error).message}`, 502, 'Check the member ID and the app permissions.');
    }
    return { linked: true, slackUserId };
  }

  async unlink(auth: AuthContext) {
    await this.prisma.user.update({ where: { id: auth.userId }, data: { slackUserId: null } });
    return { linked: false };
  }

  async myStatus(auth: AuthContext) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { slackUserId: true } });
    const configured = Boolean(await this.connections.slackCredentials(auth.workspaceId));
    return { configured, linked: Boolean(user.slackUserId), slackUserId: user.slackUserId };
  }

  // ───────────── Delivery (I4.1, I4.2, I4.4) ─────────────

  /** Job handler. Unique (assignmentId, channel) means a retried job never double-sends. */
  async deliver(job: AlertJob, attempt: number, isLastAttempt: boolean) {
    const delivery = await this.prisma.alertDelivery.upsert({
      where: { assignmentId_channel: { assignmentId: job.assignmentId, channel: 'SLACK' } },
      create: { workspaceId: job.workspaceId, leadId: job.leadId, assignmentId: job.assignmentId, userId: job.userId, channel: 'SLACK', status: 'PENDING', attempts: 0 },
      update: {},
    });
    if (delivery.status === 'SENT') return;

    const [user, lead, credentials] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: job.userId }, select: { firstName: true, email: true, slackUserId: true } }),
      this.prisma.lead.findUnique({ where: { id: job.leadId }, include: { contact: { select: { firstName: true, lastName: true, phone: true } } } }),
      this.connections.slackCredentials(job.workspaceId),
    ]);
    const fail = async (message: string, final: boolean) => {
      await this.prisma.alertDelivery.update({ where: { id: delivery.id }, data: { status: final ? 'FAILED' : 'PENDING', attempts: { increment: 1 }, lastError: message } });
      if (final) {
        await this.events.record({ workspaceId: job.workspaceId, provider: 'SLACK', direction: 'OUT', type: 'alert.failed', payload: { leadId: job.leadId, userId: job.userId, message, attempt }, relatedType: 'lead', relatedId: job.leadId });
        await this.connections.markHealth(job.workspaceId, 'SLACK', false, message);
        this.realtime.toWorkspace(job.workspaceId, 'integration:status', { provider: 'SLACK', status: 'ERROR', error: message, leadId: job.leadId });
      }
    };
    if (!lead) return fail('Lead no longer exists.', true);
    if (!credentials) return fail('Slack is not connected for this workspace.', true);

    // Auto-route by email the first time, so employees need no setup when their Slack email matches
    let slackUserId = user?.slackUserId ?? null;
    if (!slackUserId && user?.email) {
      try {
        slackUserId = await this.slack.lookupUserByEmail(credentials.botToken, user.email);
        if (slackUserId) await this.prisma.user.update({ where: { id: job.userId }, data: { slackUserId } });
      } catch (error) {
        this.logger.warn(`Slack lookup for ${user.email} failed: ${(error as Error).message}`);
      }
    }
    if (!slackUserId) return fail(`${user?.firstName ?? 'The employee'} has no Slack destination (no Slack member with their email). The in-app notification was sent.`, true);

    const link = `${this.env.APP_URL}/leads/${lead.id}`;
    const contactName = `${lead.contact.firstName} ${lead.contact.lastName}`.trim();
    const source = lead.source.replace('_', ' ').toLowerCase();
    const due = lead.dueAt ? `${lead.dueAt.toISOString().replace('T', ' ').slice(0, 16)} UTC` : 'now';
    const text = `Lead escalated to you: ${lead.title} (${source}). Reason: ${job.reason}. Open: ${link}`;
    const blocks = [
      { type: 'section', text: { type: 'mrkdwn', text: `:rotating_light: *Lead escalated to you* (level ${job.level})` } },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Lead:*\n${escapeMrkdwn(lead.title)}` },
          { type: 'mrkdwn', text: `*Contact:*\n${escapeMrkdwn(contactName)}${lead.contact.phone ? ` (${lead.contact.phone})` : ''}` },
          { type: 'mrkdwn', text: `*Source:*\n${source}` },
          { type: 'mrkdwn', text: `*Acknowledge by:*\n${due}` },
        ],
      },
      { type: 'section', text: { type: 'mrkdwn', text: `*Reason:* ${escapeMrkdwn(job.reason)}` } },
      { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open the lead' }, url: link, style: 'primary' }] },
    ];

    try {
      const result = await this.slack.send(credentials.botToken, slackUserId, text, blocks);
      await this.prisma.alertDelivery.update({ where: { id: delivery.id }, data: { status: 'SENT', attempts: { increment: 1 }, sentAt: new Date(), lastError: null } });
      await this.events.record({ workspaceId: job.workspaceId, provider: 'SLACK', direction: 'OUT', type: 'alert.sent', externalEventId: `out:${slackUserId}:${result.messageId}`, payload: { leadId: job.leadId, userId: job.userId }, relatedType: 'lead', relatedId: job.leadId });
      await this.connections.markHealth(job.workspaceId, 'SLACK', true);
    } catch (error) {
      const providerError = error instanceof ProviderError ? error : new ProviderError('SLACK', 'UNKNOWN', (error as Error).message, true);
      await fail(providerError.message, !providerError.retryable || isLastAttempt);
      if (providerError.retryable && !isLastAttempt) throw providerError; // BullMQ retries with backoff
    }
  }

  async list(auth: AuthContext, query: Pagination & { status?: 'PENDING' | 'SENT' | 'FAILED' }) {
    const where: Prisma.AlertDeliveryWhereInput = {
      workspaceId: auth.workspaceId,
      ...(query.status ? { status: query.status } : {}),
      ...(hasPermission(auth, 'integrations.view') ? {} : { userId: auth.userId }),
      ...cursorWhere(query.cursor),
    };
    const rows = await this.prisma.alertDelivery.findMany({ where, include: { user: { select: { id: true, firstName: true, lastName: true } }, lead: { select: { id: true, title: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: skipFor(query), take: query.limit + 1 });
    return pageResult(rows, query.limit);
  }

  private async botToken(workspaceId: string): Promise<string> {
    const credentials = await this.connections.slackCredentials(workspaceId);
    if (!credentials) throw new DomainError('SLACK_NOT_CONNECTED', 'Slack alerts are not configured.', 409, 'Ask an Admin to connect Slack in Settings → Integrations.');
    return credentials.botToken;
  }
}

function escapeMrkdwn(value: string): string {
  return value.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char] as string);
}
