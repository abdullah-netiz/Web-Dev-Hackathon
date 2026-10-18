import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';

import { AlertsService, type AlertJob } from '../alerts/alerts.service';
import { JOB_NAMES, QUEUES } from '../jobs/queues';
import { MessagingService } from '../messaging/messaging.service';
import { ProviderError } from './providers/twilio.provider';

/**
 * Outbound provider calls run here, never on the request path (I5.5, I5.8). The Twilio sandbox allows one
 * message every 3 seconds, so the queue is rate-limited globally; permanent errors stop retrying.
 */
@Processor(QUEUES.integrations, { concurrency: 3, limiter: { max: 1, duration: 3000 } })
export class OutboundProcessor extends WorkerHost {
  private readonly logger = new Logger(OutboundProcessor.name);

  constructor(private readonly messaging: MessagingService) {
    super();
  }

  async process(job: Job<{ workspaceId: string; messageId: string }>) {
    if (job.name !== JOB_NAMES.sendMessage) {
      this.logger.warn(`Unknown integrations job ${job.name}`);
      return null;
    }
    const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    try {
      await this.messaging.deliver(job.data.workspaceId, job.data.messageId, job.attemptsMade + 1, isLastAttempt);
      return { delivered: true };
    } catch (error) {
      if (error instanceof ProviderError && !error.retryable) throw new UnrecoverableError(error.message);
      throw error;
    }
  }
}

/** Telegram alerts: ~30 msg/s is the bot-wide limit; 25/s keeps a margin. Three attempts with backoff (I4.4). */
@Processor(QUEUES.alerts, { concurrency: 5, limiter: { max: 25, duration: 1000 } })
export class AlertsProcessor extends WorkerHost {
  private readonly logger = new Logger(AlertsProcessor.name);

  constructor(private readonly alerts: AlertsService) {
    super();
  }

  async process(job: Job<AlertJob>) {
    const attempts = Math.min(job.opts.attempts ?? 3, 3);
    const isLastAttempt = job.attemptsMade + 1 >= attempts;
    try {
      await this.alerts.deliver(job.data, job.attemptsMade + 1, isLastAttempt);
      return { done: true };
    } catch (error) {
      if (isLastAttempt || (error instanceof ProviderError && !error.retryable)) {
        this.logger.warn(`Alert for assignment ${job.data.assignmentId} failed permanently: ${(error as Error).message}`);
        throw new UnrecoverableError((error as Error).message);
      }
      throw error;
    }
  }
}
