import { Body, Controller, Get, Header, Inject, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { CurrentUser, Public, RequirePermission } from '../auth/auth.decorators';
import type { AuthContext } from '../auth/auth.types';
import { ENV, type Env } from '../common/env';
import { DomainError } from '../common/http-exception.filter';
import { paginationSchema } from '../common/pagination';
import { PrismaService } from '../common/prisma.service';
import { zodDto } from '../common/zod-validation.pipe';
import { ActivitiesService } from '../crm/activities.service';
import { filtersSchema } from '../crm/list-filters';
import { renderIntakeForm } from './intake-form';
import { LeadsService } from './leads.service';

const contactInput = z.object({
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().max(60).optional(),
  email: z.string().trim().email().optional().or(z.literal('')).transform((value) => value || undefined),
  phone: z.string().trim().min(7).max(20).optional().or(z.literal('')).transform((value) => value || undefined),
});

class IntakeDto extends zodDto(contactInput.extend({ message: z.string().trim().min(1).max(2000), company: z.string().trim().max(120).optional(), website: z.string().max(200).optional() }).refine((value) => value.email || value.phone, { message: 'Give an email or a phone number', path: ['email'] })) {}

class CreateLeadDto extends zodDto(
  z.object({
    title: z.string().trim().min(1).max(120),
    notes: z.string().trim().max(5000).optional(),
    contactId: z.string().uuid().optional(),
    contact: contactInput.optional(),
    opportunityId: z.string().uuid().optional(),
  }).refine((value) => value.contactId || value.contact, { message: 'contactId or contact is required', path: ['contactId'] }),
) {}

class ListDto extends zodDto(
  paginationSchema.extend({
    status: z.enum(['NEW', 'ASSIGNED', 'ACKNOWLEDGED', 'CLOSED']).optional(),
    mine: z.coerce.boolean().optional(),
    filters: z.string().optional().transform((value, ctx) => {
      if (!value) return undefined;
      try { return filtersSchema.parse(JSON.parse(value)); } catch { ctx.addIssue({ code: 'custom', message: 'filters must be JSON' }); return z.NEVER; }
    }),
  }),
) {}
class PaginationDto extends zodDto(paginationSchema) {}
class ReassignDto extends zodDto(z.object({ toUserId: z.string().uuid(), reason: z.string().trim().max(200).optional() })) {}
class CloseDto extends zodDto(z.object({ reason: z.string().trim().min(1).max(200) })) {}

@Controller()
export class LeadsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly activities: ActivitiesService,
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ── Public intake (F3.1) ──

  @Public()
  @Get('f/:slug')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async form(@Param('slug') slug: string) {
    const workspace = await this.prisma.workspace.findUnique({ where: { slug } });
    if (!workspace) throw new DomainError('WORKSPACE_NOT_FOUND', 'This form does not exist.', 404);
    return renderIntakeForm({ slug, workspaceName: workspace.name, apiBase: this.env.PUBLIC_URL });
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('intake/:slug')
  async intake(@Param('slug') slug: string, @Body() body: IntakeDto) {
    const workspace = await this.prisma.workspace.findUnique({ where: { slug } });
    if (!workspace) throw new DomainError('WORKSPACE_NOT_FOUND', 'This form does not exist.', 404);
    // Honeypot: humans never see the "website" field; bots fill it. Answer normally, store nothing (Q3).
    if (body.website) return { data: { reference: randomUUID().slice(0, 8).toUpperCase(), leadId: null } };
    const lead = await this.leads.captureLead(workspace.id, {
      source: 'WEB_FORM',
      title: body.message.length > 60 ? `${body.message.slice(0, 57)}…` : body.message,
      notes: body.company ? `${body.message}\n\nCompany: ${body.company}` : body.message,
      contact: { firstName: body.firstName, lastName: body.lastName, email: body.email, phone: body.phone },
    });
    return { data: { reference: lead.id.slice(0, 8).toUpperCase(), leadId: lead.id } };
  }

  /** Public name for the lead form header. */
  @Public()
  @Get('public/workspaces/:slug')
  async publicWorkspace(@Param('slug') slug: string) {
    const workspace = await this.prisma.workspace.findUnique({ where: { slug }, select: { name: true, slug: true, timeZone: true } });
    if (!workspace) throw new DomainError('WORKSPACE_NOT_FOUND', 'This form does not exist.', 404);
    return { data: workspace };
  }

  /** Public status for the payment return page; the id is an unguessable UUID and only status/amount are exposed. */
  @Public()
  @Get('public/payments/:id')
  async publicPayment(@Param('id') id: string) {
    const payment = /^[0-9a-f-]{36}$/i.test(id) ? await this.prisma.payment.findUnique({ where: { id }, select: { status: true, amount: true, currency: true, workspace: { select: { name: true } } } }) : null;
    if (!payment) throw new DomainError('PAYMENT_NOT_FOUND', 'We could not find this payment.', 404, 'Check the link you were sent.');
    return { data: { status: payment.status, amount: Number(payment.amount), currency: payment.currency, workspaceName: payment.workspace.name } };
  }

  // ── Authenticated ──

  @Get('leads')
  async list(@CurrentUser() auth: AuthContext, @Query() query: ListDto) {
    return this.leads.list(auth, query);
  }

  @Get('leads/recovery')
  async recovery(@CurrentUser() auth: AuthContext, @Query() query: PaginationDto) {
    return this.leads.recoveryQueue(auth, query);
  }

  @Get('leads/:id')
  async get(@CurrentUser() auth: AuthContext, @Param('id') id: string) {
    return { data: await this.leads.get(auth, id) };
  }

  @Get('leads/:id/activities')
  async activitiesList(@CurrentUser() auth: AuthContext, @Param('id') id: string, @Query() query: PaginationDto) {
    await this.leads.get(auth, id);
    return this.activities.list(auth.workspaceId, 'LEAD', id, query);
  }

  @Post('leads')
  @RequirePermission('crm.create')
  async create(@CurrentUser() auth: AuthContext, @Body() body: CreateLeadDto) {
    return { data: await this.leads.createManual(auth, body) };
  }

  @Post('leads/:id/acknowledge')
  async acknowledge(@CurrentUser() auth: AuthContext, @Param('id') id: string) {
    return { data: await this.leads.acknowledge(auth, id) };
  }

  @Post('leads/:id/reassign')
  @RequirePermission('leads.reassign')
  async reassign(@CurrentUser() auth: AuthContext, @Param('id') id: string, @Body() body: ReassignDto) {
    return { data: await this.leads.reassign(auth, id, body.toUserId, body.reason) };
  }

  @Post('leads/:id/close')
  async close(@CurrentUser() auth: AuthContext, @Param('id') id: string, @Body() body: CloseDto) {
    return { data: await this.leads.close(auth, id, body.reason) };
  }
}
