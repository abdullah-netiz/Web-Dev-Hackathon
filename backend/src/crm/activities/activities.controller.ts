import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import type { AuthenticatedRequest, SessionUser } from '../../auth/types/session-user';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ActivitiesService } from './activities.service';
import {
  createActivitySchema,
  listActivitiesSchema,
  type CreateActivityInput,
} from './dto/activity.dto';

@Controller('activities')
export class ActivitiesController {
  constructor(private readonly activities: ActivitiesService) {}

  @Get()
  @RequirePermission('crm.view')
  list(
    @CurrentUser() user: SessionUser,
    @Query(new ZodValidationPipe(listActivitiesSchema))
    query: {
      entityType?: 'CONTACT' | 'COMPANY' | 'OPPORTUNITY' | 'LEAD' | 'CONVERSATION';
      entityId?: string;
      limit: number;
      cursor?: string;
    },
  ) {
    return this.activities.list(user.workspaceId, query);
  }

  @Post()
  @RequirePermission('crm.create')
  async create(
    @CurrentUser() user: SessionUser,
    @Body(new ZodValidationPipe(createActivitySchema)) body: CreateActivityInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return { data: await this.activities.create(user, body, request.ip) };
  }
}
