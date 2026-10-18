import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import type { AuthenticatedRequest, SessionUser } from '../../auth/types/session-user';
import { listQuerySchema, type ListQuery } from '../../common/pagination';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { idParamSchema, optionalString } from '../../common/zod';
import { serializeOpportunities, serializeOpportunity } from '../serializers';
import { OpportunitiesService } from './opportunities.service';
import {
  createOpportunitySchema,
  updateOpportunitySchema,
  type CreateOpportunityInput,
  type UpdateOpportunityInput,
} from './dto/opportunity.dto';

const listOpportunitiesSchema = listQuerySchema.extend({
  stageId: optionalString(40),
  ownerId: optionalString(40),
});

@Controller('opportunities')
export class OpportunitiesController {
  constructor(private readonly opportunities: OpportunitiesService) {}

  @Get()
  @RequirePermission('crm.view')
  async list(
    @CurrentUser() user: SessionUser,
    @Query(new ZodValidationPipe(listOpportunitiesSchema))
    query: ListQuery & { stageId?: string; ownerId?: string },
  ) {
    const { data, meta } = await this.opportunities.list(user.workspaceId, query, {
      stageId: query.stageId,
      ownerId: query.ownerId,
    });
    return { data: serializeOpportunities(data, user.permissions), meta };
  }

  @Get(':id')
  @RequirePermission('crm.view')
  async get(
    @CurrentUser() user: SessionUser,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    const opportunity = await this.opportunities.get(user.workspaceId, params.id);
    return { data: serializeOpportunity(opportunity, user.permissions) };
  }

  @Post()
  @RequirePermission('crm.create')
  async create(
    @CurrentUser() user: SessionUser,
    @Body(new ZodValidationPipe(createOpportunitySchema)) body: CreateOpportunityInput,
    @Req() request: AuthenticatedRequest,
  ) {
    const created = await this.opportunities.create(user, body, request.ip);
    return { data: serializeOpportunity(created, user.permissions) };
  }

  @Patch(':id')
  @RequirePermission('crm.edit')
  async update(
    @CurrentUser() user: SessionUser,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updateOpportunitySchema)) body: UpdateOpportunityInput,
    @Req() request: AuthenticatedRequest,
  ) {
    const updated = await this.opportunities.update(user, params.id, body, request.ip);
    return { data: serializeOpportunity(updated, user.permissions) };
  }

  @Delete(':id')
  @RequirePermission('crm.delete')
  @HttpCode(200)
  async remove(
    @CurrentUser() user: SessionUser,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Req() request: AuthenticatedRequest,
  ) {
    await this.opportunities.remove(user, params.id, request.ip);
    return { data: { ok: true } };
  }
}
