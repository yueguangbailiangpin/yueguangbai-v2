import {
  apiFailure,
  type ApiErrorCode,
} from '@ygb/contracts';
import type { Context } from 'hono';

export class StaffAuthError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly status: 400 | 401 | 403 | 404 | 409 | 429 | 503,
    readonly details: unknown = null,
  ) {
    super(code);
  }
}

export function normalizeStaffAuthError(error: unknown): StaffAuthError {
  if (error instanceof StaffAuthError) return error;
  return new StaffAuthError('DEPENDENCY_UNAVAILABLE', 503);
}

export function staffAuthFailure(
  context: Context<any>,
  error: StaffAuthError,
): Response {
  const requestId = requestIdFromContext(context);
  context.header('Cache-Control', 'no-store');
  if (error.status === 429
    && error.details
    && typeof error.details === 'object'
    && 'retry_after_seconds' in error.details) {
    const retry = Number((error.details as { retry_after_seconds: unknown })
      .retry_after_seconds);
    if (Number.isSafeInteger(retry) && retry > 0) {
      context.header('Retry-After', String(retry));
    }
  }
  return context.json(
    apiFailure(error.code, error.code, requestId, error.details),
    error.status,
  );
}

export function requestIdFromContext(context: Context<any>): string {
  const value = context.get('requestId') as string | undefined;
  return value && value.length <= 200 ? value : crypto.randomUUID();
}
