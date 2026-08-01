import type {
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import {
  canonicalJson,
  hashCanonicalJson,
} from '@ygb/domain';
import {
  createAuditEventStatement,
} from '../foundation/audit';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  markIdempotencyFailed,
} from '../foundation/idempotency';
import {
  CustomerAuthError,
  insertAccessEventStatement,
  requireStaffPermission,
  type CustomerAccessActor,
} from '../customer-auth/customer-auth-shared';

interface AccountBindingRow {
  account_id: string;
  identity_subject_id: string;
  account_status: string;
  account_version: number;
  session_version: number;
  old_buyer_customer_id: string;
}

interface TargetBuyerRow {
  buyer_customer_id: string;
  identity_subject_id: string;
  access_status: string;
  identity_review_status: string;
  display_wechat: string;
  normalized_wechat: string;
}

export class BuyerAuthRecoveryError extends Error {
  constructor(
    public readonly code:
      | 'VALIDATION_ERROR'
      | 'FORBIDDEN'
      | 'NOT_FOUND'
      | 'VERSION_CONFLICT'
      | 'CONFLICT'
      | 'DEPENDENCY_UNAVAILABLE',
    public readonly status: 400 | 403 | 404 | 409 | 503,
  ) {
    super(code);
    this.name = 'BuyerAuthRecoveryError';
  }
}

export interface BuyerAuthRecoveryCommand {
  actor: CustomerAccessActor;
  idempotencyKey: string;
  requestId?: string | null;
  now?: number;
}

export async function freezeBuyerAuthAccount(
  database: SqlDatabase,
  input: { accountId: string; expectedVersion: number; reason: string },
  command: BuyerAuthRecoveryCommand,
): Promise<{ account_id: string; version: number; session_version: number; replayed: boolean }> {
  return mutateAccount(database, 'ACCOUNT_FROZEN', input, command);
}

export async function revokeAllBuyerSessions(
  database: SqlDatabase,
  input: { accountId: string; expectedVersion: number; reason: string },
  command: BuyerAuthRecoveryCommand,
): Promise<{ account_id: string; version: number; session_version: number; replayed: boolean }> {
  return mutateAccount(database, 'SESSIONS_REVOKED', input, command);
}

