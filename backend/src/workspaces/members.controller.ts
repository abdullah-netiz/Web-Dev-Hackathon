import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import type { AuthenticatedRequest, SessionUser } from '../auth/types/session-user';
import { idParamSchema } from '../common/zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  inviteMemberSchema,
  listMembersSchema,
  updateMemberSchema,
  type InviteMemberInput,
  type UpdateMemberInput,
} from './dto/member.dto';
import { MembersService } from './members.service';

@Controller('members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @RequirePermission('users.manage')
  async list(
    @CurrentUser() user: SessionUser,
    @Query(new ZodValidationPipe(listMembersSchema))
    query: {
      limit: number;
      cursor?: string;
      q?: string;
      baseLevel?: 'OWNER' | 'ADMIN' | 'USER';
      availability?: 'AVAILABLE' | 'BUSY' | 'ON_LEAVE' | 'OFFLINE';
      roleId?: string;
      includeInactive: boolean;
    },
  ) {
    const { data, meta } = await this.members.list(user.workspaceId, query);
    return { data, meta };
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('users.manage')
  async invite(
    @CurrentUser() user: SessionUser,
    @Body(new ZodValidationPipe(inviteMemberSchema)) body: InviteMemberInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return { data: await this.members.invite(user, body, request.ip) };
  }

  @Patch(':id')
  @RequirePermission('users.manage')
  async update(
    @CurrentUser() user: SessionUser,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updateMemberSchema)) body: UpdateMemberInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return { data: await this.members.update(user, params.id, body, request.ip) };
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @RequirePermission('users.manage')
  async deactivate(
    @CurrentUser() user: SessionUser,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Req() request: AuthenticatedRequest,
  ) {
    return { data: await this.members.deactivate(user, params.id, request.ip) };
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  @RequirePermission('users.manage')
  async reactivate(
    @CurrentUser() user: SessionUser,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Req() request: AuthenticatedRequest,
  ) {
    return { data: await this.members.reactivate(user, params.id, request.ip) };
  }
}
