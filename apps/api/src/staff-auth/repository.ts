import type { StaffDataScope, StaffSessionSafeDto, SqlDatabase } from '@ygb/contracts';
import { STAFF_ROLE_DISPLAY_NAMES, isStaffRoleCode } from '@ygb/contracts';
import { createAuditEventStatement } from '../foundation/audit';
import { hashStaffOpaqueToken } from './crypto';
import { StaffAuthError } from './errors';

export interface StaffSessionRow {
  id: string;
  token_hash: string;
  staff_id: string;
  issued_session_version: number;
  issued_authorization_version: number;
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
  expires_at: number;
  revoked_at: number | null;
  revoked_reason: string | null;
  created_at: number;
  updated_at: number;
}

export interface StaffIdentityRow {
  identity_id: string;
  staff_id: string;
  identity_status: 'ACTIVE' | 'REVOKED';
  identity_user_id: string | null;
  display_name: string;
  staff_status: 'ACTIVE' | 'DISABLED';
  authorization_version: number;
  session_version: number;
}

export async function createInternalStaffSession(
  database: SqlDatabase,
  input: {
    token: string;
    identity: StaffIdentityRow;
    requestId: string;
    now: number;
    expiresAt: number;
  },
): Promise<StaffSessionRow> {
  const row: StaffSessionRow = {
    id: crypto.randomUUID(),
    token_hash: await hashStaffOpaqueToken(input.token),
    staff_id: input.identity.staff_id,
    issued_session_version: input.identity.session_version,
    issued_authorization_version: input.identity.authorization_version,
    status: 'ACTIVE',
    expires_at: input.expiresAt,
    revoked_at: null,
    revoked_reason: null,
    created_at: input.now,
    updated_at: input.now,
  };
  await database.batch([
    database.prepare(`
      INSERT INTO staff_sessions (
        id, token_hash, staff_id, issued_session_version,
        issued_authorization_version, status, expires_at,
        revoked_at, revoked_reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, NULL, NULL, ?, ?)
    `).bind(
      row.id, row.token_hash, row.staff_id, row.issued_session_version,
      row.issued_authorization_version, row.expires_at, row.created_at,
      row.updated_at,
    ),
    createAuditEventStatement(database, {
      id: crypto.randomUUID(),
      aggregateType: 'STAFF_SESSION',
      aggregateId: row.id,
      eventType: 'STAFF_SESSION_CREATED',
      actor: { type: 'STAFF', id: row.staff_id, roles: [] },
      requestId: input.requestId,
      idempotencyKey: null,
      nextState: {
        staff_id: row.staff_id,
        expires_at: row.expires_at,
        issued_session_version: row.issued_session_version,
        issued_authorization_version: row.issued_authorization_version,
      },
      createdAt: input.now,
    }),
    database.prepare(`
      INSERT INTO transaction_assertions (assertion_value)
      SELECT CASE WHEN EXISTS (
        SELECT 1 FROM staff_sessions
        WHERE id=? AND staff_id=? AND status='ACTIVE'
          AND expires_at=? AND issued_session_version=?
          AND issued_authorization_version=?
      ) THEN 1 ELSE 0 END
    `).bind(
      row.id, row.staff_id, row.expires_at, row.issued_session_version,
      row.issued_authorization_version,
    ),
  ]);
  return row;
}

export async function findStaffSessionByToken(
  database: SqlDatabase,
  token: string,
): Promise<StaffSessionRow | null> {
  const tokenHash = await hashStaffOpaqueToken(token).catch(() => null);
  if (!tokenHash) return null;
  return database.prepare(`
    SELECT id, token_hash, staff_id, issued_session_version,
      issued_authorization_version, status, expires_at, revoked_at,
      revoked_reason, created_at, updated_at
    FROM staff_sessions WHERE token_hash=?
  `).bind(tokenHash).first<StaffSessionRow>();
}

export async function revokeStaffSession(
  database: SqlDatabase,
  input: {
    session: StaffSessionRow;
    reason: string;
    requestId: string;
    now: number;
  },
): Promise<boolean> {
  if (input.session.status !== 'ACTIVE') return false;
  await database.batch([
    database.prepare(`
      UPDATE staff_sessions
      SET status='REVOKED', revoked_at=?, revoked_reason=?, updated_at=?
      WHERE id=? AND status='ACTIVE'
    `).bind(input.now, input.reason, input.now, input.session.id),
    createAuditEventStatement(database, {
      id: crypto.randomUUID(),
      aggregateType: 'STAFF_SESSION',
      aggregateId: input.session.id,
      eventType: 'STAFF_SESSION_REVOKED',
      actor: { type: 'STAFF', id: input.session.staff_id, roles: [] },
      requestId: input.requestId,
      idempotencyKey: null,
      previousState: { status: 'ACTIVE' },
      nextState: { status: 'REVOKED', reason: input.reason },
      createdAt: input.now,
    }),
  ]);
  return true;
}

export function projectStaffSession(
  authorization: {
    staffId: string;
    displayName: string;
    roles: ReadonlySet<string>;
    permissions: ReadonlySet<string>;
    authorizationVersion: number;
  },
  dataScope: StaffDataScope,
  session: StaffSessionRow,
): StaffSessionSafeDto {
  const roles = [...authorization.roles];
  if (roles.length !== 1 || !isStaffRoleCode(roles[0])) {
    throw new StaffAuthError('UNAUTHENTICATED', 401, {
      reason: 'AUTHORIZATION_UNAVAILABLE',
    });
  }
  const role = roles[0];
  return {
    staff_id: authorization.staffId,
    display_name: authorization.displayName,
    role: { code: role, display_name: STAFF_ROLE_DISPLAY_NAMES[role] },
    permissions: [...authorization.permissions].sort() as StaffSessionSafeDto['permissions'],
    data_scope: dataScope,
    authorization_version: authorization.authorizationVersion,
    session_version: session.issued_session_version,
    expires_at: session.expires_at,
  };
}
