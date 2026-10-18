import { Body, Controller, Delete, Get, Put, Query } from '@nestjs/common';
import { z } from 'zod';

import { CurrentUser } from '../auth/auth.decorators';
import type { AuthContext } from '../auth/auth.types';
import { paginationSchema } from '../common/pagination';
import { zodDto } from '../common/zod-validation.pipe';
import { AlertsService } from './alerts.service';

const ListDto = zodDto(paginationSchema.extend({ status: z.enum(['PENDING', 'SENT', 'FAILED']).optional() }));
const LinkDto = zodDto(
  z.object({
    slackUserId: z.string().trim().regex(/^[UW][A-Z0-9]{6,}$/, 'Slack member IDs look like U0123ABCD').optional(),
    userId: z.string().uuid().optional(),
  }),
);

@Controller('alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  /** I4.3: set the Slack destination. Empty body = find the Slack member by the user's email. Sends a test DM. */
  @Put('slack/link')
  async link(@CurrentUser() auth: AuthContext, @Body() body: InstanceType<typeof LinkDto>) {
    return { data: await this.alerts.link(auth, body) };
  }

  @Delete('slack/link')
  async unlink(@CurrentUser() auth: AuthContext) {
    return { data: await this.alerts.unlink(auth) };
  }

  @Get('slack/status')
  async status(@CurrentUser() auth: AuthContext) {
    return { data: await this.alerts.myStatus(auth) };
  }

  /** I4.4: delivery attempts; Admins see everyone's, others their own. */
  @Get()
  list(@CurrentUser() auth: AuthContext, @Query() query: InstanceType<typeof ListDto>) {
    return this.alerts.list(auth, query);
  }
}
