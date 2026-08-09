import type { SqlDatabase } from '@ygb/contracts';
import { StaffAuthError } from './errors';

export const STAFF_AUTH_EPHEMERAL_RETENTION_MS = 24 * 60 * 60 * 1000;
export const STAFF_AUTH_CLEANUP_DELETE_LIMIT_PER_TABLE = 100;

export interface StaffAuthCleanupResult {
  staffLoginStatesDeleted: number;
  staffAuthRateLimitsDeleted: number;
  hasMore: boolean;
  dryRun: boolean;
}

export async function cleanupExpiredStaffAuthEphemeralRecords(
  database: SqlDatabase,
  now: number = Date.now(),
  options: { limit?: number; dryRun?: boolean } = {},
): Promise<StaffAuthCleanupResult> {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new StaffAuthError('VALIDATION_ERROR', 400);
  }
  const retainedAfter = now - STAFF_AUTH_EPHEMERAL_RETENTION_MS;
  const limit = options.limit ?? STAFF_AUTH_CLEANUP_DELETE_LIMIT_PER_TABLE;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > STAFF_AUTH_CLEANUP_DELETE_LIMIT_PER_TABLE) throw new StaffAuthError('VALIDATION_ERROR',400);
  try {
    const counts = await database.prepare(`SELECT (SELECT COUNT(*) FROM staff_login_states WHERE expires_at<? AND updated_at<?)+(SELECT COUNT(*) FROM staff_auth_rate_limits WHERE window_ends_at<? AND (blocked_until IS NULL OR blocked_until<?)) AS count`).bind(retainedAfter,retainedAfter,retainedAfter,retainedAfter).first<{count:number}>();
    if (options.dryRun) return { staffLoginStatesDeleted:0,staffAuthRateLimitsDeleted:0,hasMore:Number(counts?.count??0)>limit,dryRun:true };
    const loginStates = await database.prepare(`
        DELETE FROM staff_login_states
        WHERE id IN (
          SELECT id
          FROM staff_login_states
          WHERE expires_at < ?
            AND updated_at < ?
          ORDER BY expires_at, id
          LIMIT ${limit}
        )
      `).bind(retainedAfter, retainedAfter).run();
    const rateLimits = await database.prepare(`
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
          LIMIT ${limit}
        )
      `).bind(retainedAfter, retainedAfter).run();
    return {
      staffLoginStatesDeleted: Number(loginStates.meta.changes ?? 0),
      staffAuthRateLimitsDeleted: Number(rateLimits.meta.changes ?? 0),
      hasMore: Number(counts?.count ?? 0) > limit,
      dryRun: false,
    };
  } catch {
    throw new StaffAuthError('DEPENDENCY_UNAVAILABLE', 503);
  }
}
