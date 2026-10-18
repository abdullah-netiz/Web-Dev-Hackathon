import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';

import { CurrentUser, RequirePermission } from '../auth/auth.decorators';
import type { AuthContext } from '../auth/auth.types';
import { paginationSchema } from '../common/pagination';
import { zodDto } from '../common/zod-validation.pipe';
import { PaymentsService } from './payments.service';

const RequestDto = zodDto(
  z.object({
    amount: z.number().positive().max(1e9),
    currency: z.string().length(3).toUpperCase().optional(),
    description: z.string().trim().max(200).optional(),
    expiresInMinutes: z.number().int().min(30).max(1440).optional(),
  }),
);
const ListDto = zodDto(
  paginationSchema.extend({
    status: z.enum(['PENDING', 'PAID', 'EXPIRED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED']).optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    opportunityId: z.string().uuid().optional(),
  }),
);

@Controller()
@RequirePermission('crm.view')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** I2.1: creates a Stripe Checkout session; the returned `checkoutUrl` can be sent to the customer. */
  @Post('opportunities/:id/payment-requests')
  @RequirePermission('crm.edit')
  async request(@CurrentUser() auth: AuthContext, @Param('id') id: string, @Body() body: InstanceType<typeof RequestDto>) {
    return { data: await this.payments.createRequest(auth, id, body) };
  }

  @Get('payments')
  list(@CurrentUser() auth: AuthContext, @Query() query: InstanceType<typeof ListDto>) {
    return this.payments.list(auth, query);
  }

  @Get('payments/:id')
  async get(@CurrentUser() auth: AuthContext, @Param('id') id: string) {
    return { data: await this.payments.get(auth, id) };
  }
}
