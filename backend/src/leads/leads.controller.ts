import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import type { AuthenticatedRequest, SessionUser } from '../auth/types/session-user';
import { notFound } from '../common/http-errors';
import { idParamSchema } from '../common/zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  assignLeadSchema,
  createLeadSchema,
  listLeadsSchema,
  updateLeadSchema,
  updateLeadSettingsSchema,
  type CreateLeadInput,
  type UpdateLeadInput,
  type UpdateLeadSettingsInput,
} from './dto/lead.dto';
import { LeadsService } from './leads.service';

@Controller('leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  @RequirePermission('leads.view')
  async list(
    @CurrentUser() user: SessionUser,
    @Query(new ZodValidationPipe(listLeadsSchema))
    query: {
      limit: number;
      cursor?: string;
      q?: string;
      status?: 'NEW' | 'ASSIGNED' | 'ACKNOWLEDGED' | 'CLOSED';
      ownerId?: string;
      unassigned?: 'true' | 'false';
    },
  ) {
    const { data, meta } = await this.leads.list(user.workspaceId, {
      limit: query.limit,
      cursor: query.cursor,
      q: query.q,
      status: query.status,
      ownerId: query.ownerId,
      unassigned: query.unassigned === 'true',
    });
    return { data, meta };
  }

  @Get('recovery')
  @RequirePermission('leads.view')
  recovery(@CurrentUser() user: SessionUser) {
    return this.leads.recovery(user.workspaceId);
  }

  @Get('settings')
  @RequirePermission('leads.view')
  async settings(@CurrentUser() user: SessionUser) {
    return { data: await this.leads.getSettings(user.workspaceId) };
  }

  @Patch('settings')
  @RequirePermission('workspace.manage')
  async updateSettings(
    @CurrentUser() user: SessionUser,
    @Body(new ZodValidationPipe(updateLeadSettingsSchema)) body: UpdateLeadSettingsInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return { data: await this.leads.updateSettings(user, body, request.ip) };
  }

  @Get(':id')
  @RequirePermission('leads.view')
  async get(
    @CurrentUser() user: SessionUser,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    const lead = await this.leads.get(user.workspaceId, params.id);
    if (!lead) {
      throw notFound('lead');
    }
    return { data: lead };
  }

  @Post()
  @RequirePermission('crm.create')
  async create(
    @CurrentUser() user: SessionUser,
    @Body(new ZodValidationPipe(createLeadSchema)) body: CreateLeadInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return { data: await this.leads.create(user, body, request.ip) };
  }

  @Patch(':id')
  @RequirePermission('crm.edit')
  async update(
    @CurrentUser() user: SessionUser,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updateLeadSchema)) body: UpdateLeadInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return { data: await this.leads.update(user, params.id, body, request.ip) };
  }

  @Post(':id/assign')
  @HttpCode(200)
  @RequirePermission('leads.reassign')
  async assign(
    @CurrentUser() user: SessionUser,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(assignLeadSchema)) body: { ownerId: string },
    @Req() request: AuthenticatedRequest,
  ) {
    return { data: await this.leads.assign(user, params.id, body.ownerId, request.ip) };
  }

  @Post(':id/acknowledge')
  @HttpCode(200)
  @RequirePermission('leads.view')
  async acknowledge(
    @CurrentUser() user: SessionUser,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Req() request: AuthenticatedRequest,
  ) {
    return { data: await this.leads.acknowledge(user, params.id, request.ip) };
  }

  @Post(':id/close')
  @HttpCode(200)
  @RequirePermission('crm.edit')
  async close(
    @CurrentUser() user: SessionUser,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Req() request: AuthenticatedRequest,
  ) {
    return { data: await this.leads.close(user, params.id, request.ip) };
  }
}
