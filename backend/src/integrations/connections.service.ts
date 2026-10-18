import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Provider } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { actorLabel, type AuthContext } from '../auth/auth.types';
import { decryptJson, encryptJson, maskSecret } from '../common/encryption';
import { ENV, type Env } from '../common/env';
import { PrismaService } from '../common/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

export type TwilioCredentials = { accountSid: string; authToken: string; whatsappFrom: string };
export type SlackCredentials = { botToken: string };
export type { LemonSqueezyCredentials } from './providers/lemonsqueezy.provider';

/** What each integration can and cannot do, shown verbatim in the UI (I5.6). All four work from Pakistan. */
export const PROVIDER_INFO: Record<Exclude<Provider, 'WEB_FORM'>, { name: string; purpose: string; credentialKeys: string[]; configKeys?: string[]; limits: string[]; webhookPath: string | null }> = {
  TWILIO: {
    name: 'Twilio WhatsApp Sandbox',
    purpose: 'Receive and send WhatsApp messages; unknown numbers become contacts and leads.',
    credentialKeys: ['accountSid', 'authToken', 'whatsappFrom'],
    limits: [
      'The sandbox only reaches phones that first sent the join phrase to the sandbox number; the join expires after 3 days.',
      "Free-form replies are only possible within 24 hours of the customer's last message; outside that window Twilio rejects the message (error 63016).",
      'One message every 3 seconds; sandbox messages are for testing only.',
      'Twilio does not apply STOP keywords to WhatsApp, so opt-out is handled here: a message saying "stop" opts the contact out.',
    ],
    webhookPath: '/webhooks/twilio/<workspaceId>',
  },
  LEMONSQUEEZY: {
    name: 'Lemon Squeezy (test mode)',
    purpose: 'Create payment links for opportunities; payment status updates arrive by webhook.',
    credentialKeys: ['apiKey', 'storeId', 'variantId', 'webhookSecret'],
    configKeys: ['currency'],
    limits: [
      'Test mode only: pay with the test card 4242 4242 4242 4242, any future date and any CVC; no real money moves.',
      "Card details are entered only on Lemon Squeezy's hosted page; this platform never sees or stores card numbers.",
      "Amounts are charged in the store's currency (set when the store was created).",
      'Lemon Squeezy sends no "link expired" event, so unpaid links are marked expired here when their deadline passes.',
      'Failed card attempts stay on the checkout page; only completed and refunded orders are reported back.',
    ],
    webhookPath: '/webhooks/lemonsqueezy/<workspaceId>',
  },
  GOOGLE: {
    name: 'Google Calendar',
    purpose: 'Each employee connects their own Google account; appointments are created on their real calendar.',
    credentialKeys: [],
    limits: [
      'Each employee connects individually with their Google consent; admins see who is connected.',
      'While the Google app is in testing status, only listed test users can connect and tokens expire after 7 days (reconnect is offered).',
      'Busy times are read from the primary calendar only.',
    ],
    webhookPath: null,
  },
  SLACK: {
    name: 'Slack',
    purpose: 'Sends a direct message to the new owner when a lead escalates.',
    credentialKeys: ['botToken'],
    limits: [
      'Employees are matched to Slack by email automatically; anyone with a different Slack email sets their member ID in Settings → Notifications.',
      'The Slack app needs the bot scopes chat:write, users:read and users:read.email.',
      'Slack allows about one message per second per person; alerts are queued and retried up to 3 times.',
    ],
    webhookPath: null,
  },
};

