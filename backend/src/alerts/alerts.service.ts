import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { hasPermission, type AuthContext } from '../auth/auth.types';
import { randomToken } from '../common/encryption';
import { ENV, type Env } from '../common/env';
import { DomainError } from '../common/http-exception.filter';
import { PrismaService } from '../common/prisma.service';
import { cursorWhere, pageResult, type Pagination } from '../common/pagination';
import { ConnectionsService } from '../integrations/connections.service';
import { IntegrationEventsService } from '../integrations/integration-events.service';
import { TelegramProvider } from '../integrations/providers/telegram.provider';
import { ProviderError } from '../integrations/providers/twilio.provider';
import { RealtimeGateway } from '../realtime/realtime.gateway';

export type AlertJob = { workspaceId: string; leadId: string; assignmentId: string; userId: string; reason: string; level: number };

/**
 * Escalation alerts outside the application via Telegram (F3.9, I4). Each employee links their chat once
 * with a personal code (I4.3); deliveries are recorded per assignment and retried a limited number of
 * times (I4.4); the message names the lead, source, reason and a deep link (I4.2).
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly connections: ConnectionsService,
    private readonly events: IntegrationEventsService,
    private readonly telegram: TelegramProvider,
    private readonly realtime: RealtimeGateway,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ───────────── Linking (I4.3) ─────────────

  /** Returns a one-time code and a deep link (`https://t.me/<bot>?start=<code>`) for the current user. */
  async linkCode(auth: AuthContext) {
    const credentials = await this.connections.telegramCredentials(auth.workspaceId);
    if (!credentials) throw new DomainError('TELEGRAM_NOT_CONNECTED', 'Telegram alerts are not configured.', 409, 'Ask an Admin to connect the Telegram bot in Settings → Integrations.');
    const link = await this.prisma.memberLink.upsert({
      where: { userId_channel: { userId: auth.userId, channel: 'TELEGRAM' } },
      create: { workspaceId: auth.workspaceId, userId: auth.userId, channel: 'TELEGRAM', linkCode: randomToken(6) },
      update: { linkCode: randomToken(6), destination: null, linkedAt: null },
    });
    let botUsername: string | null = null;
    try {
      botUsername = (await this.telegram.botInfo(credentials.botToken)).username;
    } catch (error) {
      this.logger.warn(`Telegram getMe failed: ${(error as Error).message}`);
    }
    return { code: link.linkCode, deepLink: botUsername ? `https://t.me/${botUsername}?start=${link.linkCode}` : null, instructions: `Open the bot in Telegram and send: /start ${link.linkCode}` };
  }

  async unlink(auth: AuthContext) {
    await this.prisma.$transaction([
      this.prisma.memberLink.deleteMany({ where: { userId: auth.userId, channel: 'TELEGRAM' } }),
      this.prisma.user.update({ where: { id: auth.userId }, data: { telegramChatId: null } }),
    ]);
    return { linked: false };
  }

  async myStatus(auth: AuthContext) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { telegramChatId: true } });
    const link = await this.prisma.memberLink.findUnique({ where: { userId_channel: { userId: auth.userId, channel: 'TELEGRAM' } } });
    return { linked: Boolean(user.telegramChatId), linkedAt: link?.linkedAt ?? null, pendingCode: !user.telegramChatId && link ? link.linkCode : null };
  }

  /** Telegram update handler: `/start <code>` or a bare code links the chat to the employee who generated it. */
  async handleTelegramUpdate(raw: unknown) {
    const update = raw as { message?: { message_id: number; chat: { id: number }; text?: string } };
    const text = update.message?.text?.trim();
    const chatId = update.message?.chat?.id;
    if (!text || chatId === undefined) return undefined;
    const match = /^(?:\/start\s+)?([a-f0-9]{12})$/i.exec(text);
    if (!match) {
      if (/^\/start/i.test(text)) await this.safeReply(chatId, 'Hi! To receive lead alerts, open the platform, go to Settings → Notifications and send me the code shown there.');
      return undefined;
    }
    const link = await this.prisma.memberLink.findUnique({ where: { linkCode: match[1].toLowerCase() }, include: { user: { select: { firstName: true, workspaceId: true } } } });
    if (!link) {
      await this.safeReply(chatId, 'That code is not valid or has expired. Generate a new one in Settings → Notifications.');
      return undefined;
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.memberLink.update({ where: { id: link.id }, data: { destination: String(chatId), linkedAt: new Date() } });
      await tx.user.update({ where: { id: link.userId }, data: { telegramChatId: String(chatId) } });
      await this.audit.recordTx(tx, { workspaceId: link.workspaceId, actorId: link.userId, actorLabel: link.user.firstName, action: 'alerts.telegram_linked', targetType: 'user', targetId: link.userId, after: { channel: 'TELEGRAM' } });
    });
    await this.safeReply(chatId, `✅ Linked. Hi ${link.user.firstName}, you will receive lead escalation alerts here.`, link.workspaceId);
    this.realtime.toUser(link.userId, 'notification', { title: 'Telegram linked', body: 'You will now receive escalation alerts on Telegram.', link: '/settings/notifications' });
    return { relatedType: 'user', relatedId: link.userId };
  }

  // ───────────── Delivery (I4.1, I4.2, I4.4) ─────────────

  /** Job handler. Unique (assignmentId, channel) means a retried job never double-sends. */
  async deliver(job: AlertJob, attempt: number, isLastAttempt: boolean) {
    const delivery = await this.prisma.alertDelivery.upsert({
      where: { assignmentId_channel: { assignmentId: job.assignmentId, channel: 'TELEGRAM' } },
      create: { workspaceId: job.workspaceId, leadId: job.leadId, assignmentId: job.assignmentId, userId: job.userId, channel: 'TELEGRAM', status: 'PENDING', attempts: 0 },
      update: {},
    });
    if (delivery.status === 'SENT') return;

    const [user, lead, credentials] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: job.userId }, select: { firstName: true, telegramChatId: true } }),
      this.prisma.lead.findUnique({ where: { id: job.leadId }, include: { contact: { select: { firstName: true, lastName: true, phone: true } } } }),
      this.connections.telegramCredentials(job.workspaceId),
    ]);
    const fail = async (message: string, final: boolean) => {
      await this.prisma.alertDelivery.update({ where: { id: delivery.id }, data: { status: final ? 'FAILED' : 'PENDING', attempts: { increment: 1 }, lastError: message } });
      if (final) {
        await this.events.record({ workspaceId: job.workspaceId, provider: 'TELEGRAM', direction: 'OUT', type: 'alert.failed', payload: { leadId: job.leadId, userId: job.userId, message }, relatedType: 'lead', relatedId: job.leadId });
        await this.connections.markHealth(job.workspaceId, 'TELEGRAM', false, message);
        this.realtime.toWorkspace(job.workspaceId, 'integration:status', { provider: 'TELEGRAM', status: 'ERROR', error: message, leadId: job.leadId });
      }
    };
    if (!lead) return fail('Lead no longer exists.', true);
    if (!credentials) return fail('Telegram is not configured for this workspace.', true);
    if (!user?.telegramChatId) return fail(`${user?.firstName ?? 'The employee'} has not linked Telegram, so the alert could not be delivered. The in-app notification was sent.`, true);

    const text = [
      `🚨 <b>Lead escalated to you</b> (level ${job.level})`,
      `<b>Lead:</b> ${escapeHtml(lead.title)}`,
      `<b>Contact:</b> ${escapeHtml(`${lead.contact.firstName} ${lead.contact.lastName}`.trim())}${lead.contact.phone ? ` (${escapeHtml(lead.contact.phone)})` : ''}`,
      `<b>Source:</b> ${lead.source.replace('_', ' ').toLowerCase()}`,
      `<b>Reason:</b> ${escapeHtml(job.reason)}`,
      lead.dueAt ? `<b>Acknowledge by:</b> ${lead.dueAt.toISOString().replace('T', ' ').slice(0, 16)} UTC` : '',
      `<a href="${this.env.APP_URL}/leads/${lead.id}">Open the lead</a>`,
    ].filter(Boolean).join('\n');

    try {
      const result = await this.telegram.send(credentials.botToken, user.telegramChatId, text);
      await this.prisma.alertDelivery.update({ where: { id: delivery.id }, data: { status: 'SENT', attempts: { increment: 1 }, sentAt: new Date(), lastError: null } });
      await this.events.record({ workspaceId: job.workspaceId, provider: 'TELEGRAM', direction: 'OUT', type: 'alert.sent', externalEventId: `out:${user.telegramChatId}:${result.messageId}`, payload: { leadId: job.leadId, userId: job.userId }, relatedType: 'lead', relatedId: job.leadId });
      await this.connections.markHealth(job.workspaceId, 'TELEGRAM', true);
    } catch (error) {
      const providerError = error instanceof ProviderError ? error : new ProviderError('TELEGRAM', 'UNKNOWN', (error as Error).message, true);
      await fail(providerError.message, !providerError.retryable || isLastAttempt);
      if (providerError.retryable && !isLastAttempt) throw providerError; // let BullMQ retry with backoff
    }
  }

  async list(auth: AuthContext, query: Pagination & { status?: 'PENDING' | 'SENT' | 'FAILED' }) {
    const where: Prisma.AlertDeliveryWhereInput = {
      workspaceId: auth.workspaceId,
      ...(query.status ? { status: query.status } : {}),
      ...(hasPermission(auth, 'integrations.view') ? {} : { userId: auth.userId }),
      ...cursorWhere(query.cursor),
    };
    const rows = await this.prisma.alertDelivery.findMany({ where, include: { user: { select: { id: true, firstName: true, lastName: true } }, lead: { select: { id: true, title: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.limit + 1 });
    return pageResult(rows, query.limit);
  }

  private async safeReply(chatId: number, text: string, workspaceId?: string) {
    try {
      const credentials = workspaceId ? await this.connections.telegramCredentials(workspaceId) : this.env.TELEGRAM_BOT_TOKEN ? { botToken: this.env.TELEGRAM_BOT_TOKEN } : null;
      if (credentials) await this.telegram.send(credentials.botToken, String(chatId), text);
    } catch (error) {
      this.logger.warn(`Telegram reply failed: ${(error as Error).message}`);
    }
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char] as string);
}
