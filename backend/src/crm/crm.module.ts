import { Module } from '@nestjs/common';
import { ActivitiesController } from './activities/activities.controller';
import { ActivitiesRepository } from './activities/activities.repository';
import { ActivitiesService } from './activities/activities.service';
import { CompaniesController } from './companies/companies.controller';
import { CompaniesRepository } from './companies/companies.repository';
import { CompaniesService } from './companies/companies.service';
import { ContactsController } from './contacts/contacts.controller';
import { ContactsRepository } from './contacts/contacts.repository';
import { ContactsService } from './contacts/contacts.service';
import { CustomFieldsController } from './custom-fields/custom-fields.controller';
import { CustomFieldsRepository } from './custom-fields/custom-fields.repository';
import { CustomFieldsService } from './custom-fields/custom-fields.service';
import { OpportunitiesController } from './opportunities/opportunities.controller';
import { OpportunitiesRepository } from './opportunities/opportunities.repository';
import { OpportunitiesService } from './opportunities/opportunities.service';
import { PipelinesController } from './pipelines/pipelines.controller';
import { PipelinesRepository } from './pipelines/pipelines.repository';
import { PipelinesService } from './pipelines/pipelines.service';

@Module({  controllers: [
    CompaniesController,
    ContactsController,
    OpportunitiesController,
    PipelinesController,
    CustomFieldsController,
    ActivitiesController,
  ],
  providers: [
    CompaniesService,
    CompaniesRepository,
    ContactsService,
    ContactsRepository,
    OpportunitiesService,
    OpportunitiesRepository,
    PipelinesService,
    PipelinesRepository,
    CustomFieldsService,
    CustomFieldsRepository,
    ActivitiesService,
    ActivitiesRepository,
  ],
})
export class CrmModule {}
