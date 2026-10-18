import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import type { SessionUser } from '../auth/types/session-user';
import { listQuerySchema, type ListQuery } from '../common/pagination';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuditService } from './audit.service';

@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermission('audit.view')
  list(
    @CurrentUser() user: SessionUser,
    @Query(new ZodValidationPipe(listQuerySchema)) query: ListQuery,
  ) {
    return this.audit.list(user.workspaceId, query);
  }
}
