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
import { CustomFieldsService } from './custom-fields.service';
import {
  createCustomFieldSchema,
  listCustomFieldsSchema,
  updateCustomFieldSchema,
  type CreateCustomFieldInput,
  type UpdateCustomFieldInput,
} from './dto/custom-field.dto';

@Controller('custom-fields')
export class CustomFieldsController {
  constructor(private readonly customFields: CustomFieldsService) {}

  @Get()
  @RequirePermission('crm.view')
  async list(
    @CurrentUser() user: SessionUser,
    @Query(new ZodValidationPipe(listCustomFieldsSchema))
    query: { entity?: 'CONTACT' | 'COMPANY' | 'OPPORTUNITY'; includeArchived?: 'true' | 'false' },
  ) {
    return {
      data: await this.customFields.list(user.workspaceId, {
        entity: query.entity,
        includeArchived: query.includeArchived === 'true',
      }),
    };
  }

  @Post()
  @RequirePermission('crm.configure')
  async create(
    @CurrentUser() user: SessionUser,
    @Body(new ZodValidationPipe(createCustomFieldSchema)) body: CreateCustomFieldInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return { data: await this.customFields.create(user, body, request.ip) };
  }

  @Patch(':id')
  @RequirePermission('crm.configure')
  async update(
    @CurrentUser() user: SessionUser,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updateCustomFieldSchema)) body: UpdateCustomFieldInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return { data: await this.customFields.update(user, params.id, body, request.ip) };
  }

  @Delete(':id')
  @RequirePermission('crm.configure')
  @HttpCode(200)
  async archive(
    @CurrentUser() user: SessionUser,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Req() request: AuthenticatedRequest,
  ) {
    await this.customFields.archive(user, params.id, request.ip);
    return { data: { ok: true } };
  }
}
