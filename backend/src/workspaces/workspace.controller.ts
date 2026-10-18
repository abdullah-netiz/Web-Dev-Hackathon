import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import type { AuthenticatedRequest, SessionUser } from '../auth/types/session-user';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { updateWorkspaceSchema, type UpdateWorkspaceInput } from './dto/workspace.dto';
import { WorkspaceService } from './workspace.service';

@Controller('workspace')
export class WorkspaceController {
  constructor(private readonly workspace: WorkspaceService) {}

  @Get()
  @RequirePermission('workspace.manage')
  async get(@CurrentUser() user: SessionUser) {
    return { data: await this.workspace.get(user.workspaceId) };
  }

  @Patch()
  @RequirePermission('workspace.manage')
  async update(
    @CurrentUser() user: SessionUser,
    @Body(new ZodValidationPipe(updateWorkspaceSchema)) body: UpdateWorkspaceInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return { data: await this.workspace.update(user, body, request.ip) };
  }
}
