import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';

import { CurrentUser, RequirePermission } from '../auth/auth.decorators';
import type { AuthContext } from '../auth/auth.types';
import { paginationSchema } from '../common/pagination';
import { zodDto } from '../common/zod-validation.pipe';
import { AuditService } from './audit.service';

const AuditQueryDto = zodDto(
  paginationSchema.extend({
    action: z.string().max(80).optional(),
    actorId: z.string().uuid().optional(),
    targetType: z.string().max(40).optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  }),
);

/** Read-only by design: there is no PATCH or DELETE here (F4.2, F4.3). */
@Controller('audit')
@RequirePermission('audit.view')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@CurrentUser() auth: AuthContext, @Query() query: InstanceType<typeof AuditQueryDto>) {
    return this.audit.list(auth.workspaceId, query);
  }

  @Get('actions')
  async actions(@CurrentUser() auth: AuthContext) {
    return { data: await this.audit.actions(auth.workspaceId) };
  }
}
