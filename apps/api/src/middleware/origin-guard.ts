import type { MiddlewareHandler } from 'hono';
import {
  CustomerHttpAuthError,
  customerHttpAuthFailure,
} from '../http-auth/errors';

export function customerAuthOriginGuard(): MiddlewareHandler<any> {
  return async (context, next) => {
    const origin = context.req.header('Origin');
    const fetchSite = context.req.header('Sec-Fetch-Site');
    const requestOrigin = new URL(context.req.url).origin;
    if (!origin
      || origin !== requestOrigin
      || fetchSite === 'cross-site') {
      return customerHttpAuthFailure(
        context,
        new CustomerHttpAuthError('FORBIDDEN', 403),
      );
    }
    await next();
  };
}
