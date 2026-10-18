import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import type { AuthContext } from './auth.types';
import type { Permission } from './permissions';

export const IS_PUBLIC = 'auth:public';
export const REQUIRED_PERMISSIONS = 'auth:permissions';

/** Marks a route as reachable without a session (login, public form, webhooks, OAuth callback). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** All listed permissions are required. Owner and Admin pass automatically (F1.2, F1.5). */
export const RequirePermission = (...permissions: Permission[]) => SetMetadata(REQUIRED_PERMISSIONS, permissions);

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthContext => {
  const request = context.switchToHttp().getRequest<FastifyRequest & { auth?: AuthContext }>();
  if (!request.auth) throw new Error('CurrentUser used on a route without AuthGuard');
  return request.auth;
});
