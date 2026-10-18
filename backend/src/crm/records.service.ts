import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { actorLabel, hasPermission, type AuthContext } from '../auth/auth.types';
import { DomainEvents } from '../common/domain-events';
import { DomainError } from '../common/http-exception.filter';
import { PrismaService } from '../common/prisma.service';
import { cursorWhere, pageResult, type Pagination } from '../common/pagination';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { ActivitiesService } from './activities.service';
import { CustomFieldsService } from './custom-fields.service';
import { compileFilters, type Filters } from './list-filters';
import { PipelinesService } from './pipelines.service';

const CONTACT_INCLUDE = {
  company: { select: { id: true, name: true } },
  owner: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.ContactInclude;

const OPPORTUNITY_INCLUDE = {
  contact: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
  company: { select: { id: true, name: true } },
  stage: { select: { id: true, name: true, isWon: true, isLost: true, order: true } },
  owner: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.OpportunityInclude;

/**
 * Companies, contacts and opportunities (F2.1, F2.4, F2.8). Opportunity `value` is removed for
 * callers without `crm.view_values` (F1.4) in every place that returns opportunities.
 */
@Injectable()
export class RecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly activities: ActivitiesService,
    private readonly customFields: CustomFieldsService,
    private readonly pipelines: PipelinesService,
    private readonly realtime: RealtimeGateway,
    private readonly events: DomainEvents,
  ) {}

  // ───────────── Companies ─────────────

  async listCompanies(auth: AuthContext, query: Pagination & { filters?: Filters }) {
    const where: Prisma.CompanyWhereInput = { workspaceId: auth.workspaceId, ...compileFilters(query.filters, ['name', 'domain']), ...cursorWhere(query.cursor) };
    const [rows, total] = await Promise.all([
      this.prisma.company.findMany({ where, include: { owner: { select: { id: true, firstName: true, lastName: true } }, _count: { select: { contacts: true, opportunities: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.limit + 1 }),
      this.prisma.company.count({ where: { workspaceId: auth.workspaceId, ...compileFilters(query.filters, ['name', 'domain']) } }),
    ]);
    return pageResult(rows, query.limit, total);
  }

  async getCompany(auth: AuthContext, id: string) {
    const company = await this.prisma.company.findFirst({ where: { id, workspaceId: auth.workspaceId }, include: { owner: { select: { id: true, firstName: true, lastName: true } }, contacts: { take: 50, orderBy: { createdAt: 'desc' } } } });
    if (!company) throw new NotFoundException({ code: 'COMPANY_NOT_FOUND', message: 'Company not found.' });
    const opportunities = await this.prisma.opportunity.findMany({ where: { workspaceId: auth.workspaceId, companyId: id }, include: OPPORTUNITY_INCLUDE, orderBy: { createdAt: 'desc' }, take: 50 });
    return { ...company, opportunities: this.maskValues(auth, opportunities) };
  }

  async createCompany(auth: AuthContext, input: { name: string; domain?: string; ownerId?: string | null; custom?: Record<string, unknown> }) {
    const custom = await this.customFields.validateCustom(auth.workspaceId, 'COMPANY', input.custom ?? {});
    return this.prisma.$transaction(async (tx) => {
      const company = await tx.company.create({ data: { workspaceId: auth.workspaceId, name: input.name, domain: input.domain, ownerId: input.ownerId ?? auth.userId, custom: custom as Prisma.InputJsonValue } });
      await this.activities.logTx(tx, { workspaceId: auth.workspaceId, entityType: 'COMPANY', entityId: company.id, type: 'created', actorId: auth.userId });
      return company;
    });
  }

  async updateCompany(auth: AuthContext, id: string, input: Partial<{ name: string; domain: string | null; ownerId: string | null; custom: Record<string, unknown>; version: number }>) {
    const before = await this.prisma.company.findFirst({ where: { id, workspaceId: auth.workspaceId } });
    if (!before) throw new NotFoundException({ code: 'COMPANY_NOT_FOUND', message: 'Company not found.' });
    const custom = input.custom ? await this.customFields.validateCustom(auth.workspaceId, 'COMPANY', input.custom, { existing: before.custom as Record<string, unknown> }) : undefined;
    const { version, custom: _ignored, ...data } = input;
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.company.updateMany({ where: { id, workspaceId: auth.workspaceId, ...(version ? { version } : {}) }, data: { ...data, ...(custom ? { custom: custom as Prisma.InputJsonValue } : {}), version: { increment: 1 } } });
      if (result.count === 0) throw new DomainError('VERSION_CONFLICT', 'This company was changed by someone else. Reload and try again.', 409);
      const after = await tx.company.findUniqueOrThrow({ where: { id } });
      await this.activities.logTx(tx, { workspaceId: auth.workspaceId, entityType: 'COMPANY', entityId: id, type: 'field_edit', actorId: auth.userId, payload: diff(before, after, ['name', 'domain', 'ownerId', 'custom']) });
      return after;
    });
  }

  async deleteCompany(auth: AuthContext, id: string) {
    const company = await this.prisma.company.findFirst({ where: { id, workspaceId: auth.workspaceId } });
    if (!company) throw new NotFoundException({ code: 'COMPANY_NOT_FOUND', message: 'Company not found.' });
    await this.prisma.$transaction(async (tx) => {
      // Contacts and opportunities keep existing with companyId = null (SetNull), nothing dangles (Q4)
      await tx.company.delete({ where: { id } });
      await this.audit.recordTx(tx, { workspaceId: auth.workspaceId, actorId: auth.userId, actorLabel: actorLabel(auth), action: 'company.deleted', targetType: 'company', targetId: id, before: { name: company.name }, after: null });
    });
    return { deleted: true };
  }

  // ───────────── Contacts ─────────────

  async listContacts(auth: AuthContext, query: Pagination & { filters?: Filters }) {
    const base: Prisma.ContactWhereInput = { workspaceId: auth.workspaceId, ...compileFilters(query.filters, ['firstName', 'lastName', 'email', 'phone']) };
    const [rows, total] = await Promise.all([
      this.prisma.contact.findMany({ where: { ...base, ...cursorWhere(query.cursor) }, include: CONTACT_INCLUDE, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.limit + 1 }),
      this.prisma.contact.count({ where: base }),
    ]);
    return pageResult(rows, query.limit, total);
  }

  async getContact(auth: AuthContext, id: string) {
    const contact = await this.prisma.contact.findFirst({ where: { id, workspaceId: auth.workspaceId }, include: CONTACT_INCLUDE });
    if (!contact) throw new NotFoundException({ code: 'CONTACT_NOT_FOUND', message: 'Contact not found.' });
    return contact;
  }

  /** F2.8: one page shows conversations, opportunities, payments, appointments, the assigned employee and history. */
  async contactOverview(auth: AuthContext, id: string) {
    const contact = await this.getContact(auth, id);
    const [opportunities, leads, conversations, payments, appointments, timeline] = await Promise.all([
      this.prisma.opportunity.findMany({ where: { workspaceId: auth.workspaceId, contactId: id }, include: OPPORTUNITY_INCLUDE, orderBy: { createdAt: 'desc' } }),
      this.prisma.lead.findMany({ where: { workspaceId: auth.workspaceId, contactId: id }, include: { currentAssignee: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { createdAt: 'desc' } }),
      this.prisma.conversation.findMany({ where: { workspaceId: auth.workspaceId, contactId: id }, include: { assignee: { select: { id: true, firstName: true, lastName: true } }, messages: { orderBy: { createdAt: 'desc' }, take: 1 } } }),
      this.prisma.payment.findMany({ where: { workspaceId: auth.workspaceId, contactId: id }, orderBy: { createdAt: 'desc' } }),
      this.prisma.appointment.findMany({ where: { workspaceId: auth.workspaceId, contactId: id }, include: { user: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { startsAt: 'desc' } }),
      this.activities.contactTimeline(auth.workspaceId, id, { limit: 50 }),
    ]);
    return {
      contact,
      opportunities: this.maskValues(auth, opportunities),
      leads,
      conversations,
      payments: hasPermission(auth, 'crm.view_values') ? payments : payments.map((payment) => ({ ...payment, amount: null, refundedAmount: null })),
      appointments,
      timeline: timeline.data,
    };
  }

  async createContact(auth: AuthContext, input: { firstName: string; lastName?: string; email?: string; phone?: string; companyId?: string | null; ownerId?: string | null; tags?: string[]; custom?: Record<string, unknown>; source?: string }, actorId: string | null = auth.userId) {
    const custom = await this.customFields.validateCustom(auth.workspaceId, 'CONTACT', input.custom ?? {});
    if (input.companyId) await this.assertCompany(auth.workspaceId, input.companyId);
    const phone = input.phone ? normalizePhone(input.phone) : undefined;
    if (phone) {
      const clash = await this.prisma.contact.findUnique({ where: { workspaceId_phone: { workspaceId: auth.workspaceId, phone } } });
      if (clash) throw new DomainError('PHONE_EXISTS', `A contact with phone ${phone} already exists (${clash.firstName} ${clash.lastName}).`, 409, 'Open the existing contact instead.');
    }
    return this.prisma.$transaction(async (tx) => {
      const contact = await tx.contact.create({
        data: { workspaceId: auth.workspaceId, firstName: input.firstName, lastName: input.lastName ?? '', email: input.email?.toLowerCase(), phone, companyId: input.companyId ?? null, ownerId: input.ownerId ?? actorId, tags: input.tags ?? [], custom: custom as Prisma.InputJsonValue, source: input.source },
        include: CONTACT_INCLUDE,
      });
      await this.activities.logTx(tx, { workspaceId: auth.workspaceId, entityType: 'CONTACT', entityId: contact.id, type: 'created', actorId, payload: { source: input.source ?? 'manual' } });
      return contact;
    });
  }

  async updateContact(auth: AuthContext, id: string, input: Partial<{ firstName: string; lastName: string; email: string | null; phone: string | null; companyId: string | null; ownerId: string | null; tags: string[]; optedOut: boolean; custom: Record<string, unknown>; version: number }>) {
    const before = await this.getContact(auth, id);
    if (input.companyId) await this.assertCompany(auth.workspaceId, input.companyId);
    const custom = input.custom ? await this.customFields.validateCustom(auth.workspaceId, 'CONTACT', input.custom, { existing: before.custom as Record<string, unknown> }) : undefined;
    const { version, custom: _ignored, ...data } = input;
    const phone = data.phone === undefined ? undefined : data.phone ? normalizePhone(data.phone) : null;
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.contact.updateMany({
        where: { id, workspaceId: auth.workspaceId, ...(version ? { version } : {}) },
        data: { ...data, ...(phone !== undefined ? { phone } : {}), ...(data.email ? { email: data.email.toLowerCase() } : {}), ...(custom ? { custom: custom as Prisma.InputJsonValue } : {}), version: { increment: 1 } },
      });
      if (result.count === 0) throw new DomainError('VERSION_CONFLICT', 'This contact was changed by someone else. Reload and try again.', 409);
      const after = await tx.contact.findUniqueOrThrow({ where: { id }, include: CONTACT_INCLUDE });
      await this.activities.logTx(tx, { workspaceId: auth.workspaceId, entityType: 'CONTACT', entityId: id, type: 'field_edit', actorId: auth.userId, payload: diff(before, after, ['firstName', 'lastName', 'email', 'phone', 'companyId', 'ownerId', 'tags', 'optedOut', 'custom']) });
      if (input.optedOut !== undefined && input.optedOut !== before.optedOut) {
        await this.audit.recordTx(tx, { workspaceId: auth.workspaceId, actorId: auth.userId, actorLabel: actorLabel(auth), action: input.optedOut ? 'contact.opted_out' : 'contact.opted_in', targetType: 'contact', targetId: id, before: { optedOut: before.optedOut }, after: { optedOut: input.optedOut } });
      }
      return after;
    });
  }

  /** Contacts with opportunities, leads, payments or appointments cannot be deleted (RESTRICT) — the API says so (Q4, Q10). */
  async deleteContact(auth: AuthContext, id: string) {
    const contact = await this.getContact(auth, id);
    const [opportunities, leads, payments, appointments] = await Promise.all([
      this.prisma.opportunity.count({ where: { contactId: id } }),
      this.prisma.lead.count({ where: { contactId: id } }),
      this.prisma.payment.count({ where: { contactId: id } }),
      this.prisma.appointment.count({ where: { contactId: id } }),
    ]);
    if (opportunities + leads + payments + appointments > 0) {
      throw new DomainError('CONTACT_IN_USE', `This contact has ${opportunities} opportunities, ${leads} leads, ${payments} payments and ${appointments} appointments.`, 409, 'Close or move those records first; the contact cannot be deleted while they exist.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.contact.delete({ where: { id } });
      await this.audit.recordTx(tx, { workspaceId: auth.workspaceId, actorId: auth.userId, actorLabel: actorLabel(auth), action: 'contact.deleted', targetType: 'contact', targetId: id, before: { firstName: contact.firstName, lastName: contact.lastName, phone: contact.phone, email: contact.email }, after: null });
    });
    return { deleted: true };
  }

  /** Used by messaging intake (I1.5): find by E.164 phone or create a minimal contact. */
  async findOrCreateByPhone(workspaceId: string, phone: string, profileName?: string) {
    const normalized = normalizePhone(phone);
    const existing = await this.prisma.contact.findUnique({ where: { workspaceId_phone: { workspaceId, phone: normalized } } });
    if (existing) return { contact: existing, created: false };
    const [firstName, ...rest] = (profileName ?? 'Unknown').trim().split(/\s+/);
    const contact = await this.prisma.contact.create({ data: { workspaceId, firstName: firstName || 'Unknown', lastName: rest.join(' '), phone: normalized, source: 'whatsapp' } });
    await this.activities.log({ workspaceId, entityType: 'CONTACT', entityId: contact.id, type: 'created', actorId: null, payload: { source: 'whatsapp' } });
    return { contact, created: true };
  }

  // ───────────── Opportunities ─────────────

  async listOpportunities(auth: AuthContext, query: Pagination & { filters?: Filters; pipelineId?: string }) {
    const base: Prisma.OpportunityWhereInput = { workspaceId: auth.workspaceId, ...(query.pipelineId ? { pipelineId: query.pipelineId } : {}), ...compileFilters(query.filters, ['name']) };
    const [rows, total] = await Promise.all([
      this.prisma.opportunity.findMany({ where: { ...base, ...cursorWhere(query.cursor) }, include: OPPORTUNITY_INCLUDE, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.limit + 1 }),
      this.prisma.opportunity.count({ where: base }),
    ]);
    const page = pageResult(rows, query.limit, total);
    return { ...page, data: this.maskValues(auth, page.data) };
  }

  /** Kanban board: stages with their opportunities (F2.5). */
  async board(auth: AuthContext, pipelineId?: string) {
    const pipeline = pipelineId ? await this.prisma.pipeline.findFirst({ where: { id: pipelineId, workspaceId: auth.workspaceId }, include: { stages: { orderBy: { order: 'asc' } } } }) : await this.pipelines.defaultPipeline(auth.workspaceId);
    if (!pipeline) throw new NotFoundException({ code: 'PIPELINE_NOT_FOUND', message: 'Pipeline not found.' });
    const opportunities = await this.prisma.opportunity.findMany({ where: { workspaceId: auth.workspaceId, pipelineId: pipeline.id }, include: OPPORTUNITY_INCLUDE, orderBy: { updatedAt: 'desc' }, take: 500 });
    const masked = this.maskValues(auth, opportunities);
    const canSeeValues = hasPermission(auth, 'crm.view_values');
    return {
      pipeline: { id: pipeline.id, name: pipeline.name },
      stages: pipeline.stages.map((stage) => {
        const items = masked.filter((opportunity) => opportunity.stageId === stage.id);
        return { ...stage, opportunities: items, totalValue: canSeeValues ? items.reduce((sum, item) => sum + Number(item.value ?? 0), 0) : null };
      }),
    };
  }

  async getOpportunity(auth: AuthContext, id: string) {
    const opportunity = await this.prisma.opportunity.findFirst({ where: { id, workspaceId: auth.workspaceId }, include: { ...OPPORTUNITY_INCLUDE, payments: { orderBy: { createdAt: 'desc' } }, appointments: { orderBy: { startsAt: 'desc' } }, leads: { select: { id: true, status: true, currentAssigneeId: true } } } });
    if (!opportunity) throw new NotFoundException({ code: 'OPPORTUNITY_NOT_FOUND', message: 'Opportunity not found.' });
    const [masked] = this.maskValues(auth, [opportunity]);
    const fields = await this.customFields.list(auth.workspaceId, 'OPPORTUNITY');
    return { ...masked, customFieldDefinitions: fields.filter((field) => !field.pipelineId || field.pipelineId === opportunity.pipelineId) };
  }

  async createOpportunity(auth: AuthContext, input: { name: string; contactId: string; companyId?: string | null; pipelineId?: string; stageId?: string; ownerId?: string | null; value?: number | null; currency?: string; closeDate?: string | null; custom?: Record<string, unknown> }, actorId: string | null = auth.userId) {
    const contact = await this.prisma.contact.findFirst({ where: { id: input.contactId, workspaceId: auth.workspaceId } });
    if (!contact) throw new NotFoundException({ code: 'CONTACT_NOT_FOUND', message: 'Contact not found.' });
    const pipeline = input.pipelineId ? await this.prisma.pipeline.findFirst({ where: { id: input.pipelineId, workspaceId: auth.workspaceId }, include: { stages: { orderBy: { order: 'asc' } } } }) : await this.pipelines.defaultPipeline(auth.workspaceId);
    if (!pipeline || pipeline.stages.length === 0) throw new NotFoundException({ code: 'PIPELINE_NOT_FOUND', message: 'Pipeline not found or has no stages.' });
    const stage = input.stageId ? pipeline.stages.find((candidate) => candidate.id === input.stageId) : pipeline.stages[0];
    if (!stage) throw new DomainError('STAGE_NOT_IN_PIPELINE', 'The stage does not belong to this pipeline.', 422);
    const custom = await this.customFields.validateCustom(auth.workspaceId, 'OPPORTUNITY', input.custom ?? {}, { pipelineId: pipeline.id });
    this.assertStageRequirements(stage, { value: input.value ?? null, custom });
    const workspace = await this.prisma.workspace.findUniqueOrThrow({ where: { id: auth.workspaceId } });

    const opportunity = await this.prisma.$transaction(async (tx) => {
      const created = await tx.opportunity.create({
        data: { workspaceId: auth.workspaceId, name: input.name, contactId: contact.id, companyId: input.companyId ?? contact.companyId, pipelineId: pipeline.id, stageId: stage.id, ownerId: input.ownerId ?? actorId, value: input.value ?? null, currency: input.currency ?? workspace.currency, closeDate: input.closeDate ? new Date(input.closeDate) : null, custom: custom as Prisma.InputJsonValue },
        include: OPPORTUNITY_INCLUDE,
      });
      await this.activities.logTx(tx, { workspaceId: auth.workspaceId, entityType: 'OPPORTUNITY', entityId: created.id, type: 'created', actorId, payload: { stage: stage.name } });
      return created;
    });
    return this.maskValues(auth, [opportunity])[0];
  }

  async updateOpportunity(auth: AuthContext, id: string, input: Partial<{ name: string; companyId: string | null; ownerId: string | null; value: number | null; currency: string; closeDate: string | null; custom: Record<string, unknown>; version: number }>) {
    const before = await this.prisma.opportunity.findFirst({ where: { id, workspaceId: auth.workspaceId }, include: { stage: true } });
    if (!before) throw new NotFoundException({ code: 'OPPORTUNITY_NOT_FOUND', message: 'Opportunity not found.' });
    if (input.value !== undefined && !hasPermission(auth, 'crm.view_values')) {
      throw new DomainError('PERMISSION_DENIED', 'You cannot edit opportunity values.', 403, 'Ask for the crm.view_values permission.');
    }
    const custom = input.custom ? await this.customFields.validateCustom(auth.workspaceId, 'OPPORTUNITY', input.custom, { pipelineId: before.pipelineId, existing: before.custom as Record<string, unknown> }) : undefined;
    const { version, custom: _ignored, closeDate, ...data } = input;
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.opportunity.updateMany({
        where: { id, workspaceId: auth.workspaceId, ...(version ? { version } : {}) },
        data: { ...data, ...(closeDate !== undefined ? { closeDate: closeDate ? new Date(closeDate) : null } : {}), ...(custom ? { custom: custom as Prisma.InputJsonValue } : {}), version: { increment: 1 } },
      });
      if (result.count === 0) throw new DomainError('VERSION_CONFLICT', 'This opportunity was changed by someone else. Reload and try again.', 409);
      const after = await tx.opportunity.findUniqueOrThrow({ where: { id }, include: OPPORTUNITY_INCLUDE });
      await this.activities.logTx(tx, { workspaceId: auth.workspaceId, entityType: 'OPPORTUNITY', entityId: id, type: 'field_edit', actorId: auth.userId, payload: diff(before, after, ['name', 'companyId', 'ownerId', 'value', 'currency', 'closeDate', 'custom']) });
      return after;
    });
    this.events.emit('opportunity.activity', { workspaceId: auth.workspaceId, opportunityId: id, actorId: auth.userId, type: 'field_edit' });
    return this.maskValues(auth, [updated])[0];
  }

  /** F2.4: moving into a stage with required fields is blocked with a clear message until they are filled. */
  async moveStage(auth: AuthContext, id: string, stageId: string, version?: number) {
    const opportunity = await this.prisma.opportunity.findFirst({ where: { id, workspaceId: auth.workspaceId }, include: { stage: true } });
    if (!opportunity) throw new NotFoundException({ code: 'OPPORTUNITY_NOT_FOUND', message: 'Opportunity not found.' });
    const target = await this.pipelines.getStage(auth.workspaceId, stageId);
    if (target.pipelineId !== opportunity.pipelineId) throw new DomainError('STAGE_OTHER_PIPELINE', 'The stage belongs to another pipeline.', 422);
    this.assertStageRequirements(target, { value: opportunity.value === null ? null : Number(opportunity.value), custom: opportunity.custom as Record<string, unknown> });

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.opportunity.updateMany({ where: { id, workspaceId: auth.workspaceId, ...(version ? { version } : {}) }, data: { stageId, version: { increment: 1 }, ...(target.isWon || target.isLost ? { closeDate: new Date() } : {}) } });
      if (result.count === 0) throw new DomainError('VERSION_CONFLICT', 'This opportunity was moved by someone else. Reload and try again.', 409);
      const after = await tx.opportunity.findUniqueOrThrow({ where: { id }, include: OPPORTUNITY_INCLUDE });
      await this.activities.logTx(tx, { workspaceId: auth.workspaceId, entityType: 'OPPORTUNITY', entityId: id, type: 'stage_change', actorId: auth.userId, payload: { from: opportunity.stage.name, to: target.name, fromStageId: opportunity.stageId, toStageId: stageId } });
      return after;
    });
    this.events.emit('opportunity.activity', { workspaceId: auth.workspaceId, opportunityId: id, actorId: auth.userId, type: 'stage_change' });
    this.realtime.toWorkspace(auth.workspaceId, 'lead:updated', { opportunityId: id, stageId });
    return this.maskValues(auth, [updated])[0];
  }

  async deleteOpportunity(auth: AuthContext, id: string) {
    const opportunity = await this.prisma.opportunity.findFirst({ where: { id, workspaceId: auth.workspaceId } });
    if (!opportunity) throw new NotFoundException({ code: 'OPPORTUNITY_NOT_FOUND', message: 'Opportunity not found.' });
    const payments = await this.prisma.payment.count({ where: { opportunityId: id } });
    if (payments > 0) throw new DomainError('OPPORTUNITY_HAS_PAYMENTS', 'This opportunity has payment records and cannot be deleted.', 409, 'Move it to a Lost stage instead.');
    await this.prisma.$transaction(async (tx) => {
      await tx.opportunity.delete({ where: { id } });
      await this.audit.recordTx(tx, { workspaceId: auth.workspaceId, actorId: auth.userId, actorLabel: actorLabel(auth), action: 'opportunity.deleted', targetType: 'opportunity', targetId: id, before: { name: opportunity.name, stageId: opportunity.stageId, value: opportunity.value }, after: null });
    });
    return { deleted: true };
  }

  async addNote(auth: AuthContext, entityType: 'CONTACT' | 'COMPANY' | 'OPPORTUNITY' | 'LEAD', entityId: string, body: string) {
    await this.assertEntity(auth.workspaceId, entityType, entityId);
    const activity = await this.activities.log({ workspaceId: auth.workspaceId, entityType, entityId, type: 'note', actorId: auth.userId, payload: { body } });
    if (entityType === 'LEAD') this.activities.notifyLeadActivity(auth.workspaceId, entityId, auth.userId, 'note');
    if (entityType === 'OPPORTUNITY') this.events.emit('opportunity.activity', { workspaceId: auth.workspaceId, opportunityId: entityId, actorId: auth.userId, type: 'note' });
    return activity;
  }

  // ───────────── Export (F1.4 applies) ─────────────

  async exportCsv(auth: AuthContext, entity: 'contacts' | 'opportunities', filters?: Filters): Promise<string> {
    if (entity === 'contacts') {
      const rows = await this.prisma.contact.findMany({ where: { workspaceId: auth.workspaceId, ...compileFilters(filters, ['firstName', 'lastName', 'email', 'phone']) }, include: CONTACT_INCLUDE, orderBy: { createdAt: 'desc' }, take: 5000 });
      const definitions = await this.customFields.list(auth.workspaceId, 'CONTACT');
      const header = ['id', 'firstName', 'lastName', 'email', 'phone', 'company', 'owner', 'tags', 'optedOut', 'createdAt', ...definitions.map((d) => `custom:${d.key}`)];
      return toCsv(header, rows.map((row) => [row.id, row.firstName, row.lastName, row.email ?? '', row.phone ?? '', row.company?.name ?? '', row.owner ? `${row.owner.firstName} ${row.owner.lastName}` : '', row.tags.join('|'), row.optedOut, row.createdAt.toISOString(), ...definitions.map((d) => (row.custom as Record<string, unknown>)[d.key] ?? '')]));
    }
    const rows = await this.prisma.opportunity.findMany({ where: { workspaceId: auth.workspaceId, ...compileFilters(filters, ['name']) }, include: OPPORTUNITY_INCLUDE, orderBy: { createdAt: 'desc' }, take: 5000 });
    const masked = this.maskValues(auth, rows);
    const definitions = await this.customFields.list(auth.workspaceId, 'OPPORTUNITY');
    const header = ['id', 'name', 'contact', 'company', 'stage', 'owner', 'value', 'currency', 'paymentStatus', 'closeDate', 'createdAt', ...definitions.map((d) => `custom:${d.key}`)];
    return toCsv(header, masked.map((row) => [row.id, row.name, `${row.contact.firstName} ${row.contact.lastName}`, row.company?.name ?? '', row.stage.name, row.owner ? `${row.owner.firstName} ${row.owner.lastName}` : '', row.value === null ? '' : String(row.value), row.currency, row.paymentStatus, row.closeDate?.toISOString() ?? '', row.createdAt.toISOString(), ...definitions.map((d) => (row.custom as Record<string, unknown>)[d.key] ?? '')]));
  }

  // ───────────── helpers ─────────────

  /** F1.4: hide amounts from users without the permission, everywhere opportunities are returned. */
  maskValues<T extends { value: unknown }>(auth: AuthContext, rows: T[]): (Omit<T, 'value'> & { value: number | null; valueHidden: boolean })[] {
    const canSee = hasPermission(auth, 'crm.view_values');
    return rows.map((row) => ({ ...row, value: canSee && row.value !== null && row.value !== undefined ? Number(row.value) : null, valueHidden: !canSee }));
  }

  private assertStageRequirements(stage: { name: string; requiredFieldKeys: string[] }, record: { value: number | null; custom: Record<string, unknown> }) {
    const missing = stage.requiredFieldKeys.filter((key) => {
      const value = key === 'value' ? record.value : record.custom[key];
      return value === null || value === undefined || value === '';
    });
    if (missing.length > 0) {
      throw new DomainError('STAGE_REQUIREMENTS_UNMET', `Cannot move to "${stage.name}" until these fields are filled: ${missing.join(', ')}.`, 422, 'Fill the fields and try again.', );
    }
  }

  private async assertCompany(workspaceId: string, companyId: string) {
    const company = await this.prisma.company.findFirst({ where: { id: companyId, workspaceId } });
    if (!company) throw new NotFoundException({ code: 'COMPANY_NOT_FOUND', message: 'Company not found.' });
  }

  private async assertEntity(workspaceId: string, entityType: string, entityId: string) {
    const found =
      entityType === 'CONTACT'
        ? await this.prisma.contact.findFirst({ where: { id: entityId, workspaceId }, select: { id: true } })
        : entityType === 'COMPANY'
          ? await this.prisma.company.findFirst({ where: { id: entityId, workspaceId }, select: { id: true } })
          : entityType === 'OPPORTUNITY'
            ? await this.prisma.opportunity.findFirst({ where: { id: entityId, workspaceId }, select: { id: true } })
            : await this.prisma.lead.findFirst({ where: { id: entityId, workspaceId }, select: { id: true } });
    if (!found) throw new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Record not found.' });
  }
}

export function normalizePhone(input: string): string {
  const digits = input.replace(/^whatsapp:/i, '').replace(/[^\d+]/g, '');
  const normalized = digits.startsWith('+') ? `+${digits.slice(1).replace(/\+/g, '')}` : `+${digits}`;
  if (!/^\+[1-9]\d{6,14}$/.test(normalized)) throw new DomainError('INVALID_PHONE', 'Phone must be in international format, e.g. +14155551234.', 422);
  return normalized;
}

function diff(before: object, after: object, keys: string[]) {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of keys) {
    const a = JSON.stringify((before as Record<string, unknown>)[key]);
    const b = JSON.stringify((after as Record<string, unknown>)[key]);
    if (a !== b) changes[key] = { from: (before as Record<string, unknown>)[key], to: (after as Record<string, unknown>)[key] };
  }
  return { changes };
}

function toCsv(header: string[], rows: unknown[][]): string {
  const escape = (value: unknown) => {
    const text = value === null || value === undefined ? '' : String(value);
    // Neutralise spreadsheet formula injection (Q3) and quote as needed
    const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [header.join(','), ...rows.map((row) => row.map(escape).join(','))].join('\r\n');
}