/** Per-workspace provider connections with encrypted credentials (I5.1–I5.3, I5.7). */
@Injectable()
export class ConnectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async list(workspaceId: string) {
    const [connections, calendarTokens, linkedUsers] = await Promise.all([
      this.prisma.integrationConnection.findMany({ where: { workspaceId } }),
      this.prisma.calendarToken.findMany({ where: { workspaceId }, include: { user: { select: { id: true, firstName: true, lastName: true } } } }),
      this.prisma.user.count({ where: { workspaceId, isActive: true, slackUserId: { not: null } } }),
    ]);
    const byProvider = new Map(connections.map((connection) => [connection.provider, connection]));
    return (Object.keys(PROVIDER_INFO) as Exclude<Provider, 'WEB_FORM'>[]).map((provider) => {
      const info = PROVIDER_INFO[provider];
      const connection = byProvider.get(provider);
      const credentials = connection?.credentialsEnc ? decryptJson<Record<string, string>>(connection.credentialsEnc, this.env.APP_ENCRYPTION_KEY) : {};
      const slackDefaultAvailable = provider === 'SLACK' && Boolean(this.env.SLACK_BOT_TOKEN);
      const status = provider === 'GOOGLE' ? (calendarTokens.length > 0 ? 'CONNECTED' : 'NOT_CONNECTED') : connection?.status ?? (slackDefaultAvailable ? 'CONNECTED' : 'NOT_CONNECTED');
      return {
        provider,
        ...info,
        webhookUrl: info.webhookPath ? `${this.env.PUBLIC_URL}${info.webhookPath.replace('<workspaceId>', workspaceId)}` : null,
        statusCallbackUrl: provider === 'TWILIO' ? `${this.env.PUBLIC_URL}/webhooks/twilio/${workspaceId}/status` : null,
        status,
        lastOkAt: connection?.lastOkAt ?? null,
        lastError: connection?.lastError ?? null,
        maskedCredentials: Object.fromEntries(Object.entries(credentials).map(([key, value]) => [key, maskSecret(value)])),
        config: connection?.config ?? {},
        details:
          provider === 'GOOGLE'
            ? { connectedUsers: calendarTokens.map((token) => ({ userId: token.userId, name: `${token.user.firstName} ${token.user.lastName}`, email: token.email, status: token.status })) }
            : provider === 'SLACK'
              ? { linkedUsers, usingPlatformBot: !connection?.credentialsEnc && slackDefaultAvailable }
              : {},
      };
    });
  }

  async connect(auth: AuthContext, provider: Exclude<Provider, 'WEB_FORM' | 'GOOGLE'>, credentials: Record<string, string>, config: Record<string, unknown> = {}) {
    const info = PROVIDER_INFO[provider];
    const missing = info.credentialKeys.filter((key) => !credentials[key]);
    if (missing.length > 0) throw new NotFoundException({ code: 'CREDENTIALS_INCOMPLETE', message: `Missing: ${missing.join(', ')}.`, action: `Provide ${info.credentialKeys.join(', ')}.` });
    const existing = await this.prisma.integrationConnection.findUnique({ where: { workspaceId_provider: { workspaceId: auth.workspaceId, provider } } });
    const connection = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.integrationConnection.upsert({
        where: { workspaceId_provider: { workspaceId: auth.workspaceId, provider } },
        create: { workspaceId: auth.workspaceId, provider, status: 'CONNECTED', credentialsEnc: encryptJson(credentials, this.env.APP_ENCRYPTION_KEY), config: config as Prisma.InputJsonValue, connectedById: auth.userId },
        update: { status: 'CONNECTED', credentialsEnc: encryptJson(credentials, this.env.APP_ENCRYPTION_KEY), config: config as Prisma.InputJsonValue, connectedById: auth.userId, lastError: null, version: { increment: 1 } },
      });
      await this.audit.recordTx(tx, {
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        actorLabel: actorLabel(auth),
        action: existing ? 'integration.updated' : 'integration.connected',
        targetType: 'integration',
        targetId: saved.id,
        before: existing ? { provider, status: existing.status } : null,
        after: { provider, status: 'CONNECTED', credentialKeys: Object.keys(credentials), config },
      });
      return saved;
    });
    this.realtime.toWorkspace(auth.workspaceId, 'integration:status', { provider, status: 'CONNECTED' });
    return { provider, status: connection.status, maskedCredentials: Object.fromEntries(Object.entries(credentials).map(([key, value]) => [key, maskSecret(value)])) };
  }

  async disconnect(auth: AuthContext, provider: Exclude<Provider, 'WEB_FORM' | 'GOOGLE'>) {
    const existing = await this.prisma.integrationConnection.findUnique({ where: { workspaceId_provider: { workspaceId: auth.workspaceId, provider } } });
    if (!existing) return { provider, status: 'NOT_CONNECTED' };
    await this.prisma.$transaction(async (tx) => {
      await tx.integrationConnection.update({ where: { id: existing.id }, data: { status: 'NOT_CONNECTED', credentialsEnc: null, lastError: null, version: { increment: 1 } } });
      await this.audit.recordTx(tx, { workspaceId: auth.workspaceId, actorId: auth.userId, actorLabel: actorLabel(auth), action: 'integration.disconnected', targetType: 'integration', targetId: existing.id, before: { provider, status: existing.status }, after: { provider, status: 'NOT_CONNECTED' } });
    });
    this.realtime.toWorkspace(auth.workspaceId, 'integration:status', { provider, status: 'NOT_CONNECTED' });
    return { provider, status: 'NOT_CONNECTED' };
  }

  async credentials<T>(workspaceId: string, provider: Provider): Promise<{ credentials: T; config: Record<string, unknown> } | null> {
    const connection = await this.prisma.integrationConnection.findUnique({ where: { workspaceId_provider: { workspaceId, provider } } });
    if (!connection?.credentialsEnc || connection.status === 'NOT_CONNECTED') return null;
    return { credentials: decryptJson<T>(connection.credentialsEnc, this.env.APP_ENCRYPTION_KEY), config: (connection.config ?? {}) as Record<string, unknown> };
  }

  /** Workspace Slack app if connected, else the platform bot from SLACK_BOT_TOKEN. */
  async slackCredentials(workspaceId: string): Promise<SlackCredentials | null> {
    const own = await this.credentials<SlackCredentials>(workspaceId, 'SLACK');
    if (own) return own.credentials;
    return this.env.SLACK_BOT_TOKEN ? { botToken: this.env.SLACK_BOT_TOKEN } : null;
  }

  /** Health updates feed the Integrations page (I5.1) and are pushed live. */
  async markHealth(workspaceId: string, provider: Provider, ok: boolean, error?: string) {
    const existing = await this.prisma.integrationConnection.findUnique({ where: { workspaceId_provider: { workspaceId, provider } } });
    if (!existing) {
      if (!ok) await this.prisma.integrationConnection.create({ data: { workspaceId, provider, status: 'ERROR', lastError: error?.slice(0, 500) } });
      return;
    }
    const connectedStatus = existing.credentialsEnc || provider === 'SLACK' || provider === 'GOOGLE' ? 'CONNECTED' : existing.status;
    await this.prisma.integrationConnection.update({
      where: { id: existing.id },
      data: ok ? { status: connectedStatus, lastOkAt: new Date(), lastError: null } : { status: 'ERROR', lastError: error?.slice(0, 500) ?? 'Unknown error' },
    });
    if (!ok || existing.status === 'ERROR') this.realtime.toWorkspace(workspaceId, 'integration:status', { provider, status: ok ? 'CONNECTED' : 'ERROR', error: ok ? null : error });
  }
}
