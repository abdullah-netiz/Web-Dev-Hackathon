import { Body, Controller, Post, Query, Req } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import type { AuthenticatedRequest } from '../auth/types/session-user';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  publicIntakeQuerySchema,
  publicIntakeSchema,
  type PublicIntakeInput,
} from './dto/lead.dto';
import { LeadsService } from './leads.service';

/** Public capture endpoint behind the hosted intake form; the workspace comes from the query (F3.1). */
@Controller('public/leads')
export class IntakeController {
  constructor(private readonly leads: LeadsService) {}

  @Post()
  @Public()
  async intake(
    @Query(new ZodValidationPipe(publicIntakeQuerySchema)) query: { workspace: string },
    @Body(new ZodValidationPipe(publicIntakeSchema)) body: PublicIntakeInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return { data: await this.leads.intake(query.workspace, body, request.ip) };
  }
}
