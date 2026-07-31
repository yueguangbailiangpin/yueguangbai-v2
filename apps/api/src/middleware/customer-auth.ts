import type { MiddlewareHandler } from 'hono';
import type { CustomerSessionContext } from '../customer-auth/authenticate-customer';
import { resolveCustomerSession } from '../customer-auth/authenticate-customer';
import {
  clearCustomerSessionCookie,
  readCustomerSessionCookie,
} from '../http-auth/cookies';
import {
  requireCustomerSessionSecret,
} from '../http-auth/config';
import {
  CustomerHttpAuthError,
  customerHttpAuthFailure,
  requestIdFromContext,
} from '../http-auth/errors';
import { recordCustomerAuthSecurityEvent } from '../http-auth/security-events';

export interface CustomerSessionMiddlewareOptions {
  required?: boolean;
  allowPasswordChangeRequired?: boolean;
}

export function customerSessionMiddleware(
  options: CustomerSessionMiddlewareOptions = {},
): MiddlewareHandler<any> {
  const required = options.required ?? true;
  const allowPasswordChangeRequired =
    options.allowPasswordChangeRequired ?? false;

  return async (context, next) => {
    try {
      const token = readCustomerSessionCookie(context);
      if (!token) {
        context.set('customerSession', null);
        if (!required) {
          await next();
          return;
        }
        throw new CustomerHttpAuthError(
          'UNAUTHENTICATED',
          401,
        );
      }

      const secret = requireCustomerSessionSecret(
        context.env?.CUSTOMER_SESSION_SECRET,
      );
      const session = await resolveCustomerSession(
        context.env.DB,
        token,
        secret,
      );
      if (!session) {
        clearCustomerSessionCookie(context);
        context.set('customerSession', null);
        await recordCustomerAuthSecurityEvent(
          context.env.DB,
          {
            eventType: 'SESSION_REJECTED',
            outcome: 'FAILURE',
            requestId: requestIdFromContext(context),
            createdAt: Date.now(),
          },
        );
        if (!required) {
          await next();
          return;
        }
        throw new CustomerHttpAuthError(
          'SESSION_INVALID',
          401,
        );
      }

      context.set('customerSession', session);
      if (session.passwordChangeRequired
        && !allowPasswordChangeRequired) {
        throw new CustomerHttpAuthError(
          'PASSWORD_CHANGE_REQUIRED',
          403,
        );
      }
      await next();
    } catch (error) {
      return customerHttpAuthFailure(
        context,
        error instanceof CustomerHttpAuthError
          ? error
          : new CustomerHttpAuthError(
            'DEPENDENCY_UNAVAILABLE',
            503,
          ),
      );
    }
  };
}

export function requireCustomerSessionFromContext(
  context: import('hono').Context<any>,
): CustomerSessionContext {
  const session = context.get('customerSession');
  if (!session || typeof session !== 'object') {
    throw new CustomerHttpAuthError('UNAUTHENTICATED', 401);
  }
  return session as CustomerSessionContext;
}
