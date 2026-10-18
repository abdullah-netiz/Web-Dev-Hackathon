import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Patch,
  Query,
  Req,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import type { AuthenticatedRequest, SessionUser } from '../../auth/types/session-user';
import { listQuerySchema, type ListQuery } from '../../common/pagination';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { idParamSchema } from '../../common/zod';
import { CompaniesService } from './companies.service';
import {
  createCompanySchema,
  updateCompanySchema,
  type CreateCompanyInput,
  type UpdateCompanyInput,
} from './dto/company.dto';

@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get()
  @RequirePermission('crm.view')
  list(
    @CurrentUser() user: SessionUser,
    @Query(new ZodValidationPipe(listQuerySchema)) query: ListQuery,
  ) {
    return this.companies.list(user.workspaceId, query);
  }

  @Get(':id')
  @RequirePermission('crm.view')
  async get(
    @CurrentUser() user: SessionUser,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return { data: await this.companies.get(user.workspaceId, params.id) };
  }

  @Post()
  @RequirePermission('crm.create')
  async create(
    @CurrentUser() user: SessionUser,
    @Body(new ZodValidationPipe(createCompanySchema)) body: CreateCompanyInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return { data: await this.companies.create(user, body, request.ip) };
  }

  @Patch(':id')
  @RequirePermission('crm.edit')
  async update(
    @CurrentUser() user: SessionUser,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updateCompanySchema)) body: UpdateCompanyInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return { data: await this.companies.update(user, params.id, body, request.ip) };
  }

  @Delete(':id')
  @RequirePermission('crm.delete')
  @HttpCode(200)
  async remove(
    @CurrentUser() user: SessionUser,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Req() request: AuthenticatedRequest,
  ) {
    await this.companies.remove(user, params.id, request.ip);
    return { data: { ok: true } };
  }
}
