import { Body, Controller, Delete, Get, Param, Put, Query } from '@nestjs/common';
import { z } from 'zod';

import { CurrentUser, RequirePermission } from '../auth/auth.decorators';
import type { AuthContext } from '../auth/auth.types';
import { paginationSchema } from '../common/pagination';
import { zodDto } from '../common/zod-validation.pipe';
import { ConnectionsService } from './connections.service';
import { IntegrationEventsService } from './integration-events.service';

const providerParam = z.enum(['TWILIO', 'LEMONSQUEEZY', 'SLACK']);
const ConnectDto = zodDto(z.object({ credentials: z.record(z.string(), z.string().trim().min(1)), config: z.record(z.string(), z.unknown()).default({}) }));
const EventsQueryDto = zodDto(
  paginationSchema.extend({
    provider: z.enum(['TWILIO', 'LEMONSQUEEZY', 'GOOGLE', 'SLACK', 'WEB_FORM']).optional(),
    status: z.enum(['RECEIVED', 'PROCESSED', 'FAILED', 'REJECTED']).optional(),
  }),
);

/** Central integrations page (I5.1): status, last OK, recent errors, limits text, sync history. */
@Controller('integrations')
export class IntegrationsController {
  constructor(
    private readonly connections: ConnectionsService,
    private readonly integrationEvents: IntegrationEventsService,
  ) {}

  @Get()
  @RequirePermission('integrations.view')
  async list(@CurrentUser() auth: AuthContext) {
    return { data: await this.connections.list(auth.workspaceId) };
  }

  /** I5.7: only users with the integration permission can connect or change; every change is audited. */
  @Put(':provider')
  @RequirePermission('integrations.manage')
  async connect(@CurrentUser() auth: AuthContext, @Param('provider') provider: string, @Body() body: InstanceType<typeof ConnectDto>) {
    return { data: await this.connections.connect(auth, providerParam.parse(provider.toUpperCase()), body.credentials, body.config) };
  }

  @Delete(':provider')
  @RequirePermission('integrations.manage')
  async disconnect(@CurrentUser() auth: AuthContext, @Param('provider') provider: string) {
    return { data: await this.connections.disconnect(auth, providerParam.parse(provider.toUpperCase())) };
  }

  /** I5.4: every inbound event and outbound call, reviewable by authorized users. */
  @Get('events')
  @RequirePermission('integrations.view')
  events(@CurrentUser() auth: AuthContext, @Query() query: InstanceType<typeof EventsQueryDto>) {
    return this.integrationEvents.list(auth.workspaceId, query);
  }
}