async function mutateAccount(
  database: SqlDatabase,
  eventType: 'ACCOUNT_FROZEN' | 'SESSIONS_REVOKED',
  input: { accountId: string; expectedVersion: number; reason: string },
  command: BuyerAuthRecoveryCommand,
) {
  requireStaffPermission(command.actor, 'BUYER_IDENTITY_HIGH_RISK_MANAGE');
  const accountId = clean(input.accountId, 120);
  const reason = clean(input.reason, 2000);
  const now = command.now ?? Date.now();
  validateExpectedVersion(input.expectedVersion);
  const requestHash = await hashCanonicalJson({
    action: eventType,
    account_id: accountId,
    expected_version: input.expectedVersion,
    reason,
  });
  const acquired = await acquireIdempotency<{
    account_id: string;
    version: number;
    session_version: number;
    replayed: boolean;
  }>(database, {
    actorType: 'STAFF',
    actorId: command.actor.staffId,
    action: eventType,
    targetType: 'BUYER_AUTH_ACCOUNT',
    targetId: accountId,
    idempotencyKey: command.idempotencyKey,
    requestHash,
  }, { now });
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }
  try {
    const source = await requireAccount(database, accountId);
    if (source.account_version !== input.expectedVersion) {
      throw new BuyerAuthRecoveryError('VERSION_CONFLICT', 409);
    }
    const nextVersion = source.account_version + 1;
    const nextSessionVersion = source.session_version + 1;
    const response = {
      account_id: accountId,
      version: nextVersion,
      session_version: nextSessionVersion,
      replayed: false,
    };
    const update = eventType === 'ACCOUNT_FROZEN'
      ? database.prepare(`
          UPDATE customer_login_accounts
          SET status='DISABLED', disabled_at=?,
            session_version=session_version+1,
            version=version+1, updated_at=MAX(?, updated_at+1)
          WHERE id=? AND account_type='BUYER' AND version=?
        `).bind(now, now, accountId, source.account_version)
      : database.prepare(`
          UPDATE customer_login_accounts
          SET session_version=session_version+1,
            version=version+1, updated_at=MAX(?, updated_at+1)
          WHERE id=? AND account_type='BUYER' AND version=?
        `).bind(now, accountId, source.account_version);
    const statements: SqlStatement[] = [
      update,
      insertAccessEventStatement(database, {
        accountId,
        identitySubjectId: source.identity_subject_id,
        eventType: eventType === 'ACCOUNT_FROZEN'
          ? 'ACCOUNT_DISABLED'
          : 'SESSIONS_REVOKED',
        actorType: 'STAFF',
        actorId: command.actor.staffId,
        previousState: {
          version: source.account_version,
          session_version: source.session_version,
          status: source.account_status,
        },
        nextState: {
          version: nextVersion,
          session_version: nextSessionVersion,
          status: eventType === 'ACCOUNT_FROZEN'
            ? 'DISABLED'
            : source.account_status,
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        createdAt: now,
      }),
      recoveryEventStatement(database, {
        accountId,
        eventType,
        oldBuyerCustomerId: source.old_buyer_customer_id,
        newBuyerCustomerId: source.old_buyer_customer_id,
        previousVersion: source.account_version,
        nextVersion,
        actorStaffId: command.actor.staffId,
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        metadata: { reason },
        now,
      }),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'BUYER_AUTH_ACCOUNT',
        aggregateId: accountId,
        eventType,
        actor: {
          type: 'STAFF',
          id: command.actor.staffId,
          roles: command.actor.roles,
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: {
          version: source.account_version,
          session_version: source.session_version,
        },
        nextState: {
          version: nextVersion,
          session_version: nextSessionVersion,
        },
        reason,
        createdAt: now,
      }),
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: { account_id: accountId },
        now,
      }),
      accountMutationAssertion(database, acquired.claim, accountId,
        nextVersion, nextSessionVersion,
        eventType === 'ACCOUNT_FROZEN' ? 'DISABLED' : source.account_status),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ];
    await database.batch(statements);
    return response;
  } catch (error) {
    const normalized = normalizeRecoveryError(error);
    await markIdempotencyFailed(
      database,
      acquired.claim,
      normalized.code,
      now,
    );
    throw normalized;
  }
}

