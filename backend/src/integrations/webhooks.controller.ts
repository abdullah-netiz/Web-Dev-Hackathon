import { InjectQueue } from '@nestjs/bullmq';
import { Body, Controller, Headers, HttpCode, Inject, Logger, Param, Post, Req, type RawBodyRequest } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Queue } from 'bullmq';
import type { FastifyRequest } from 'fastify';

import { Public } from '../auth/auth.decorators';
import { safeEqual } from '../common/encryption';
import { ENV, type Env } from '../common/env';
import { DomainError } from '../common/http-exception.filter';
import { PrismaService } from '../common/prisma.service';
import { JOB_NAMES, QUEUES } from '../jobs/queues';
import { ConnectionsService, type StripeCredentials, type TwilioCredentials } from './connections.service';
import { IntegrationEventsService } from './integration-events.service';
import { StripeProvider } from './providers/stripe.provider';
import { TwilioProvider } from './providers/twilio.provider';

export type InboundJob =
  | { kind: 'twilio.message'; workspaceId: string; eventId: string; params: Record<string, string> }
  | { kind: 'twilio.status'; workspaceId: string; eventId: string; params: Record<string, string> }
  | { kind: 'stripe.event'; workspaceId: string; eventId: string; event: unknown }
  | { kind: 'telegram.update'; eventId: string; update: unknown };

/**
 * Inbound webhooks (I1.2, I2.3, I5.4). Pattern: verify the signature on the raw request → record the event
 * (unique external id = idempotency) → 2xx immediately → process in the `inbound` queue (I1.8, I2.4).
 */
