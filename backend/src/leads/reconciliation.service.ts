import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { EscalationService } from './escalation.service';
import { LeadsRepository } from './leads.repository';

/** Re-arms every pending timer on boot so a restart cannot lose an ack window (F3.8, Q5). */
@Injectable()
export class ReconciliationService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly repository: LeadsRepository,
    private readonly escalation: EscalationService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const pending = await this.repository.allPendingAssignments();
    for (const assignment of pending) {
      await this.escalation.enqueue(assignment.leadId, assignment.id, assignment.dueAt);
    }
    this.logger.log(`Re-armed ${pending.length} pending escalation timer(s).`);
  }
}
