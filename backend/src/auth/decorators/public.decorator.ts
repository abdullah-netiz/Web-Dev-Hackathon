import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'auth:public';

/** Marks a route (or controller) as reachable without a session. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
