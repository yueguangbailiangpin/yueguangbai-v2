import type {
  StaffDataScope,
  StaffSessionSafeDto,
  SqlDatabase,
} from '@ygb/contracts';
import { canonicalJson } from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import {
  recordFeishuAdapterFailureSignal,
  recordLoginAnomalySignal,
  type OperationalAlertSink,
} from '../scheduled-operations/signals';
import {
  hashStaffOpaqueToken,
  hashStaffSecurityScope,
} from './crypto';
import { StaffAuthError } from './errors';
import type { StaffAuthRuntimeConfig } from './provider';

export interface StaffLoginStateRow {
  id: string;
  provider: 'FEISHU';
  tenant_key: string;
  callback_purpose: 'STAFF_LOGIN';
  return_to: string;
  status: 'ISSUED' | 'CONSUMED' | 'EXPIRED' | 'CANCELLED';
  expires_at: number;
  consumed_at: number | null;
  cancelled_at: number | null;
  created_at: number;
  updated_at: number;
}

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

export async function issueStaffLoginState(
  database: SqlDatabase,
  input: {
    stateHash: string;
    returnTo: string;
    origin: string;
    networkSource: string | null;
    requestId: string;
    config: StaffAuthRuntimeConfig;
    now: number;
    expiresAt: number;
  },
): Promise<void> {
  const originHash = await hashStaffSecurityScope(
    input.config.hashSecret,
    'staff-login-origin',
    input.origin,
  );
  const networkHash = input.networkSource
    ? await hashStaffSecurityScope(
        input.config.hashSecret,
        'staff-login-network',
        input.networkSource,
      )
    : null;
  await database.prepare(`
    INSERT INTO staff_login_states (
      id, state_hash, provider, tenant_key, callback_purpose,
      return_to, status, origin_hash, network_source_hash,
      request_id, expires_at, consumed_at, cancelled_at,
      created_at, updated_at
    ) VALUES (?, ?, 'FEISHU', ?, 'STAFF_LOGIN', ?, 'ISSUED',
      ?, ?, ?, ?, NULL, NULL, ?, ?)
  `).bind(
    crypto.randomUUID(),
    input.stateHash,
    input.config.tenantKey,
    input.returnTo,
    originHash,
    networkHash,
    input.requestId,
    input.expiresAt,
    input.now,
    input.now,
  ).run();
}

export async function consumeStaffLoginState(
  database: SqlDatabase,
  input: {
    stateHash: string;
    expectedTenantKey: string;
    now: number;
  },
): Promise<StaffLoginStateRow> {
  const row = await database.prepare(`
    SELECT id, provider, tenant_key, callback_purpose, return_to,
      status, expires_at, consumed_at, cancelled_at, created_at, updated_at
    FROM staff_login_states WHERE state_hash=?
  `).bind(input.stateHash).first<StaffLoginStateRow>();
  if (!row) throw new StaffAuthError('STATE_CONFLICT', 409, { reason: 'INVALID' });
  if (row.provider !== 'FEISHU'
    || row.tenant_key !== input.expectedTenantKey
    || row.callback_purpose !== 'STAFF_LOGIN') {
    throw new StaffAuthError('STATE_CONFLICT', 409, { reason: 'INVALID' });
  }
  if (row.status !== 'ISSUED') {
    throw new StaffAuthError('STATE_CONFLICT', 409, { reason: 'REPLAYED' });
  }
  if (row.expires_at <= input.now) {
    await database.prepare(`
      UPDATE staff_login_states
      SET status='EXPIRED', updated_at=?
      WHERE id=? AND status='ISSUED' AND expires_at<=?
    `).bind(input.now, row.id, input.now).run();
    throw new StaffAuthError('STATE_CONFLICT', 409, { reason: 'EXPIRED' });
  }
  const update = await database.prepare(`
    UPDATE staff_login_states
    SET status='CONSUMED', consumed_at=?, updated_at=?
    WHERE id=? AND status='ISSUED' AND expires_at>?
  `).bind(input.now, input.now, row.id, input.now).run();
  if (Number(update.meta.changes) !== 1) {
    throw new StaffAuthError('STATE_CONFLICT', 409, { reason: 'REPLAYED' });
  }
  return {
    ...row,
    status: 'CONSUMED',
    consumed_at: input.now,
    updated_at: input.now,
  };
}

