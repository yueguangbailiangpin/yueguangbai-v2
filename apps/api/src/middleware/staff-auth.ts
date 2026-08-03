import type { Context, MiddlewareHandler } from 'hono';
import type { AppEnv } from '../app';
import { readStaffSessionCookie } from '../staff-auth/cookies';
import {
  normalizeStaffAuthError,
  requestIdFromContext,
  StaffAuthError,
  staffAuthFailure,
} from '../staff-auth/errors';
import { requireStaffAuthConfig } from '../staff-auth/provider';
import { recordStaffAuthSecurityEvent } from '../staff-auth/repository';
import { resolveTrustedStaffSession } from '../staff-auth/session';

export function staffSessionMiddleware(): MiddlewareHandler<AppEnv> {
  return async (context, next) => {
    let config;
    try {
      config = requireStaffAuthConfig(context.env);
    } catch {
      return staffAuthFailure(
        context,
        new StaffAuthError('DEPENDENCY_UNAVAILABLE', 503),
      );
    }
    const cookie = readStaffSessionCookie(context);
    if (cookie.malformed) {
      await recordStaffAuthSecurityEvent(context.env.DB, {
        eventType: 'COOKIE_REJECTED',
        outcome: 'REJECTED',
        config,
        networkSource: networkSource(context),
        requestId: requestIdFromContext(context),
        metadata: { route_family: 'STAFF_API' },
        createdAt: Date.now(),
      }).catch(() => undefined);
      return staffAuthFailure(
        context,
        new StaffAuthError('UNAUTHENTICATED', 401),
      );
    }
    if (!cookie.value) {
      return staffAuthFailure(
        context,
        new StaffAuthError('UNAUTHENTICATED', 401),
      );
    }
    try {
      const trusted = await resolveTrustedStaffSession(
        context.env.DB,
        cookie.value,
      );
      context.set('staffAuthorization', trusted.authorization);
      context.set('staffDataScope', trusted.dataScope);
      context.set('staffSession', trusted.session);
      await next();
    } catch (error) {
      const normalized = normalizeStaffAuthError(error);
      const details = asRecord(normalized.details);
      await recordStaffAuthSecurityEvent(context.env.DB, {
        eventType: 'SESSION_REJECTED',
        outcome: 'REJECTED',
        config,
        staffId: readString(details?.['staff_id']),
        sessionId: readString(details?.['session_id']),
        networkSource: networkSource(context),
        requestId: requestIdFromContext(context),
        metadata: {
          reason: readString(details?.['reason']) ?? 'INVALID',
          route_family: 'STAFF_API',
        },
        createdAt: Date.now(),
      }).catch(() => undefined);
      return staffAuthFailure(context, normalized);
    }
  };
}

function networkSource(context: Context<AppEnv>): string | null {
  const value = context.req.header('CF-Connecting-IP')?.trim() ?? '';
  return value.length >= 1 && value.length <= 200 ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length >= 1 && value.length <= 200
    ? value
    : null;
}
