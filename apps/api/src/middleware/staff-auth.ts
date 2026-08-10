import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../app';
import { readStaffSessionCookie } from '../staff-auth/cookies';
import { StaffAuthError, staffAuthFailure } from '../staff-auth/errors';
import { resolveTrustedStaffSession } from '../staff-auth/session';

export function staffSessionMiddleware(): MiddlewareHandler<AppEnv> {
  return async (context, next) => {
    const cookie = readStaffSessionCookie(context);
    if (cookie.malformed || !cookie.value) {
      return staffAuthFailure(context, new StaffAuthError('UNAUTHENTICATED', 401));
    }
    try {
      const trusted = await resolveTrustedStaffSession(context.env.DB, cookie.value);
      context.set('staffAuthorization', trusted.authorization);
      context.set('staffDataScope', trusted.dataScope);
      context.set('staffSession', trusted.session);
      await next();
    } catch {
      return staffAuthFailure(context, new StaffAuthError('UNAUTHENTICATED', 401));
    }
  };
}
