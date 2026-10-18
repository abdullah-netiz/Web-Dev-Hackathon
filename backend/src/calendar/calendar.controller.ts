import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';

import { CurrentUser, Public, RequirePermission } from '../auth/auth.decorators';
import type { AuthContext } from '../auth/auth.types';
import { paginationSchema } from '../common/pagination';
import { zodDto } from '../common/zod-validation.pipe';
import { CalendarService } from './calendar.service';

const BusyQueryDto = zodDto(z.object({ userId: z.string().uuid().optional(), from: z.string().datetime(), to: z.string().datetime() }));
const BookDto = zodDto(
  z.object({
    contactId: z.string().uuid(),
    opportunityId: z.string().uuid().nullable().optional(),
    userId: z.string().uuid().optional(),
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).optional(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    timeZone: z.string().min(1).max(60),
    force: z.boolean().optional(),
  }),
);
const RescheduleDto = zodDto(z.object({ startsAt: z.string().datetime(), endsAt: z.string().datetime(), timeZone: z.string().min(1).max(60).optional(), title: z.string().trim().min(1).max(120).optional(), force: z.boolean().optional(), version: z.number().int().positive().optional() }));
const ListDto = zodDto(paginationSchema.extend({ from: z.string().datetime().optional(), to: z.string().datetime().optional(), userId: z.string().uuid().optional(), contactId: z.string().uuid().optional(), status: z.enum(['SCHEDULED', 'CANCELLED']).optional() }));
const DisconnectQueryDto = zodDto(z.object({ userId: z.string().uuid().optional() }));

@Controller()
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  /** I3.1: returns the Google consent URL; the browser navigates there. */
  @Get('calendar/google/connect')
  connect(@CurrentUser() auth: AuthContext) {
    return { data: this.calendar.connectUrl(auth) };
  }

  /** OAuth redirect target (public). State is a signed token identifying the user. */
  @Public()
  @Get('calendar/google/callback')
  async callback(@Query('code') code: string | undefined, @Query('state') state: string | undefined, @Query('error') error: string | undefined, @Res() reply: FastifyReply) {
    const { redirect } = await this.calendar.handleCallback(code, state, error);
    return reply.redirect(redirect, 302);
  }

  @Delete('calendar/google')
  async disconnect(@CurrentUser() auth: AuthContext, @Query() query: InstanceType<typeof DisconnectQueryDto>) {
    return { data: await this.calendar.disconnect(auth, query.userId) };
  }

  @Get('calendar/status')
  async status(@CurrentUser() auth: AuthContext) {
    return { data: await this.calendar.status(auth) };
  }

  /** I3.4: busy intervals for the booking screen. */
  @Get('calendar/busy')
  @RequirePermission('crm.view')
  async busy(@CurrentUser() auth: AuthContext, @Query() query: InstanceType<typeof BusyQueryDto>) {
    return { data: await this.calendar.busy(auth, query.userId ?? auth.userId, new Date(query.from), new Date(query.to)) };
  }

  @Get('appointments')
  @RequirePermission('crm.view')
  list(@CurrentUser() auth: AuthContext, @Query() query: InstanceType<typeof ListDto>) {
    return this.calendar.list(auth, query);
  }

  @Post('appointments')
  @RequirePermission('crm.edit')
  async book(@CurrentUser() auth: AuthContext, @Body() body: InstanceType<typeof BookDto>) {
    return { data: await this.calendar.book(auth, body) };
  }

  @Patch('appointments/:id')
  @RequirePermission('crm.edit')
  async reschedule(@CurrentUser() auth: AuthContext, @Param('id') id: string, @Body() body: InstanceType<typeof RescheduleDto>) {
    return { data: await this.calendar.reschedule(auth, id, body) };
  }

  @Delete('appointments/:id')
  @RequirePermission('crm.edit')
  async cancel(@CurrentUser() auth: AuthContext, @Param('id') id: string) {
    return { data: await this.calendar.cancel(auth, id) };
  }
}
