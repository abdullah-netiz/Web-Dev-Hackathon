import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { SessionUser } from '../types/session-user';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SessionUser => {
    const request = context.switchToHttp().getRequest<{ user?: SessionUser }>();
    if (!request.user) {
      throw new UnauthorizedException();
    }
    return request.user;
  },
);
