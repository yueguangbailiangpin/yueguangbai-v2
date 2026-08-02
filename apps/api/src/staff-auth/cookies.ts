import {
  STAFF_SESSION_COOKIE_NAME,
  STAFF_SESSION_MAX_AGE_SECONDS,
} from '@ygb/contracts';
import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { isStaffOpaqueToken } from './crypto';

const COOKIE_OPTIONS = Object.freeze({
  path: '/',
  secure: true,
  httpOnly: true,
  sameSite: 'Lax' as const,
});

export function readStaffSessionCookie(
  context: Context<any>,
): { value: string | null; malformed: boolean } {
  const value = getCookie(context, STAFF_SESSION_COOKIE_NAME);
  if (value === undefined) return { value: null, malformed: false };
  if (!isStaffOpaqueToken(value)) return { value: null, malformed: true };
  return { value, malformed: false };
}

export function writeStaffSessionCookie(
  context: Context<any>,
  token: string,
): void {
  if (!isStaffOpaqueToken(token)) throw new Error('invalid_staff_session_token');
  setCookie(context, STAFF_SESSION_COOKIE_NAME, token, {
    ...COOKIE_OPTIONS,
    maxAge: STAFF_SESSION_MAX_AGE_SECONDS,
  });
}

export function clearStaffSessionCookie(context: Context<any>): void {
  setCookie(context, STAFF_SESSION_COOKIE_NAME, '', {
    ...COOKIE_OPTIONS,
    maxAge: 0,
    expires: new Date(0),
  });
}
