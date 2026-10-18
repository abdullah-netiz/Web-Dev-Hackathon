import { Module } from '@nestjs/common';
import { CompaniesController } from './companies/companies.controller';
import { CompaniesRepository } from './companies/companies.repository';
import { CompaniesService } from './companies/companies.service';

/** CRM: companies, contacts, opportunities, pipelines, custom fields, activities. */
@Module({
  controllers: [CompaniesController],
  providers: [CompaniesService, CompaniesRepository],
})
export class CrmModule {}
