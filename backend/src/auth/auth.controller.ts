import { Body, Controller, Delete, Get, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { ENV, type Env } from '../common/env';
import { zodDto } from '../common/zod-validation.pipe';
import { CurrentUser, Public } from './auth.decorators';
import { AuthService } from './auth.service';
import type { AuthContext } from './auth.types';
import { PERMISSIONS } from './permissions';

const password = z.string().min(8, 'Use at least 8 characters').max(128);

class SignupDto extends zodDto(
  z.object({
    workspaceName: z.string().trim().min(2).max(80),
    firstName: z.string().trim().min(1).max(60),
    lastName: z.string().trim().min(1).max(60),
    email: z.string().trim().email(),
    password,
    timeZone: z.string().max(60).optional(),
  }),
) {}
class LoginDto extends zodDto(z.object({ email: z.string().trim().email(), password: z.string().min(1) })) {}
class ChangePasswordDto extends zodDto(z.object({ currentPassword: z.string().min(1), newPassword: password })) {}
class AcceptInviteDto extends zodDto(z.object({ name: z.string().trim().max(120).optional(), password })) {}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('signup')
  async signup(@Body() body: SignupDto, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.auth.signup(body, meta(req));
    this.setCookie(reply, result.token, result.expiresAt);
    return { data: result };
  }

  /** Brute-force protection: 5 attempts per minute per IP (Q1); the error never says which part was wrong. */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000, blockDuration: 60_000 } })
  @Post('login')
  async login(@Body() body: LoginDto, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.auth.login(body, meta(req));
    this.setCookie(reply, result.token, result.expiresAt);
    return { data: result };
  }

  @Post('logout')
  async logout(@CurrentUser() auth: AuthContext, @Res({ passthrough: true }) reply: FastifyReply) {
    await this.auth.logout(auth.sessionId);
    reply.header('Set-Cookie', 'sid=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax');
    return { data: { loggedOut: true } };
  }

  /** `{ user, workspace, permissions, expiresAt }` — the user has the same shape as GET /users. */
  @Get('me')
  @SkipThrottle()
  async me(@CurrentUser() auth: AuthContext) {
    return { data: await this.auth.sessionView(auth) };
  }

  @Public()
  @Get('invites/:token')
  async invite(@Param('token') token: string) {
    return { data: await this.auth.inviteInfo(token) };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('invites/:token/accept')
  async acceptInvite(@Param('token') token: string, @Body() body: AcceptInviteDto, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.auth.acceptInvite(token, body, meta(req));
    this.setCookie(reply, result.token, result.expiresAt);
    return { data: result };
  }

  @Get('sessions')
  async sessions(@CurrentUser() auth: AuthContext) {
    return { data: await this.auth.listSessions(auth.userId) };
  }

  @Delete('sessions/:id')
  async revoke(@CurrentUser() auth: AuthContext, @Param('id') id: string) {
    return { data: await this.auth.revokeSession(auth.userId, id) };
  }

  @Post('sessions/revoke-others')
  async revokeOthers(@CurrentUser() auth: AuthContext) {
    await this.auth.revokeAllSessions(auth.userId, auth.sessionId);
    return { data: { revoked: true } };
  }

  @Post('change-password')
  async changePassword(@CurrentUser() auth: AuthContext, @Body() body: ChangePasswordDto) {
    await this.auth.changePassword(auth.userId, body.currentPassword, body.newPassword, auth.sessionId);
    return { data: { changed: true } };
  }

  /** 60-second token for the Socket.IO handshake: `io(API_URL, { auth: { token } })` (Q11). */
  @Get('ws-token')
  @SkipThrottle()
  wsToken(@CurrentUser() auth: AuthContext) {
    return { data: { token: this.auth.issueWsToken(auth), expiresInSec: 60 } };
  }

  private setCookie(reply: FastifyReply, token: string, expiresAt: Date) {
    const secure = this.env.NODE_ENV === 'production' ? '; Secure' : '';
    reply.header('Set-Cookie', `sid=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}${secure}`);
  }
}

function meta(req: FastifyRequest) {
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
}
