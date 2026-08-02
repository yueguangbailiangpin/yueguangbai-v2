import type {
  StaffLogoutAllResponse,
  StaffRoleCode,
  SqlDatabase,
} from '@ygb/contracts';
import { createAuditEventStatement } from '../foundation/audit';
import {
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  type IdempotencyClaim,
} from '../foundation/idempotency';
import { StaffAuthError } from './errors';

export async function logoutAllStaffSessions(
  database: SqlDatabase,
  input: {
    staffId: string;
    currentSessionId: string;
    roles: readonly StaffRoleCode[];
    requestId: string;
    claim: IdempotencyClaim;
    now: number;
  },
): Promise<StaffLogoutAllResponse> {
  const staff = await database.prepare(`
    SELECT session_version FROM staff_users
    WHERE id=? AND status='ACTIVE'
  `).bind(input.staffId).first<{ session_version: number }>();
  if (!staff) throw new StaffAuthError('UNAUTHENTICATED', 401);
  const currentVersion = Number(staff.session_version);
  const nextVersion = currentVersion + 1;
  if (!Number.isSafeInteger(nextVersion) || nextVersion < 2) {
    throw new StaffAuthError('DEPENDENCY_UNAVAILABLE', 503);
  }
  const response: StaffLogoutAllResponse = {
    logged_out: true,
    all_devices_logged_out: true,
    session_version: nextVersion,
  };
  await database.batch([
    database.prepare(`
      UPDATE staff_users
      SET session_version=session_version+1, version=version+1,
        updated_at=MAX(?, updated_at+1)
      WHERE id=? AND status='ACTIVE' AND session_version=?
    `).bind(input.now, input.staffId, currentVersion),
    database.prepare(`
      UPDATE staff_sessions
      SET status='REVOKED', revoked_at=?,
        revoked_reason='LOGOUT_ALL', updated_at=?
      WHERE staff_id=? AND status='ACTIVE'
    `).bind(input.now, input.now, input.staffId),
    createAuditEventStatement(database, {
      id: crypto.randomUUID(),
      aggregateType: 'STAFF_USER',
      aggregateId: input.staffId,
      eventType: 'STAFF_LOGOUT_ALL',
      actor: {
        type: 'STAFF',
        id: input.staffId,
        roles: input.roles,
      },
      requestId: input.requestId,
      idempotencyKey: input.claim.idempotencyKey,
      previousState: { session_version: currentVersion },
      nextState: response,
      metadata: { current_session_id: input.currentSessionId },
      createdAt: input.now,
    }),
    completeIdempotencyStatement(database, input.claim, response, {
      resultReferences: {
        staff_id: input.staffId,
        session_version: nextVersion,
      },
      now: input.now,
    }),
    database.prepare(`
      INSERT INTO transaction_assertions (assertion_value)
      SELECT CASE WHEN
        EXISTS (SELECT 1 FROM staff_users
          WHERE id=? AND session_version=?)
        AND NOT EXISTS (SELECT 1 FROM staff_sessions
          WHERE staff_id=? AND status='ACTIVE')
      THEN 1 ELSE 0 END
    `).bind(input.staffId, nextVersion, input.staffId),
    assertIdempotencyCompletionStatement(database, input.claim),
  ]);
  return response;
}
