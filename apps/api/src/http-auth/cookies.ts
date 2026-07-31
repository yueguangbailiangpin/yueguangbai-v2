import type { Context } from 'hono';
import {
  getCookie,
  setCookie,
} from 'hono/cookie';
import {
  CUSTOMER_SESSION_COOKIE_NAME,
  CUSTOMER_SESSION_COOKIE_PATH,
  CUSTOMER_SESSION_MAX_AGE_SECONDS,
} from './config';

const COMMON_COOKIE_OPTIONS = Object.freeze({
  path: CUSTOMER_SESSION_COOKIE_PATH,
  secure: true,
  httpOnly: true,
  sameSite: 'Lax' as const,
});

export function readCustomerSessionCookie(
  context: Context<any>,
): string | null {
  const value = getCookie(
    context,
    CUSTOMER_SESSION_COOKIE_NAME,
  );
  return value && value.length <= 4096 ? value : null;
}

export function writeCustomerSessionCookie(
  context: Context<any>,
  token: string,
): void {
  setCookie(
    context,
    CUSTOMER_SESSION_COOKIE_NAME,
    token,
    {
      ...COMMON_COOKIE_OPTIONS,
      maxAge: CUSTOMER_SESSION_MAX_AGE_SECONDS,
    },
  );
}

export function clearCustomerSessionCookie(
  context: Context<any>,
): void {
  setCookie(
    context,
    CUSTOMER_SESSION_COOKIE_NAME,
    '',
    {
      ...COMMON_COOKIE_OPTIONS,
      maxAge: 0,
      expires: new Date(0),
    },
  );
}
