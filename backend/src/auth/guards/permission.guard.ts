import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY } from '../decorators/require-permission.decorator';
import type { SessionUser } from '../types/session-user';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: SessionUser }>();
    if (!request.user) {
      throw new UnauthorizedException();
    }

    const missing = required.filter((permission) => !request.user!.permissions.includes(permission));
    if (missing.length > 0) {
      throw new ForbiddenException({
        code: 'forbidden',
        message: `You do not have permission to do this (${missing.join(', ')}).`,
        action: 'Ask an administrator to grant the missing permission.',
      });
    }
    return true;
  }
}