export async function rebindBuyerAuthAccount(
  database: SqlDatabase,
  input: {
    accountId: string;
    targetBuyerCustomerId: string;
    expectedVersion: number;
    reason: string;
  },
  command: BuyerAuthRecoveryCommand,
): Promise<{
  account_id: string;
  old_buyer_customer_id: string;
  new_buyer_customer_id: string;
  version: number;
  session_version: number;
  replayed: boolean;
}> {
  requireStaffPermission(command.actor, 'BUYER_IDENTITY_HIGH_RISK_MANAGE');
  const accountId = clean(input.accountId, 120);
  const targetBuyerCustomerId = clean(input.targetBuyerCustomerId, 120);
  const reason = clean(input.reason, 2000);
  validateExpectedVersion(input.expectedVersion);
  const now = command.now ?? Date.now();
  const requestHash = await hashCanonicalJson({
    action: 'REBIND_BUYER_AUTH_ACCOUNT',
    account_id: accountId,
    target_buyer_customer_id: targetBuyerCustomerId,
    expected_version: input.expectedVersion,
    reason,
  });
  type Response = {
    account_id: string;
    old_buyer_customer_id: string;
    new_buyer_customer_id: string;
    version: number;
    session_version: number;
    replayed: boolean;
  };
  const acquired = await acquireIdempotency<Response>(database, {
    actorType: 'STAFF',
    actorId: command.actor.staffId,
    action: 'REBIND_BUYER_AUTH_ACCOUNT',
    targetType: 'BUYER_AUTH_ACCOUNT',
    targetId: accountId,
    idempotencyKey: command.idempotencyKey,
    requestHash,
  }, { now });
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }
  try {
    const source = await requireAccount(database, accountId);
    if (source.account_version !== input.expectedVersion) {
      throw new BuyerAuthRecoveryError('VERSION_CONFLICT', 409);
    }
    if (source.old_buyer_customer_id === targetBuyerCustomerId) {
      throw new BuyerAuthRecoveryError('CONFLICT', 409);
    }
    const target = await requireTargetBuyer(database, targetBuyerCustomerId);
    const nextVersion = source.account_version + 1;
    const nextSessionVersion = source.session_version + 1;
    const response: Response = {
      account_id: accountId,
      old_buyer_customer_id: source.old_buyer_customer_id,
      new_buyer_customer_id: targetBuyerCustomerId,
      version: nextVersion,
      session_version: nextSessionVersion,
      replayed: false,
    };
    await database.batch([
      database.prepare(`
        UPDATE customer_login_accounts
        SET
          identity_subject_id=?,
          login_identifier_display=?,
          login_identifier_normalized=?,
          session_version=session_version+1,
          version=version+1,
          registration_source='RECOVERY_REBIND',
          updated_at=MAX(?, updated_at+1)
        WHERE id=?
          AND account_type='BUYER'
          AND version=?
          AND NOT EXISTS (
            SELECT 1 FROM customer_login_accounts other
            WHERE other.identity_subject_id=? AND other.id<>?
          )
      `).bind(
        target.identity_subject_id,
        target.display_wechat,
        target.normalized_wechat,
        now,
        accountId,
        source.account_version,
        target.identity_subject_id,
        accountId,
      ),
      recoveryEventStatement(database, {
        accountId,
        eventType: 'ACCOUNT_REBOUND',
        oldBuyerCustomerId: source.old_buyer_customer_id,
        newBuyerCustomerId: targetBuyerCustomerId,
        previousVersion: source.account_version,
        nextVersion,
        actorStaffId: command.actor.staffId,
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        metadata: { reason },
        now,
      }),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'BUYER_CUSTOMER',
        aggregateId: source.old_buyer_customer_id,
        eventType: 'BUYER_AUTH_ACCOUNT_UNBOUND',
        actor: {
          type: 'STAFF',
          id: command.actor.staffId,
          roles: command.actor.roles,
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: { account_id: accountId },
        nextState: { account_id: null },
        reason,
        createdAt: now,
      }),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'BUYER_CUSTOMER',
        aggregateId: targetBuyerCustomerId,
        eventType: 'BUYER_AUTH_ACCOUNT_BOUND',
        actor: {
          type: 'STAFF',
          id: command.actor.staffId,
          roles: command.actor.roles,
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: { account_id: null },
        nextState: { account_id: accountId },
        reason,
        createdAt: now,
      }),
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: {
          account_id: accountId,
          buyer_customer_id: targetBuyerCustomerId,
        },
        now,
      }),
      rebindAssertion(database, acquired.claim, accountId,
        target.identity_subject_id, nextVersion, nextSessionVersion),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ]);
    return response;
  } catch (error) {
    const normalized = normalizeRecoveryError(error);
    await markIdempotencyFailed(
      database,
      acquired.claim,
      normalized.code,
      now,
    );
    throw normalized;
  }
}

async function requireAccount(
  database: SqlDatabase,
  accountId: string,
): Promise<AccountBindingRow> {
  const row = await database.prepare(`
    SELECT
      account.id AS account_id,
      account.identity_subject_id,
      account.status AS account_status,
      account.version AS account_version,
      account.session_version,
      buyer.id AS old_buyer_customer_id
    FROM customer_login_accounts account
    JOIN buyer_customers buyer
      ON buyer.identity_subject_id=account.identity_subject_id
    WHERE account.id=? AND account.account_type='BUYER'
  `).bind(accountId).first<AccountBindingRow>();
  if (!row) throw new BuyerAuthRecoveryError('NOT_FOUND', 404);
  return row;
}

async function requireTargetBuyer(
  database: SqlDatabase,
  buyerCustomerId: string,
): Promise<TargetBuyerRow> {
  const row = await database.prepare(`
    SELECT
      buyer.id AS buyer_customer_id,
      buyer.identity_subject_id,
      buyer.access_status,
      buyer.identity_review_status,
      claim.display_wechat,
      claim.normalized_wechat
    FROM buyer_customers buyer
    JOIN wechat_identity_claims claim
      ON claim.identity_subject_id=buyer.identity_subject_id
      AND claim.status='ACTIVE'
    WHERE buyer.id=?
  `).bind(buyerCustomerId).first<TargetBuyerRow>();
  if (!row) throw new BuyerAuthRecoveryError('NOT_FOUND', 404);
  if (row.access_status !== 'ACTIVE'
    || row.identity_review_status !== 'CLEAR') {
    throw new BuyerAuthRecoveryError('CONFLICT', 409);
  }
  const existing = await database.prepare(`
    SELECT 1 FROM customer_login_accounts
    WHERE identity_subject_id=?
  `).bind(row.identity_subject_id).first();
  if (existing) throw new BuyerAuthRecoveryError('CONFLICT', 409);
  return row;
}

