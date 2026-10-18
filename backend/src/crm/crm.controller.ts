import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';

import { CurrentUser, RequirePermission } from '../auth/auth.decorators';
import type { AuthContext } from '../auth/auth.types';
import { paginationSchema } from '../common/pagination';
import { zodDto } from '../common/zod-validation.pipe';
import { ActivitiesService } from './activities.service';
import { CustomFieldsService } from './custom-fields.service';
import { filtersSchema } from './list-filters';
import { PipelinesService } from './pipelines.service';
import { RecordsService } from './records.service';
import { SavedListsService } from './saved-lists.service';

const entityEnum = z.enum(['CONTACT', 'COMPANY', 'OPPORTUNITY']);
const custom = z.record(z.string(), z.unknown());

/** `filters` arrives as a JSON string in the query (`?filters={"criteria":[...]}`) or as a saved list id. */
const listQuery = paginationSchema.extend({
  filters: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (!value) return undefined;
      try {
        return filtersSchema.parse(JSON.parse(value));
      } catch {
        ctx.addIssue({ code: 'custom', message: 'filters must be a JSON object { logic, criteria, search }' });
        return z.NEVER;
      }
    }),
  search: z.string().max(120).optional(),
  listId: z.string().uuid().optional(),
});
class ListQueryDto extends zodDto(listQuery) {}
class OpportunityListQueryDto extends zodDto(listQuery.extend({ pipelineId: z.string().uuid().optional() })) {}
class PaginationDto extends zodDto(paginationSchema) {}

class CompanyDto extends zodDto(z.object({ name: z.string().trim().min(1).max(120), domain: z.string().trim().max(120).optional(), industry: z.string().trim().max(80).optional(), city: z.string().trim().max(80).optional(), ownerId: z.string().uuid().nullable().optional(), custom: custom.optional() })) {}
class CompanyUpdateDto extends zodDto(z.object({ name: z.string().trim().min(1).max(120).optional(), domain: z.string().trim().max(120).nullable().optional(), industry: z.string().trim().max(80).nullable().optional(), city: z.string().trim().max(80).nullable().optional(), ownerId: z.string().uuid().nullable().optional(), custom: custom.optional(), version: z.number().int().positive().optional() })) {}

class ContactDto extends zodDto(
  z.object({
    firstName: z.string().trim().min(1).max(60),
    lastName: z.string().trim().max(60).optional(),
    email: z.string().trim().email().optional(),
    phone: z.string().trim().min(7).max(20).optional(),
    companyId: z.string().uuid().nullable().optional(),
    ownerId: z.string().uuid().nullable().optional(),
    tags: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
    custom: custom.optional(),
  }),
) {}
class ContactUpdateDto extends zodDto(
  z.object({
    firstName: z.string().trim().min(1).max(60).optional(),
    lastName: z.string().trim().max(60).optional(),
    email: z.string().trim().email().nullable().optional(),
    phone: z.string().trim().min(7).max(20).nullable().optional(),
    companyId: z.string().uuid().nullable().optional(),
    ownerId: z.string().uuid().nullable().optional(),
    tags: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
    optedOut: z.boolean().optional(),
    custom: custom.optional(),
    version: z.number().int().positive().optional(),
  }),
) {}

class OpportunityDto extends zodDto(
  z.object({
    name: z.string().trim().min(1).max(120),
    contactId: z.string().uuid(),
    companyId: z.string().uuid().nullable().optional(),
    pipelineId: z.string().uuid().optional(),
    stageId: z.string().uuid().optional(),
    ownerId: z.string().uuid().nullable().optional(),
    value: z.number().nonnegative().max(1e12).nullable().optional(),
    currency: z.string().length(3).toUpperCase().optional(),
    closeDate: z.string().datetime().nullable().optional(),
    custom: custom.optional(),
  }),
) {}
class OpportunityUpdateDto extends zodDto(
  z.object({
    name: z.string().trim().min(1).max(120).optional(),
    companyId: z.string().uuid().nullable().optional(),
    ownerId: z.string().uuid().nullable().optional(),
    value: z.number().nonnegative().max(1e12).nullable().optional(),
    currency: z.string().length(3).toUpperCase().optional(),
    closeDate: z.string().datetime().nullable().optional(),
    custom: custom.optional(),
    version: z.number().int().positive().optional(),
  }),
) {}
class MoveStageDto extends zodDto(z.object({ stageId: z.string().uuid(), version: z.number().int().positive().optional() })) {}
class NoteDto extends zodDto(z.object({ body: z.string().trim().min(1).max(5000) })) {}

