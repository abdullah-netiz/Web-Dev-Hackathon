import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { Job, Queue } from 'bullmq';

import { JOB_NAMES, QUEUES } from '../jobs/queues';
import { LeadsService } from './leads.service';

/** Fires when an acknowledgement window expires. At-least-once delivery; LeadsService.escalate is idempotent. */
@Processor(QUEUES.escalation, { concurrency: 5 })
export class EscalationProcessor extends WorkerHost {
  private readonly logger = new Logger(EscalationProcessor.name);

  constructor(private readonly leads: LeadsService) {
    super();
  }

  async process(job: Job<{ workspaceId: string; leadId: string; assignmentId: string }>) {
    const result = await this.leads.escalate(job.data.workspaceId, job.data.leadId, job.data.assignmentId);
    this.logger.log(`Escalation job ${job.id}: ${JSON.stringify(result)}`);
    return result;
  }
}

/** Recovery sweep every 30 s and startup reconciliation (F3.7, Q5). */
@Processor(QUEUES.housekeeping, { concurrency: 1 })
export class HousekeepingProcessor extends WorkerHost {
  private readonly logger = new Logger(HousekeepingProcessor.name);

  constructor(private readonly leads: LeadsService) {
    super();
  }

  async process(job: Job) {
    switch (job.name) {
      case JOB_NAMES.recoverySweep:
        return this.leads.recoverySweep();
      case JOB_NAMES.reconcile:
        return this.leads.reconcile();
      default:
        this.logger.warn(`Unknown housekeeping job ${job.name}`);
        return null;
    }
  }
}

@Injectable()
export class HousekeepingScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(HousekeepingScheduler.name);

  constructor(@InjectQueue(QUEUES.housekeeping) private readonly queue: Queue) {}

  async onApplicationBootstrap() {
    // Job schedulers are the BullMQ v5 replacement for repeatable jobs (docs.bullmq.io/guide/job-schedulers)
    await this.queue.upsertJobScheduler('recovery-sweep', { every: 30_000 }, { name: JOB_NAMES.recoverySweep, opts: { removeOnComplete: { count: 10 }, removeOnFail: { count: 10 } } });
    await this.queue.add(JOB_NAMES.reconcile, {}, { jobId: `reconcile-${Date.now()}`, removeOnComplete: { count: 5 } });
    this.logger.log('Housekeeping scheduled: recovery sweep every 30 s, reconciliation queued');
  }
}
