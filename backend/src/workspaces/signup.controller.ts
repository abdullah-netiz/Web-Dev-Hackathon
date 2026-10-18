import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator';
import { LoginThrottlerGuard } from '../auth/guards/login-throttler.guard';
import type { AuthenticatedRequest } from '../auth/types/session-user';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { signupSchema, type SignupInput } from './dto/workspace.dto';
import { WorkspaceService } from './workspace.service';

@Controller('auth')
export class SignupController {
  constructor(private readonly workspace: WorkspaceService) {}

  @Public()
  @UseGuards(LoginThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(201)
  @Post('signup')
  async signup(
    @Body(new ZodValidationPipe(signupSchema)) body: SignupInput,
    @Req() request: AuthenticatedRequest,
  ) {
    const userAgent = request.headers['user-agent'];
    return {
      data: await this.workspace.signup(body, {
        ip: request.ip,
        userAgent: typeof userAgent === 'string' ? userAgent : undefined,
      }),
    };
  }
}
