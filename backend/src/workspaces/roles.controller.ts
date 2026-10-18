import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import type { AuthenticatedRequest, SessionUser } from '../auth/types/session-user';
import { idParamSchema } from '../common/zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  createRoleSchema,
  updateRoleSchema,
  type CreateRoleInput,
  type UpdateRoleInput,
} from './dto/role.dto';
import { RolesService } from './roles.service';

@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermission('roles.manage')
  async list(@CurrentUser() user: SessionUser) {
    return { data: await this.roles.list(user.workspaceId) };
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('roles.manage')
  async create(
    @CurrentUser() user: SessionUser,
    @Body(new ZodValidationPipe(createRoleSchema)) body: CreateRoleInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return { data: await this.roles.create(user, body, request.ip) };
  }

  @Patch(':id')
  @RequirePermission('roles.manage')
  async update(
    @CurrentUser() user: SessionUser,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updateRoleSchema)) body: UpdateRoleInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return { data: await this.roles.update(user, params.id, body, request.ip) };
  }

  @Delete(':id')
  @RequirePermission('roles.manage')
  async remove(
    @CurrentUser() user: SessionUser,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Req() request: AuthenticatedRequest,
  ) {
    return { data: await this.roles.remove(user, params.id, request.ip) };
  }
}
