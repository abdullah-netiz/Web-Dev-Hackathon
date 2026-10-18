import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';

import { CurrentUser, RequirePermission } from '../auth/auth.decorators';
import type { AuthContext } from '../auth/auth.types';
import { paginationSchema } from '../common/pagination';
import { zodDto } from '../common/zod-validation.pipe';
import { MessagingService } from './messaging.service';

class PaginationDto extends zodDto(paginationSchema) {}
class SendDto extends zodDto(z.object({ body: z.string().trim().min(1).max(1600) })) {}
class AssignDto extends zodDto(z.object({ userId: z.string().uuid() })) {}

@Controller()
@RequirePermission('crm.view')
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Get('conversations')
  list(@CurrentUser() auth: AuthContext, @Query() query: PaginationDto) {
    return this.messaging.listConversations(auth, query);
  }

  @Get('conversations/:id')
  async get(@CurrentUser() auth: AuthContext, @Param('id') id: string) {
    return { data: await this.messaging.getConversation(auth, id) };
  }

  @Get('conversations/:id/messages')
  messages(@CurrentUser() auth: AuthContext, @Param('id') id: string, @Query() query: PaginationDto) {
    return this.messaging.listMessages(auth, id, query);
  }

  @Post('conversations/:id/messages')
  @RequirePermission('crm.edit')
  async send(@CurrentUser() auth: AuthContext, @Param('id') id: string, @Body() body: SendDto) {
    return { data: await this.messaging.send(auth, id, body.body) };
  }

  @Post('conversations/:id/assign')
  @RequirePermission('leads.reassign')
  async assign(@CurrentUser() auth: AuthContext, @Param('id') id: string, @Body() body: AssignDto) {
    return { data: await this.messaging.assignConversation(auth, id, body.userId) };
  }

  @Post('contacts/:id/messages')
  @RequirePermission('crm.edit')
  async sendToContact(@CurrentUser() auth: AuthContext, @Param('id') id: string, @Body() body: SendDto) {
    return { data: await this.messaging.sendToContact(auth, id, body.body) };
  }

  @Post('messages/:id/retry')
  @RequirePermission('crm.edit')
  async retry(@CurrentUser() auth: AuthContext, @Param('id') id: string) {
    return { data: await this.messaging.retry(auth, id) };
  }
}