class FieldDto extends zodDto(z.object({ entity: entityEnum, label: z.string().trim().min(1).max(60), type: z.enum(['TEXT', 'NUMBER', 'DATE', 'DROPDOWN', 'CHECKBOX']), options: z.array(z.string().trim().min(1).max(60)).max(50).optional(), pipelineId: z.string().uuid().nullable().optional(), isRequired: z.boolean().optional() })) {}
class FieldUpdateDto extends zodDto(z.object({ label: z.string().trim().min(1).max(60).optional(), options: z.array(z.string().trim().min(1).max(60)).max(50).optional(), isRequired: z.boolean().optional(), order: z.number().int().min(0).optional(), version: z.number().int().positive().optional() })) {}
class FieldsQueryDto extends zodDto(z.object({ entity: entityEnum.optional(), includeArchived: z.coerce.boolean().default(false) })) {}

class PipelineDto extends zodDto(z.object({ name: z.string().trim().min(1).max(60), stages: z.array(z.string().trim().min(1).max(40)).max(20).optional() })) {}
class PipelineRenameDto extends zodDto(z.object({ name: z.string().trim().min(1).max(60) })) {}
class StageDto extends zodDto(z.object({ name: z.string().trim().min(1).max(40), isWon: z.boolean().optional(), isLost: z.boolean().optional(), requiredFieldKeys: z.array(z.string()).max(20).optional(), color: z.string().max(20).optional() })) {}
class StageUpdateDto extends zodDto(z.object({ name: z.string().trim().min(1).max(40).optional(), isWon: z.boolean().optional(), isLost: z.boolean().optional(), requiredFieldKeys: z.array(z.string()).max(20).optional(), color: z.string().max(20).optional(), version: z.number().int().positive().optional() })) {}
class ReorderDto extends zodDto(z.object({ stageIds: z.array(z.string().uuid()).min(1) })) {}
class DeleteStageQueryDto extends zodDto(z.object({ moveToStageId: z.string().uuid().optional() })) {}

class SavedListDto extends zodDto(z.object({ entity: entityEnum, name: z.string().trim().min(1).max(60), filters: filtersSchema, isShared: z.boolean().optional() })) {}
class SavedListUpdateDto extends zodDto(z.object({ name: z.string().trim().min(1).max(60).optional(), filters: filtersSchema.optional(), isShared: z.boolean().optional(), version: z.number().int().positive().optional() })) {}
class SavedListsQueryDto extends zodDto(z.object({ entity: entityEnum.optional() })) {}
class ExportQueryDto extends zodDto(z.object({ filters: listQuery.shape.filters })) {}

@Controller()
export class CrmController {
  constructor(
    private readonly records: RecordsService,
    private readonly fields: CustomFieldsService,
    private readonly pipelines: PipelinesService,
    private readonly savedLists: SavedListsService,
    private readonly activities: ActivitiesService,
  ) {}

  private async resolveFilters(auth: AuthContext, query: { filters?: ReturnType<typeof filtersSchema.parse>; search?: string; listId?: string }) {
    const filters = query.listId ? (await this.savedLists.get(auth, query.listId)).filters : query.filters;
    if (query.search) return { ...(filters ?? { logic: 'AND' as const, criteria: [] }), search: query.search };
    return filters;
  }

  // ── Companies ──
  @Get('companies') @RequirePermission('crm.view')
  async companies(@CurrentUser() auth: AuthContext, @Query() query: ListQueryDto) {
    return this.records.listCompanies(auth, { ...query, filters: await this.resolveFilters(auth, query) });
  }
  @Get('companies/:id') @RequirePermission('crm.view')
  async company(@CurrentUser() auth: AuthContext, @Param('id') id: string) { return { data: await this.records.getCompany(auth, id) }; }
  @Post('companies') @RequirePermission('crm.create')
  async createCompany(@CurrentUser() auth: AuthContext, @Body() body: CompanyDto) { return { data: await this.records.createCompany(auth, body) }; }
  @Patch('companies/:id') @RequirePermission('crm.edit')
  async updateCompany(@CurrentUser() auth: AuthContext, @Param('id') id: string, @Body() body: CompanyUpdateDto) { return { data: await this.records.updateCompany(auth, id, body) }; }
  @Delete('companies/:id') @RequirePermission('crm.delete')
  async deleteCompany(@CurrentUser() auth: AuthContext, @Param('id') id: string) { return { data: await this.records.deleteCompany(auth, id) }; }

