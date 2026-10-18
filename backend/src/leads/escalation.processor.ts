import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { UnrecoverableError } from 'bullmq';
import { EscalationService } from './escalation.service';
import { ESCALATION_JOB, LEADS_QUEUE } from './leads.constants';

@Injectable()
@Processor(LEADS_QUEUE)
export class EscalationProcessor extends WorkerHost {
  constructor(private readonly escalation: EscalationService) {
    super();
  }

  async process(job: Job<{ leadId: string; assignmentId: string }>): Promise<void> {
    if (job.name !== ESCALATION_JOB) {
      throw new UnrecoverableError(`Unknown lead job "${job.name}".`);
    }
    await this.escalation.handleExpiry(job.data.assignmentId);
  }
}