function recoveryEventStatement(
  database: SqlDatabase,
  input: {
    accountId: string;
    eventType: 'ACCOUNT_FROZEN' | 'SESSIONS_REVOKED' | 'ACCOUNT_REBOUND';
    oldBuyerCustomerId: string;
    newBuyerCustomerId: string;
    previousVersion: number;
    nextVersion: number;
    actorStaffId: string;
    requestId: string | null;
    idempotencyKey: string;
    metadata: unknown;
    now: number;
  },
): SqlStatement {
  return database.prepare(`
    INSERT INTO buyer_auth_recovery_events (
      id, account_id, event_type,
      old_buyer_customer_id, new_buyer_customer_id,
      previous_account_version, next_account_version,
      actor_staff_id, request_id, idempotency_key,
      metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    input.accountId,
    input.eventType,
    input.oldBuyerCustomerId,
    input.newBuyerCustomerId,
    input.previousVersion,
    input.nextVersion,
    input.actorStaffId,
    input.requestId,
    input.idempotencyKey,
    canonicalJson(input.metadata),
    input.now,
  );
}

function accountMutationAssertion(
  database: SqlDatabase,
  claim: { actorType: string; actorId: string; idempotencyKey: string; leaseToken: string },
  accountId: string,
  version: number,
  sessionVersion: number,
  status: string,
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM customer_login_accounts
      WHERE id=? AND account_type='BUYER'
        AND version=? AND session_version=? AND status=?
    ) AND EXISTS (
      SELECT 1 FROM buyer_auth_recovery_events
      WHERE account_id=? AND next_account_version=?
        AND idempotency_key=?
    ) THEN 1 ELSE 0 END
  `).bind(
    accountId,
    version,
    sessionVersion,
    status,
    accountId,
    version,
    claim.idempotencyKey,
  );
}

function rebindAssertion(
  database: SqlDatabase,
  claim: { actorType: string; actorId: string; idempotencyKey: string; leaseToken: string },
  accountId: string,
  identitySubjectId: string,
  version: number,
  sessionVersion: number,
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM customer_login_accounts
      WHERE id=? AND identity_subject_id=?
        AND account_type='BUYER'
        AND version=? AND session_version=?
        AND registration_source='RECOVERY_REBIND'
    ) AND EXISTS (
      SELECT 1 FROM buyer_auth_recovery_events
      WHERE account_id=? AND event_type='ACCOUNT_REBOUND'
        AND next_account_version=? AND idempotency_key=?
    ) THEN 1 ELSE 0 END
  `).bind(
    accountId,
    identitySubjectId,
    version,
    sessionVersion,
    accountId,
    version,
    claim.idempotencyKey,
  );
}

function normalizeRecoveryError(error: unknown): BuyerAuthRecoveryError {
  if (error instanceof BuyerAuthRecoveryError) return error;
  if (error instanceof CustomerAuthError) {
    return new BuyerAuthRecoveryError(
      error.code === 'FORBIDDEN' ? 'FORBIDDEN' : 'DEPENDENCY_UNAVAILABLE',
      error.code === 'FORBIDDEN' ? 403 : 503,
    );
  }
  const record = error as { code?: unknown };
  if (record?.code === 'IDEMPOTENCY_CONFLICT') {
    return new BuyerAuthRecoveryError('CONFLICT', 409);
  }
  if (record?.code === 'REQUEST_IN_PROGRESS') {
    return new BuyerAuthRecoveryError('CONFLICT', 409);
  }
  const message = String(error);
  if (message.includes('UNIQUE constraint failed')) {
    return new BuyerAuthRecoveryError('CONFLICT', 409);
  }
  return new BuyerAuthRecoveryError('DEPENDENCY_UNAVAILABLE', 503);
}

function clean(value: string, maximum: number): string {
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length < 1
    || normalized.length > maximum
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new BuyerAuthRecoveryError('VALIDATION_ERROR', 400);
  }
  return normalized;
}

function validateExpectedVersion(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new BuyerAuthRecoveryError('VALIDATION_ERROR', 400);
  }
}