  // ── Contacts ──
  @Get('contacts') @RequirePermission('crm.view')
  async contacts(@CurrentUser() auth: AuthContext, @Query() query: ListQueryDto) {
    return this.records.listContacts(auth, { ...query, filters: await this.resolveFilters(auth, query) });
  }
  @Get('contacts/tags') @RequirePermission('crm.view')
  async tags(@CurrentUser() auth: AuthContext) { return { data: await this.records.contactTags(auth) }; }
  @Get('contacts/export.csv') @RequirePermission('crm.view', 'crm.export') @Header('Content-Type', 'text/csv; charset=utf-8') @Header('Content-Disposition', 'attachment; filename="contacts.csv"')
  exportContacts(@CurrentUser() auth: AuthContext, @Query() query: ExportQueryDto) { return this.records.exportCsv(auth, 'contacts', query.filters); }
  @Get('contacts/:id') @RequirePermission('crm.view')
  async contact(@CurrentUser() auth: AuthContext, @Param('id') id: string) { return { data: await this.records.getContact(auth, id) }; }
  @Get('contacts/:id/overview') @RequirePermission('crm.view')
  async overview(@CurrentUser() auth: AuthContext, @Param('id') id: string) { return { data: await this.records.contactOverview(auth, id) }; }
  @Get('contacts/:id/activities') @RequirePermission('crm.view')
  activitiesForContact(@CurrentUser() auth: AuthContext, @Param('id') id: string, @Query() query: PaginationDto) { return this.activities.contactTimeline(auth.workspaceId, id, query); }
  @Post('contacts') @RequirePermission('crm.create')
  async createContact(@CurrentUser() auth: AuthContext, @Body() body: ContactDto) { return { data: await this.records.createContact(auth, { ...body, source: 'manual' }) }; }
  @Patch('contacts/:id') @RequirePermission('crm.edit')
  async updateContact(@CurrentUser() auth: AuthContext, @Param('id') id: string, @Body() body: ContactUpdateDto) { return { data: await this.records.updateContact(auth, id, body) }; }
  @Delete('contacts/:id') @RequirePermission('crm.delete')
  async deleteContact(@CurrentUser() auth: AuthContext, @Param('id') id: string) { return { data: await this.records.deleteContact(auth, id) }; }

  // ── Opportunities ──
  @Get('opportunities') @RequirePermission('crm.view')
  async opportunities(@CurrentUser() auth: AuthContext, @Query() query: OpportunityListQueryDto) {
    return this.records.listOpportunities(auth, { ...query, filters: await this.resolveFilters(auth, query) });
  }
  @Get('opportunities/board') @RequirePermission('crm.view')
  async board(@CurrentUser() auth: AuthContext, @Query('pipelineId') pipelineId?: string) { return { data: await this.records.board(auth, pipelineId || undefined) }; }
  @Get('opportunities/export.csv') @RequirePermission('crm.view', 'crm.export') @Header('Content-Type', 'text/csv; charset=utf-8') @Header('Content-Disposition', 'attachment; filename="opportunities.csv"')
  exportOpportunities(@CurrentUser() auth: AuthContext, @Query() query: ExportQueryDto) { return this.records.exportCsv(auth, 'opportunities', query.filters); }
  @Get('opportunities/:id') @RequirePermission('crm.view')
  async opportunity(@CurrentUser() auth: AuthContext, @Param('id') id: string) { return { data: await this.records.getOpportunity(auth, id) }; }
  @Get('opportunities/:id/activities') @RequirePermission('crm.view')
  activitiesForOpportunity(@CurrentUser() auth: AuthContext, @Param('id') id: string, @Query() query: PaginationDto) { return this.activities.list(auth.workspaceId, 'OPPORTUNITY', id, query); }
  @Post('opportunities') @RequirePermission('crm.create')
  async createOpportunity(@CurrentUser() auth: AuthContext, @Body() body: OpportunityDto) { return { data: await this.records.createOpportunity(auth, body) }; }
  @Patch('opportunities/:id') @RequirePermission('crm.edit')
  async updateOpportunity(@CurrentUser() auth: AuthContext, @Param('id') id: string, @Body() body: OpportunityUpdateDto) { return { data: await this.records.updateOpportunity(auth, id, body) }; }
  @Post('opportunities/:id/move') @RequirePermission('crm.edit')
  async move(@CurrentUser() auth: AuthContext, @Param('id') id: string, @Body() body: MoveStageDto) { return { data: await this.records.moveStage(auth, id, body.stageId, body.version) }; }
  @Delete('opportunities/:id') @RequirePermission('crm.delete')
  async deleteOpportunity(@CurrentUser() auth: AuthContext, @Param('id') id: string) { return { data: await this.records.deleteOpportunity(auth, id) }; }

