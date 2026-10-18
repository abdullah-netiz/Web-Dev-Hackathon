import { Controller, Delete, Get, Post, Query } from '@nestjs/common';
import { z } from 'zod';

import { CurrentUser } from '../auth/auth.decorators';
import type { AuthContext } from '../auth/auth.types';
import { paginationSchema } from '../common/pagination';
import { zodDto } from '../common/zod-validation.pipe';
import { AlertsService } from './alerts.service';

const ListDto = zodDto(paginationSchema.extend({ status: z.enum(['PENDING', 'SENT', 'FAILED']).optional() }));

@Controller('alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  /** I4.3: each employee links their own Telegram chat with a one-time code. */
  @Post('telegram/link')
  async link(@CurrentUser() auth: AuthContext) {
    return { data: await this.alerts.linkCode(auth) };
  }

  @Delete('telegram/link')
  async unlink(@CurrentUser() auth: AuthContext) {
    return { data: await this.alerts.unlink(auth) };
  }

  @Get('telegram/status')
  async status(@CurrentUser() auth: AuthContext) {
    return { data: await this.alerts.myStatus(auth) };
  }

  /** I4.4: delivery attempts; Admins see everyone's, others their own. */
  @Get()
  list(@CurrentUser() auth: AuthContext, @Query() query: InstanceType<typeof ListDto>) {
    return this.alerts.list(auth, query);
  }
}
