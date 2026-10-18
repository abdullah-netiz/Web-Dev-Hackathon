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
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { idParamSchema } from '../../common/zod';
import { PipelinesService } from './pipelines.service';
import {
  createPipelineSchema,
  createStageSchema,
  deleteStageSchema,
  reorderStagesSchema,
  stageParamsSchema,
  updatePipelineSchema,
  updateStageSchema,
  type CreatePipelineInput,
  type CreateStageInput,
  type UpdatePipelineInput,
  type UpdateStageInput,
} from './dto/pipeline.dto';

@Controller('pipelines')
export class PipelinesController {
  constructor(private readonly pipelines: PipelinesService) {}

  @Get()
  @RequirePermission('crm.view')
  async list(@CurrentUser() user: SessionUser) {
    return { data: await this.pipelines.list(user.workspaceId) };
  }

  @Get(':id')
  @RequirePermission('crm.view')
  async get(
    @CurrentUser() user: SessionUser,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return { data: await this.pipelines.get(user.workspaceId, params.id) };
  }

  @Post()
  @RequirePermission('crm.configure')
  async create(
    @CurrentUser() user: SessionUser,
    @Body(new ZodValidationPipe(createPipelineSchema)) body: CreatePipelineInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return { data: await this.pipelines.create(user, body, request.ip) };
  }

  @Patch(':id')
  @RequirePermission('crm.configure')
  async update(
    @CurrentUser() user: SessionUser,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updatePipelineSchema)) body: UpdatePipelineInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return { data: await this.pipelines.update(user, params.id, body, request.ip) };
  }

  @Delete(':id')
  @RequirePermission('crm.configure')
  @HttpCode(200)
  async remove(
    @CurrentUser() user: SessionUser,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Req() request: AuthenticatedRequest,
  ) {
    await this.pipelines.remove(user, params.id, request.ip);
    return { data: { ok: true } };
  }

  @Post(':id/stages')
  @RequirePermission('crm.configure')
  async createStage(
    @CurrentUser() user: SessionUser,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(createStageSchema)) body: CreateStageInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return { data: await this.pipelines.createStage(user, params.id, body, request.ip) };
  }

  @Patch(':id/stages/:stageId')
  @RequirePermission('crm.configure')
  async updateStage(
    @CurrentUser() user: SessionUser,
    @Param(new ZodValidationPipe(stageParamsSchema)) params: { id: string; stageId: string },
    @Body(new ZodValidationPipe(updateStageSchema)) body: UpdateStageInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.pipelines.updateStage(user, params.id, params.stageId, body, request.ip),
    };
  }

  @Post(':id/stages/reorder')
  @HttpCode(200)
  @RequirePermission('crm.configure')
  async reorderStages(
    @CurrentUser() user: SessionUser,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(reorderStagesSchema)) body: { stageIds: string[] },
    @Req() request: AuthenticatedRequest,
  ) {
    return { data: await this.pipelines.reorderStages(user, params.id, body.stageIds, request.ip) };
  }

  @Delete(':id/stages/:stageId')
  @HttpCode(200)
  @RequirePermission('crm.configure')
  async deleteStage(
    @CurrentUser() user: SessionUser,
    @Param(new ZodValidationPipe(stageParamsSchema)) params: { id: string; stageId: string },
    @Query(new ZodValidationPipe(deleteStageSchema)) query: { moveToStageId: string },
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      data: await this.pipelines.deleteStage(
        user,
        params.id,
        params.stageId,
        query.moveToStageId,
        request.ip,
      ),
    };
  }
}
