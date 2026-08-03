import type { SqlDatabase } from '@ygb/contracts';
import { StaffAuthError } from './errors';

export const STAFF_AUTH_EPHEMERAL_RETENTION_MS = 24 * 60 * 60 * 1000;
export const STAFF_AUTH_CLEANUP_DELETE_LIMIT_PER_TABLE = 100;

export interface StaffAuthCleanupResult {
  staffLoginStatesDeleted: number;
  staffAuthRateLimitsDeleted: number;
}

export async function cleanupExpiredStaffAuthEphemeralRecords(
  database: SqlDatabase,
  now: number = Date.now(),
): Promise<StaffAuthCleanupResult> {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new StaffAuthError('VALIDATION_ERROR', 400);
  }
  const retainedAfter = now - STAFF_AUTH_EPHEMERAL_RETENTION_MS;
  try {
    const results = await database.batch([
      database.prepare(`
        DELETE FROM staff_login_states
        WHERE id IN (
          SELECT id
          FROM staff_login_states
          WHERE expires_at < ?
            AND updated_at < ?
          ORDER BY expires_at, id
          LIMIT ${STAFF_AUTH_CLEANUP_DELETE_LIMIT_PER_TABLE}
        )
      `).bind(retainedAfter, retainedAfter),
      database.prepare(`
        DELETE FROM staff_auth_rate_limits
        WHERE id IN (
          SELECT id
          FROM staff_auth_rate_limits
          WHERE window_ends_at < ?
            AND (
              blocked_until IS NULL
              OR blocked_until < ?
            )
          ORDER BY window_ends_at, id
          LIMIT ${STAFF_AUTH_CLEANUP_DELETE_LIMIT_PER_TABLE}
        )
      `).bind(retainedAfter, retainedAfter),
    ]);
    return {
      staffLoginStatesDeleted: Number(results[0]?.meta.changes ?? 0),
      staffAuthRateLimitsDeleted: Number(results[1]?.meta.changes ?? 0),
    };
  } catch {
    throw new StaffAuthError('DEPENDENCY_UNAVAILABLE', 503);
  }
}