  // ── Notes & activities ──
  @Post(':entity/:id/notes') @RequirePermission('crm.edit')
  async note(@CurrentUser() auth: AuthContext, @Param('entity') entity: string, @Param('id') id: string, @Body() body: NoteDto) {
    const map: Record<string, 'CONTACT' | 'COMPANY' | 'OPPORTUNITY' | 'LEAD'> = { contacts: 'CONTACT', companies: 'COMPANY', opportunities: 'OPPORTUNITY', leads: 'LEAD' };
    const entityType = map[entity];
    if (!entityType) return { code: 'UNKNOWN_ENTITY', message: 'Entity must be contacts, companies, opportunities or leads.' };
    return { data: await this.records.addNote(auth, entityType, id, body.body) };
  }

  // ── Custom fields (F2.2) ──
  @Get('custom-fields') @RequirePermission('crm.view')
  async customFields(@CurrentUser() auth: AuthContext, @Query() query: FieldsQueryDto) { return { data: await this.fields.list(auth.workspaceId, query.entity, query.includeArchived) }; }
  @Post('custom-fields') @RequirePermission('settings.manage')
  async createField(@CurrentUser() auth: AuthContext, @Body() body: FieldDto) { return { data: await this.fields.create(auth, body) }; }
  @Patch('custom-fields/:id') @RequirePermission('settings.manage')
  async updateField(@CurrentUser() auth: AuthContext, @Param('id') id: string, @Body() body: FieldUpdateDto) { return { data: await this.fields.update(auth, id, body) }; }
  @Delete('custom-fields/:id') @RequirePermission('settings.manage')
  async archiveField(@CurrentUser() auth: AuthContext, @Param('id') id: string) { return { data: await this.fields.archive(auth, id) }; }

  // ── Pipelines & stages (F2.5) ──
  @Get('pipelines') @RequirePermission('crm.view')
  async pipelinesList(@CurrentUser() auth: AuthContext) { return { data: await this.pipelines.list(auth.workspaceId) }; }
  @Patch('pipelines/:id') @RequirePermission('settings.manage')
  async renamePipeline(@CurrentUser() auth: AuthContext, @Param('id') id: string, @Body() body: PipelineRenameDto) { return { data: await this.pipelines.rename(auth, id, body.name) }; }
  @Post('pipelines') @RequirePermission('settings.manage')
  async createPipeline(@CurrentUser() auth: AuthContext, @Body() body: PipelineDto) { return { data: await this.pipelines.create(auth, body) }; }
  @Post('pipelines/:id/stages') @RequirePermission('settings.manage')
  async addStage(@CurrentUser() auth: AuthContext, @Param('id') id: string, @Body() body: StageDto) { return { data: await this.pipelines.addStage(auth, id, body) }; }
  @Put('pipelines/:id/stages/order') @RequirePermission('settings.manage')
  async reorder(@CurrentUser() auth: AuthContext, @Param('id') id: string, @Body() body: ReorderDto) { return { data: await this.pipelines.reorderStages(auth, id, body.stageIds) }; }
  @Patch('stages/:id') @RequirePermission('settings.manage')
  async updateStage(@CurrentUser() auth: AuthContext, @Param('id') id: string, @Body() body: StageUpdateDto) { return { data: await this.pipelines.updateStage(auth, id, body) }; }
  @Delete('stages/:id') @RequirePermission('settings.manage')
  async deleteStage(@CurrentUser() auth: AuthContext, @Param('id') id: string, @Query() query: DeleteStageQueryDto) { return { data: await this.pipelines.deleteStage(auth, id, query.moveToStageId) }; }

  // ── Saved lists (F2.6) ──
  @Get('saved-lists') @RequirePermission('crm.view')
  async savedListsList(@CurrentUser() auth: AuthContext, @Query() query: SavedListsQueryDto) { return { data: await this.savedLists.list(auth, query.entity) }; }
  @Post('saved-lists') @RequirePermission('crm.view')
  async createSavedList(@CurrentUser() auth: AuthContext, @Body() body: SavedListDto) { return { data: await this.savedLists.create(auth, body) }; }
  @Patch('saved-lists/:id') @RequirePermission('crm.view')
  async updateSavedList(@CurrentUser() auth: AuthContext, @Param('id') id: string, @Body() body: SavedListUpdateDto) { return { data: await this.savedLists.update(auth, id, body) }; }
  @Delete('saved-lists/:id') @RequirePermission('crm.view')
  async deleteSavedList(@CurrentUser() auth: AuthContext, @Param('id') id: string) { return { data: await this.savedLists.delete(auth, id) }; }
}
