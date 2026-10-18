import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { toSessionUser } from '../serializer';
import { SessionService } from '../session.service';
import type { AuthenticatedRequest } from '../types/session-user';

function bearerToken(header: string | string[] | undefined): string | null {
  if (typeof header !== 'string') {
    return null;
  }
  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && value ? value.trim() : null;
}

function unauthorized(): UnauthorizedException {
  return new UnauthorizedException({
    code: 'unauthenticated',
    message: 'You need to sign in to do this.',
    action: 'Sign in and try again.',
  });
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = bearerToken(request.headers['authorization']);
    if (!token) {
      throw unauthorized();
    }

    const session = await this.sessions.resolve(token);
    if (!session) {
      throw unauthorized();
    }

    request.user = { ...toSessionUser(session.user), sessionId: session.id };
    return true;
  }
}
