import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { ActivitiesService } from './activities.service';
import { CrmController } from './crm.controller';
import { CustomFieldsService } from './custom-fields.service';
import { PipelinesService } from './pipelines.service';
import { RecordsService } from './records.service';
import { SavedListsService } from './saved-lists.service';

@Module({
  imports: [AuditModule],
  controllers: [CrmController],
  providers: [ActivitiesService, CustomFieldsService, PipelinesService, RecordsService, SavedListsService],
  exports: [ActivitiesService, CustomFieldsService, PipelinesService, RecordsService],
})
export class CrmModule {}