export async function consumeStaffAuthRateLimit(
  database: SqlDatabase,
  input: {
    action: 'LOGIN_START' | 'LOGIN_CALLBACK';
    scopeType: 'NETWORK' | 'TENANT_SUBJECT' | 'NETWORK_TENANT';
    scopeValue: string;
    config: StaffAuthRuntimeConfig;
    now: number;
    maximumAttempts?: number;
    windowMs?: number;
    blockMs?: number;
  },
): Promise<{
  limited: boolean;
  retryAfterSeconds: number;
  scopeHash: string;
}> {
  const maximumAttempts = input.maximumAttempts ?? 10;
  const windowMs = input.windowMs ?? 10 * 60 * 1000;
  const blockMs = input.blockMs ?? 15 * 60 * 1000;
  const windowStartedAt = Math.floor(input.now / windowMs) * windowMs;
  const windowEndsAt = windowStartedAt + windowMs;
  const scopeHash = await hashStaffSecurityScope(
    input.config.hashSecret,
    `staff-rate:${input.action}:${input.scopeType}`,
    input.scopeValue,
  );
  await database.prepare(`
    INSERT INTO staff_auth_rate_limits (
      id, action, scope_type, scope_hash, window_started_at,
      window_ends_at, attempt_count, blocked_until, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1, NULL, ?, ?)
    ON CONFLICT(action, scope_type, scope_hash, window_started_at)
    DO UPDATE SET
      attempt_count=staff_auth_rate_limits.attempt_count+1,
      blocked_until=CASE
        WHEN staff_auth_rate_limits.attempt_count+1>=?
        THEN MAX(COALESCE(staff_auth_rate_limits.blocked_until,0), ?)
        ELSE staff_auth_rate_limits.blocked_until
      END,
      updated_at=MAX(excluded.updated_at, staff_auth_rate_limits.updated_at+1)
  `).bind(
    crypto.randomUUID(),
    input.action,
    input.scopeType,
    scopeHash,
    windowStartedAt,
    windowEndsAt,
    input.now,
    input.now,
    maximumAttempts,
    input.now + blockMs,
  ).run();
  const row = await database.prepare(`
    SELECT attempt_count, blocked_until, window_ends_at
    FROM staff_auth_rate_limits
    WHERE action=? AND scope_type=? AND scope_hash=? AND window_started_at=?
  `).bind(
    input.action,
    input.scopeType,
    scopeHash,
    windowStartedAt,
  ).first<{
    attempt_count: number;
    blocked_until: number | null;
    window_ends_at: number;
  }>();
  if (!row) throw new StaffAuthError('DEPENDENCY_UNAVAILABLE', 503);
  const blockedUntil = row.blocked_until ?? 0;
  const limited = blockedUntil > input.now;
  return {
    limited,
    retryAfterSeconds: limited
      ? Math.max(1, Math.ceil((blockedUntil - input.now) / 1000))
      : 0,
    scopeHash,
  };
}

