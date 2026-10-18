import { Body, Controller, Get, Param, Patch, Query, Req } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import type { AuthenticatedRequest, SessionUser } from '../auth/types/session-user';
import { notFound } from '../common/http-errors';
import { idParamSchema } from '../common/zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  listUsersSchema,
  updateAvailabilitySchema,
  type UpdateAvailabilityInput,
} from './dto/user.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermission('leads.view')
  async list(
    @CurrentUser() user: SessionUser,
    @Query(new ZodValidationPipe(listUsersSchema))
    query: {
      limit: number;
      cursor?: string;
      q?: string;
      availability?: 'AVAILABLE' | 'BUSY' | 'ON_LEAVE' | 'OFFLINE';
      roleId?: string;
    },
  ) {
    const { data, meta } = await this.users.list(user.workspaceId, query);
    return { data, meta };
  }

  @Patch(':id/availability')
  async setAvailability(
    @CurrentUser() user: SessionUser,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updateAvailabilitySchema)) body: UpdateAvailabilityInput,
    @Req() request: AuthenticatedRequest,
  ) {
    const updated = await this.users.setAvailability(
      user,
      params.id,
      body.availability,
      request.ip,
    );
    if (!updated) {
      throw notFound('user');
    }
    return { data: updated };
  }
}
