import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AssignmentService } from './assignment.service';
import { EscalationProcessor } from './escalation.processor';
import { EscalationService } from './escalation.service';
import { IntakeController } from './intake.controller';
import { LEADS_QUEUE } from './leads.constants';
import { LeadsController } from './leads.controller';
import { LeadsRepository } from './leads.repository';
import { LeadsService } from './leads.service';
import { ReconciliationService } from './reconciliation.service';

@Module({
  imports: [BullModule.registerQueue({ name: LEADS_QUEUE })],
  controllers: [LeadsController, IntakeController],
  providers: [
    LeadsService,
    LeadsRepository,
    AssignmentService,
    EscalationService,
    EscalationProcessor,
    ReconciliationService,
  ],
  exports: [LeadsService, LeadsRepository],
})
export class LeadsModule {}