export async function resolveVerifiedStaffIdentity(
  database: SqlDatabase,
  input: {
    tenantKey: string;
    openId: string;
    userId: string | null;
  },
): Promise<StaffIdentityRow> {
  const row = await database.prepare(`
    SELECT identity.id AS identity_id, identity.staff_id,
      identity.status AS identity_status,
      identity.user_id AS identity_user_id,
      staff.display_name, staff.status AS staff_status,
      staff.authorization_version, staff.session_version
    FROM feishu_staff_identities identity
    JOIN staff_users staff ON staff.id=identity.staff_id
    WHERE identity.tenant_key=? AND identity.open_id=?
    LIMIT 2
  `).bind(input.tenantKey, input.openId).first<StaffIdentityRow>();
  if (!row) throw new StaffAuthError('UNAUTHENTICATED', 401, { reason: 'UNKNOWN_IDENTITY' });
  if (row.identity_user_id !== null
    && input.userId !== null
    && row.identity_user_id !== input.userId) {
    throw new StaffAuthError('UNAUTHENTICATED', 401, { reason: 'IDENTITY_CONFLICT' });
  }
  if (row.identity_status !== 'ACTIVE' || row.staff_status !== 'ACTIVE') {
    throw new StaffAuthError('UNAUTHENTICATED', 401, { reason: 'INACTIVE_IDENTITY' });
  }
  return row;
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
  const tokenHash = await hashStaffOpaqueToken(input.token);
  const sessionId = crypto.randomUUID();
  const row: StaffSessionRow = {
    id: sessionId,
    token_hash: tokenHash,
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
      row.id,
      row.token_hash,
      row.staff_id,
      row.issued_session_version,
      row.issued_authorization_version,
      row.expires_at,
      row.created_at,
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
      row.id,
      row.staff_id,
      row.expires_at,
      row.issued_session_version,
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

export async function revokeAllStaffSessions(
  database: SqlDatabase,
  input: {
    staffId: string;
    currentSessionId: string;
    requestId: string;
    idempotencyKey: string;
    now: number;
  },
): Promise<number> {
  const staff = await database.prepare(`
    SELECT session_version FROM staff_users
    WHERE id=? AND status='ACTIVE'
  `).bind(input.staffId).first<{ session_version: number }>();
  if (!staff) throw new StaffAuthError('UNAUTHENTICATED', 401);
  const nextVersion = Number(staff.session_version) + 1;
  if (!Number.isSafeInteger(nextVersion) || nextVersion < 2) {
    throw new StaffAuthError('DEPENDENCY_UNAVAILABLE', 503);
  }
  await database.batch([
    database.prepare(`
      UPDATE staff_users
      SET session_version=session_version+1, version=version+1,
        updated_at=MAX(?, updated_at+1)
      WHERE id=? AND status='ACTIVE' AND session_version=?
    `).bind(input.now, input.staffId, staff.session_version),
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
      actor: { type: 'STAFF', id: input.staffId, roles: [] },
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey,
      previousState: { session_version: staff.session_version },
      nextState: { session_version: nextVersion },
      metadata: { current_session_id: input.currentSessionId },
      createdAt: input.now,
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
  ]);
  return nextVersion;
}

export async function recordStaffAuthSecurityEvent(
  database: SqlDatabase,
  input: {
    eventType:
      | 'LOGIN_FAILED'
      | 'LOGIN_RATE_LIMITED'
      | 'STATE_INVALID'
      | 'STATE_EXPIRED'
      | 'STATE_REPLAYED'
      | 'IDENTITY_UNKNOWN'
      | 'IDENTITY_CONFLICT'
      | 'IDENTITY_INACTIVE'
      | 'PROVIDER_FAILURE'
      | 'SESSION_REJECTED'
      | 'COOKIE_REJECTED';
    outcome: 'FAILURE' | 'BLOCKED' | 'REJECTED';
    config: StaffAuthRuntimeConfig;
    staffId?: string | null;
    sessionId?: string | null;
    tenantKey?: string | null;
    subject?: string | null;
    networkSource?: string | null;
    requestId?: string | null;
    metadata?: Record<string, unknown>;
    alertSink?: OperationalAlertSink|null;
    createdAt: number;
  },
): Promise<void> {
  const tenantHash = input.tenantKey
    ? await hashStaffSecurityScope(
        input.config.hashSecret,
        'staff-security-tenant',
        input.tenantKey,
      )
    : null;
  const subjectHash = input.subject
    ? await hashStaffSecurityScope(
        input.config.hashSecret,
        'staff-security-subject',
        input.subject,
      )
    : null;
  const networkHash = input.networkSource
    ? await hashStaffSecurityScope(
        input.config.hashSecret,
        'staff-security-network',
        input.networkSource,
      )
    : null;
  const metadataJson = canonicalJson(input.metadata ?? {});
  if (metadataJson.length > 4096) {
    throw new StaffAuthError('DEPENDENCY_UNAVAILABLE', 503);
  }
  const securityEventId=crypto.randomUUID();
  await database.prepare(`
    INSERT INTO staff_auth_security_events (
      id, event_type, outcome, staff_id, session_id, provider,
      tenant_hash, subject_hash, network_source_hash,
      request_id, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, 'FEISHU', ?, ?, ?, ?, ?, ?)
  `).bind(
    securityEventId,
    input.eventType,
    input.outcome,
    input.staffId ?? null,
    input.sessionId ?? null,
    tenantHash,
    subjectHash,
    networkHash,
    input.requestId ?? null,
    metadataJson,
    input.createdAt,
  ).run();
  const signalInput={securityEventId,observedAt:input.createdAt,...(input.alertSink===undefined?{}:{sink:input.alertSink})};
  if (input.eventType==='PROVIDER_FAILURE') {
    await recordFeishuAdapterFailureSignal(database,signalInput).catch(()=>undefined);
  } else {
    await recordLoginAnomalySignal(database,signalInput).catch(()=>undefined);
  }
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
  return {
    staff_id: authorization.staffId,
    display_name: authorization.displayName,
    roles: [...authorization.roles].sort() as StaffSessionSafeDto['roles'],
    permissions: (
      [...authorization.permissions].sort()
    ) as StaffSessionSafeDto['permissions'],
    data_scope: dataScope,
    authorization_version: authorization.authorizationVersion,
    session_version: session.issued_session_version,
    expires_at: session.expires_at,
  };
}
