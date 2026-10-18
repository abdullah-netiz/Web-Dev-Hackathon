import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { loginSchema, type LoginInput } from './dto/auth.dto';
import { LoginThrottlerGuard } from './guards/login-throttler.guard';
import type { AuthenticatedRequest, SessionUser } from './types/session-user';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @UseGuards(LoginThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ data: Awaited<ReturnType<AuthService['login']>> }> {
    const userAgent = request.headers['user-agent'];
    return {
      data: await this.auth.login(body.email, body.password, {
        ip: request.ip,
        userAgent: typeof userAgent === 'string' ? userAgent : undefined,
      }),
    };
  }

  @HttpCode(200)
  @Post('logout')
  async logout(@CurrentUser() user: SessionUser): Promise<{ data: { ok: true } }> {
    await this.auth.logout(user.sessionId);
    return { data: { ok: true } };
  }

  @Get('me')
  me(@CurrentUser() user: SessionUser): { data: SessionUser } {
    return { data: user };
  }
}
