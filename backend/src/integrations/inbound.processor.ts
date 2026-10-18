import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';

import { AlertsService } from '../alerts/alerts.service';
import { QUEUES } from '../jobs/queues';
import { MessagingService } from '../messaging/messaging.service';
import { PaymentsService } from '../payments/payments.service';
import { IntegrationEventsService } from './integration-events.service';
import type { InboundJob } from './webhooks.controller';

/** Processes verified inbound events off the request path. Each handler is idempotent (I1.8, I2.4). */
@Processor(QUEUES.inbound, { concurrency: 10 })
export class InboundProcessor extends WorkerHost {
  private readonly logger = new Logger(InboundProcessor.name);

  constructor(
    private readonly events: IntegrationEventsService,
    private readonly messaging: MessagingService,
    private readonly payments: PaymentsService,
    private readonly alerts: AlertsService,
  ) {
    super();
  }

  async process(job: Job<InboundJob>) {
    const data = job.data;
    try {
      let related: { relatedType: string; relatedId: string } | undefined;
      switch (data.kind) {
        case 'twilio.message':
          related = await this.messaging.handleInbound(data.workspaceId, data.params);
          break;
        case 'twilio.status':
          related = await this.messaging.handleStatus(data.workspaceId, data.params);
          break;
        case 'stripe.event':
          related = await this.payments.handleEvent(data.workspaceId, data.event);
          break;
        case 'telegram.update':
          related = await this.alerts.handleTelegramUpdate(data.update);
          break;
      }
      await this.events.markProcessed(data.eventId, related);
      return related ?? null;
    } catch (error) {
      const message = (error as Error).message;
      this.logger.error(`Inbound ${data.kind} failed (attempt ${job.attemptsMade + 1}): ${message}`);
      const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (lastAttempt || error instanceof UnrecoverableError) await this.events.markFailed(data.eventId, message);
      throw error;
    }
  }
}
