import { Module } from '@nestjs/common';
import { CompaniesController } from './companies/companies.controller';
import { CompaniesRepository } from './companies/companies.repository';
import { CompaniesService } from './companies/companies.service';
import { ContactsController } from './contacts/contacts.controller';
import { ContactsRepository } from './contacts/contacts.repository';
import { ContactsService } from './contacts/contacts.service';
import { OpportunitiesController } from './opportunities/opportunities.controller';
import { OpportunitiesRepository } from './opportunities/opportunities.repository';
import { OpportunitiesService } from './opportunities/opportunities.service';

/** CRM: companies, contacts, opportunities, pipelines, custom fields, activities. */
@Module({
  controllers: [CompaniesController, ContactsController, OpportunitiesController],
  providers: [
    CompaniesService,
    CompaniesRepository,
    ContactsService,
    ContactsRepository,
    OpportunitiesService,
    OpportunitiesRepository,
  ],
})
export class CrmModule {}
