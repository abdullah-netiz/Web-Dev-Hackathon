import { InjectQueue } from '@nestjs/bullmq';
import { Body, Controller, Headers, HttpCode, Inject, Logger, Param, Post, Req, type RawBodyRequest } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Queue } from 'bullmq';
import type { FastifyRequest } from 'fastify';

import { Public } from '../auth/auth.decorators';
import { ENV, type Env } from '../common/env';
import { DomainError } from '../common/http-exception.filter';
import { JOB_NAMES, QUEUES } from '../jobs/queues';
import { ConnectionsService, type TwilioCredentials } from './connections.service';
import { IntegrationEventsService } from './integration-events.service';
import { LemonSqueezyProvider, type LemonSqueezyCredentials, type LemonSqueezyWebhook } from './providers/lemonsqueezy.provider';
import { TwilioProvider } from './providers/twilio.provider';

export type InboundJob =
  | { kind: 'twilio.message'; workspaceId: string; eventId: string; params: Record<string, string> }
  | { kind: 'twilio.status'; workspaceId: string; eventId: string; params: Record<string, string> }
  | { kind: 'lemonsqueezy.event'; workspaceId: string; eventId: string; event: LemonSqueezyWebhook };

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
    private readonly lemonSqueezy: LemonSqueezyProvider,
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

  /** Lemon Squeezy signs the raw body (X-Signature, HMAC-SHA256); verified before any record changes (I2.3). */
  @Post('lemonsqueezy/:workspaceId')
  @HttpCode(200)
  async lemonSqueezyWebhook(@Param('workspaceId') workspaceId: string, @Headers('x-signature') signature: string | undefined, @Req() req: RawBodyRequest<FastifyRequest>) {
    const stored = await this.connections.credentials<LemonSqueezyCredentials>(workspaceId, 'LEMONSQUEEZY');
    if (!stored) throw new DomainError('PAYMENTS_NOT_CONNECTED', 'Lemon Squeezy is not connected for this workspace.', 404);
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    if (!this.lemonSqueezy.verifyWebhook(stored.credentials.webhookSecret, rawBody, signature)) {
      await this.events.markRejected({ workspaceId, provider: 'LEMONSQUEEZY', direction: 'IN', type: 'webhook.rejected', payload: { event: (req.body as LemonSqueezyWebhook | undefined)?.meta?.event_name } }, 'X-Signature verification failed');
      await this.connections.markHealth(workspaceId, 'LEMONSQUEEZY', false, 'A webhook with an invalid signature was rejected. Check the webhook signing secret.');
      throw new DomainError('INVALID_SIGNATURE', 'Webhook signature verification failed.', 400);
    }
    const event = req.body as LemonSqueezyWebhook;
    if (!event?.meta?.event_name || !event.data?.id) throw new DomainError('INVALID_PAYLOAD', 'Unexpected webhook payload.', 400);
    // No event id is sent, so the order id + event + its last update time identifies one delivery (retries repeat all three)
    const attributes = event.data.attributes ?? {};
    const externalEventId = `${event.meta.event_name}:${event.data.id}:${String(attributes.updated_at ?? '')}:${String(attributes.refunded_amount ?? '')}`;
    const { id, duplicate } = await this.events.record({ workspaceId, provider: 'LEMONSQUEEZY', direction: 'IN', type: event.meta.event_name, externalEventId, payload: { event: event.meta.event_name, orderId: event.data.id, status: attributes.status, testMode: event.meta.test_mode } });
    if (!duplicate) await this.inbound.add(JOB_NAMES.processInbound, { kind: 'lemonsqueezy.event', workspaceId, eventId: id, event }, { jobId: `ls-${id}` });
    return { received: true, duplicate };
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
}
