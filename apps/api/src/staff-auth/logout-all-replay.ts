import type {
  StaffLogoutAllResponse,
  SqlDatabase,
} from '@ygb/contracts';
import { hashCanonicalJson } from '@ygb/domain';
import { findStaffSessionByToken, type StaffSessionRow } from './repository';

interface CommittedLogoutAllRow {
  response_json: string;
}

export interface LogoutAllReplayResult {
  session: Pick<
    StaffSessionRow,
    'id' | 'staff_id' | 'issued_session_version'
  >;
  response: StaffLogoutAllResponse;
}

/**
 * Narrow recovery path for a lost HTTP response after logout-all committed.
 * It never creates an Idempotency Claim and never resolves Staff authorization.
 */
export async function readCommittedLogoutAllReplay(
  database: SqlDatabase,
  input: {
    sessionToken: string;
    idempotencyKey: string;
    now?: number;
  },
): Promise<LogoutAllReplayResult | null> {
  const now = input.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) return null;
  const session = await findStaffSessionByToken(
    database,
    input.sessionToken,
  );
  if (!session
    || session.status !== 'REVOKED'
    || session.revoked_reason !== 'LOGOUT_ALL'
    || session.expires_at <= now) {
    return null;
  }

  const requestHash = await hashCanonicalJson({
    action: 'STAFF_LOGOUT_ALL',
    staff_id: session.staff_id,
    issued_session_version: session.issued_session_version,
  });
  const row = await database.prepare(`
    SELECT response_json
    FROM command_idempotency_records
    WHERE actor_type='STAFF'
      AND actor_id=?
      AND action='STAFF_LOGOUT_ALL'
      AND target_type='STAFF_USER'
      AND target_id=?
      AND idempotency_key=?
      AND request_hash=?
      AND status='COMMITTED'
      AND response_json IS NOT NULL
    LIMIT 1
  `).bind(
    session.staff_id,
    session.staff_id,
    input.idempotencyKey,
    requestHash,
  ).first<CommittedLogoutAllRow>();
  if (!row) return null;

  const response = parseResponse(row.response_json);
  if (!response
    || response.session_version <= session.issued_session_version) {
    return null;
  }
  return {
    session: {
      id: session.id,
      staff_id: session.staff_id,
      issued_session_version: session.issued_session_version,
    },
    response,
  };
}

function parseResponse(value: string): StaffLogoutAllResponse | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).length !== 3
    || record['logged_out'] !== true
    || record['all_devices_logged_out'] !== true
    || !Number.isSafeInteger(record['session_version'])
    || Number(record['session_version']) < 2) {
    return null;
  }
  return {
    logged_out: true,
    all_devices_logged_out: true,
    session_version: Number(record['session_version']),
  };
}
