import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';

import { IS_PUBLIC, REQUIRED_PERMISSIONS } from './auth.decorators';
import { AuthService } from './auth.service';
import { hasPermission, type AuthContext } from './auth.types';
import type { Permission } from './permissions';

/**
 * Registered as APP_GUARD: resolves the session from `Authorization: Bearer <token>` (or the `sid`
 * cookie), attaches `request.auth`, then checks `@RequirePermission` (Q2, F1.5).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest & { auth?: AuthContext }>();
    const token = extractToken(request);
    if (!token) {
      throw new UnauthorizedException({ code: 'NOT_AUTHENTICATED', message: 'Sign in to continue.', action: 'Log in again.' });
    }
    const auth = await this.authService.resolveSession(token, request.ip);
    if (!auth) {
      throw new UnauthorizedException({ code: 'SESSION_EXPIRED', message: 'Your session has expired or was ended.', action: 'Log in again.' });
    }
    request.auth = auth;

    const required = this.reflector.getAllAndOverride<Permission[]>(REQUIRED_PERMISSIONS, [context.getHandler(), context.getClass()]) ?? [];
    const missing = required.filter((permission) => !hasPermission(auth, permission));
    if (missing.length > 0) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: `You do not have permission to do this (${missing.join(', ')}).`,
        action: 'Ask an Owner or Admin to grant the permission.',
      });
    }
    return true;
  }
}

export function extractToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  const cookie = request.headers.cookie;
  if (cookie) {
    const match = /(?:^|;\s*)sid=([^;]+)/.exec(cookie);
    if (match) return decodeURIComponent(match[1]);
  }
  return null;
}