@Controller('webhooks')
@Public()
@SkipThrottle()
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly connections: ConnectionsService,
    private readonly events: IntegrationEventsService,
    private readonly twilio: TwilioProvider,
    private readonly stripe: StripeProvider,
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUES.inbound) private readonly inbound: Queue<InboundJob>,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Twilio posts application/x-www-form-urlencoded; the signature covers the public URL plus sorted params. */
  @Post('twilio/:workspaceId')
  @HttpCode(200)
  async twilioInbound(@Param('workspaceId') workspaceId: string, @Body() body: Record<string, string>, @Headers('x-twilio-signature') signature: string | undefined, @Req() req: FastifyRequest) {
    const params = await this.verifyTwilio(workspaceId, body, signature, req, 'message.received');
    const { id, duplicate } = await this.events.record({ workspaceId, provider: 'TWILIO', direction: 'IN', type: 'message.received', externalEventId: params.MessageSid, payload: params });
    if (!duplicate) await this.inbound.add(JOB_NAMES.processInbound, { kind: 'twilio.message', workspaceId, eventId: id, params }, { jobId: `twilio-${params.MessageSid}` });
    // Empty TwiML: no auto-reply; replies are sent by employees from the platform
    return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
  }

  @Post('twilio/:workspaceId/status')
  @HttpCode(200)
  async twilioStatus(@Param('workspaceId') workspaceId: string, @Body() body: Record<string, string>, @Headers('x-twilio-signature') signature: string | undefined, @Req() req: FastifyRequest) {
    const params = await this.verifyTwilio(workspaceId, body, signature, req, 'message.status');
    // Each status is a distinct event; the (sid, status) pair is its natural id
    const externalEventId = `${params.MessageSid}:${params.MessageStatus}`;
    const { id, duplicate } = await this.events.record({ workspaceId, provider: 'TWILIO', direction: 'IN', type: `message.status.${params.MessageStatus}`, externalEventId, payload: params });
    if (!duplicate) await this.inbound.add(JOB_NAMES.processInbound, { kind: 'twilio.status', workspaceId, eventId: id, params }, { jobId: `twilio-status-${params.MessageSid}-${params.MessageStatus}` });
    return { received: true };
  }

  /** Stripe signs the raw body; constructEvent verifies it (5-minute tolerance) before any record changes (I2.3). */
  @Post('stripe/:workspaceId')
  @HttpCode(200)
  async stripeWebhook(@Param('workspaceId') workspaceId: string, @Headers('stripe-signature') signature: string | undefined, @Req() req: RawBodyRequest<FastifyRequest>) {
    const stored = await this.connections.credentials<StripeCredentials>(workspaceId, 'STRIPE');
    if (!stored) throw new DomainError('STRIPE_NOT_CONNECTED', 'Stripe is not connected for this workspace.', 404);
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    let event;
    try {
      event = this.stripe.parseEvent(stored.credentials, rawBody, signature);
    } catch (error) {
      const reason = (error as Error).message;
      await this.events.markRejected({ workspaceId, provider: 'STRIPE', direction: 'IN', type: 'webhook.rejected', payload: { reason } }, `Signature verification failed: ${reason}`);
      await this.connections.markHealth(workspaceId, 'STRIPE', false, 'A webhook with an invalid signature was rejected. Check the webhook signing secret.');
      throw new DomainError('INVALID_SIGNATURE', 'Webhook signature verification failed.', 400);
    }
    const objectId = (event.data.object as { id?: string }).id;
    const { id, duplicate } = await this.events.record({ workspaceId, provider: 'STRIPE', direction: 'IN', type: event.type, externalEventId: event.id, payload: { id: event.id, type: event.type, object: objectId } });
    if (!duplicate) await this.inbound.add(JOB_NAMES.processInbound, { kind: 'stripe.event', workspaceId, eventId: id, event }, { jobId: `stripe-${event.id}` });
    return { received: true, duplicate };
  }

  /** Telegram authenticates with the secret token header set on setWebhook. The bot is shared across workspaces. */
  @Post('telegram')
  @HttpCode(200)
  async telegramWebhook(@Body() update: { update_id?: number; message?: unknown }, @Headers('x-telegram-bot-api-secret-token') secret: string | undefined) {
    const candidates = this.env.TELEGRAM_WEBHOOK_SECRET ? [this.env.TELEGRAM_WEBHOOK_SECRET] : await this.telegramSecrets();
    const valid = Boolean(secret) && candidates.some((candidate) => candidate && safeEqual(secret as string, candidate));
    if (!valid) {
      await this.events.markRejected({ provider: 'TELEGRAM', direction: 'IN', type: 'webhook.rejected', payload: { update_id: update?.update_id } }, 'Invalid or missing secret token');
      throw new DomainError('INVALID_SIGNATURE', 'Invalid Telegram secret token.', 401);
    }
    if (update?.update_id === undefined) return { received: true };
    const { id, duplicate } = await this.events.record({ provider: 'TELEGRAM', direction: 'IN', type: 'update', externalEventId: String(update.update_id), payload: update });
    if (!duplicate) await this.inbound.add(JOB_NAMES.processInbound, { kind: 'telegram.update', eventId: id, update }, { jobId: `telegram-${update.update_id}` });
    return { received: true };
  }

  private async verifyTwilio(workspaceId: string, body: Record<string, string>, signature: string | undefined, req: FastifyRequest, type: string): Promise<Record<string, string>> {
    const stored = await this.connections.credentials<TwilioCredentials>(workspaceId, 'TWILIO');
    if (!stored) throw new DomainError('TWILIO_NOT_CONNECTED', 'Twilio is not connected for this workspace.', 404);
    const params = Object.fromEntries(Object.entries(body ?? {}).map(([key, value]) => [key, String(value)]));
    // Twilio signed the public URL it called (including the query string), not our internal host
    const url = `${this.env.PUBLIC_URL}${req.url}`;
    if (!this.twilio.verifySignature(stored.credentials.authToken, signature, url, params)) {
      await this.events.markRejected({ workspaceId, provider: 'TWILIO', direction: 'IN', type: `${type}.rejected`, payload: { url, from: params.From, sid: params.MessageSid } }, 'X-Twilio-Signature verification failed');
      this.logger.warn(`Rejected Twilio webhook for workspace ${workspaceId}: bad signature for ${url}`);
      throw new DomainError('INVALID_SIGNATURE', 'Twilio signature verification failed.', 403);
    }
    if (!params.MessageSid) throw new DomainError('INVALID_PAYLOAD', 'MessageSid is required.', 400);
    return params;
  }

  private async telegramSecrets(): Promise<string[]> {
    const connections = await this.prisma.integrationConnection.findMany({ where: { provider: 'TELEGRAM', status: 'CONNECTED' }, select: { workspaceId: true } });
    const secrets: string[] = [];
    for (const connection of connections) {
      const credentials = await this.connections.telegramCredentials(connection.workspaceId);
      if (credentials?.webhookSecret) secrets.push(credentials.webhookSecret);
    }
    return secrets;
  }
}
