import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { CrmModule } from '../crm/crm.module';
import { LeadsController } from './leads.controller';
import { EscalationProcessor, HousekeepingProcessor, HousekeepingScheduler } from './leads.processors';
import { LeadsService } from './leads.service';

@Module({
  imports: [AuditModule, CrmModule],
  controllers: [LeadsController],
  providers: [LeadsService, EscalationProcessor, HousekeepingProcessor, HousekeepingScheduler],
  exports: [LeadsService],
})
export class LeadsModule {}
