import {
  statementChangedOnce,
  type SqlDatabase,
  type SqlStatement,
} from '@ygb/contracts';
import {
  canonicalJson,
  parseIdempotencyKey,
} from '@ygb/domain';

const DEFAULT_LEASE_MS = 5 * 60 * 1000;

export type IdempotencyErrorCode =
  | 'VALIDATION_ERROR'
  | 'IDEMPOTENCY_CONFLICT'
  | 'REQUEST_IN_PROGRESS'
  | 'DEPENDENCY_UNAVAILABLE';

export class IdempotencyError extends Error {
  constructor(
    public readonly code: IdempotencyErrorCode,
    public readonly status: 400 | 409 | 503,
  ) {
    super(code);
    this.name = 'IdempotencyError';
  }
}

export interface IdempotencyIdentity {
  actorType: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  idempotencyKey: string;
  requestHash: string;
}

export interface IdempotencyClaim extends IdempotencyIdentity {
  leaseToken: string;
}

export type IdempotencyAcquireResult<T> =
  | {
      kind: 'ACQUIRED';
      claim: IdempotencyClaim;
    }
  | {
      kind: 'REPLAY';
      response: T;
    };

interface IdempotencyRow {
  action: string;
  target_type: string;
  target_id: string;
  request_hash: string;
  status: 'PROCESSING' | 'COMMITTED' | 'FAILED';
  lease_expires_at: number;
  response_json: string | null;
}

export async function acquireIdempotency<T>(
  database: SqlDatabase,
  identity: IdempotencyIdentity,
  options: {
    now?: number;
    leaseMs?: number;
  } = {},
): Promise<IdempotencyAcquireResult<T>> {
  const normalized = validateIdentity(identity);
  const now = options.now ?? Date.now();
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  validateTiming(now, leaseMs);

  const leaseToken = `command-lease:${crypto.randomUUID()}`;
  const inserted = await database.prepare(`
    INSERT OR IGNORE INTO command_idempotency_records (
      actor_type, actor_id, idempotency_key, action,
      target_type, target_id, request_hash, status,
      lease_token, lease_expires_at, attempt_count,
      response_json, result_references_json, error_code,
      created_at, updated_at, completed_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, 'PROCESSING',
      ?, ?, 1, NULL, NULL, NULL, ?, ?, NULL
    )
  `).bind(
    normalized.actorType,
    normalized.actorId,
    normalized.idempotencyKey,
    normalized.action,
    normalized.targetType,
    normalized.targetId,
    normalized.requestHash,
    leaseToken,
    now + leaseMs,
    now,
    now,
  ).run();

  if (statementChangedOnce(inserted)) {
    return {
      kind: 'ACQUIRED',
      claim: {
        ...normalized,
        leaseToken,
      },
    };
  }

  const existing = await readRecord(database, normalized);
  if (!existing) {
    throw new IdempotencyError('DEPENDENCY_UNAVAILABLE', 503);
  }

  assertSameRequest(existing, normalized);

  if (existing.status === 'COMMITTED') {
    if (!existing.response_json) {
      throw new IdempotencyError('DEPENDENCY_UNAVAILABLE', 503);
    }
    try {
      return {
        kind: 'REPLAY',
        response: JSON.parse(existing.response_json) as T,
      };
    } catch {
      throw new IdempotencyError('DEPENDENCY_UNAVAILABLE', 503);
    }
  }

  if (existing.status === 'PROCESSING'
    && existing.lease_expires_at > now) {
    throw new IdempotencyError('REQUEST_IN_PROGRESS', 409);
  }

  const takeover = await database.prepare(`
    UPDATE command_idempotency_records
    SET
      status='PROCESSING',
      lease_token=?,
      lease_expires_at=?,
      attempt_count=attempt_count+1,
      response_json=NULL,
      result_references_json=NULL,
      error_code=NULL,
      completed_at=NULL,
      updated_at=?
    WHERE actor_type=?
      AND actor_id=?
      AND idempotency_key=?
      AND action=?
      AND target_type=?
      AND target_id=?
      AND request_hash=?
      AND (
        status='FAILED'
        OR (status='PROCESSING' AND lease_expires_at<=?)
      )
  `).bind(
    leaseToken,
    now + leaseMs,
    now,
    normalized.actorType,
    normalized.actorId,
    normalized.idempotencyKey,
    normalized.action,
    normalized.targetType,
    normalized.targetId,
    normalized.requestHash,
    now,
  ).run();

  if (!statementChangedOnce(takeover)) {
    throw new IdempotencyError('REQUEST_IN_PROGRESS', 409);
  }

  return {
    kind: 'ACQUIRED',
    claim: {
      ...normalized,
      leaseToken,
    },
  };
}

export function completeIdempotencyStatement(
  database: SqlDatabase,
  claim: IdempotencyClaim,
  response: unknown,
  options: {
    resultReferences?: unknown;
    now?: number;
  } = {},
): SqlStatement {
  const now = options.now ?? Date.now();
  validateTiming(now, 1);

  return database.prepare(`
    UPDATE command_idempotency_records
    SET
      status='COMMITTED',
      response_json=?,
      result_references_json=?,
      error_code=NULL,
      completed_at=?,
      updated_at=?
    WHERE actor_type=?
      AND actor_id=?
      AND idempotency_key=?
      AND action=?
      AND target_type=?
      AND target_id=?
      AND request_hash=?
      AND status='PROCESSING'
      AND lease_token=?
  `).bind(
    canonicalJson(response),
    options.resultReferences === undefined
      ? null
      : canonicalJson(options.resultReferences),
    now,
    now,
    claim.actorType,
    claim.actorId,
    claim.idempotencyKey,
    claim.action,
    claim.targetType,
    claim.targetId,
    claim.requestHash,
    claim.leaseToken,
  );
}

export function assertIdempotencyCompletionStatement(
  database: SqlDatabase,
  claim: IdempotencyClaim,
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN EXISTS (
      SELECT 1
      FROM command_idempotency_records
      WHERE actor_type=?
        AND actor_id=?
        AND idempotency_key=?
        AND action=?
        AND target_type=?
        AND target_id=?
        AND request_hash=?
        AND status='COMMITTED'
        AND lease_token=?
    ) THEN 1 ELSE 0 END
  `).bind(
    claim.actorType,
    claim.actorId,
    claim.idempotencyKey,
    claim.action,
    claim.targetType,
    claim.targetId,
    claim.requestHash,
    claim.leaseToken,
  );
}

export async function markIdempotencyFailed(
  database: SqlDatabase,
  claim: IdempotencyClaim,
  errorCode: string,
  now = Date.now(),
): Promise<boolean> {
  if (!isSafeLabel(errorCode, 100)) {
    throw new IdempotencyError('VALIDATION_ERROR', 400);
  }
  validateTiming(now, 1);

  const result = await database.prepare(`
    UPDATE command_idempotency_records
    SET
      status='FAILED',
      response_json=NULL,
      result_references_json=NULL,
      error_code=?,
      completed_at=NULL,
      updated_at=?
    WHERE actor_type=?
      AND actor_id=?
      AND idempotency_key=?
      AND action=?
      AND target_type=?
      AND target_id=?
      AND request_hash=?
      AND status='PROCESSING'
      AND lease_token=?
  `).bind(
    errorCode,
    now,
    claim.actorType,
    claim.actorId,
    claim.idempotencyKey,
    claim.action,
    claim.targetType,
    claim.targetId,
    claim.requestHash,
    claim.leaseToken,
  ).run();

  return statementChangedOnce(result);
}

async function readRecord(
  database: SqlDatabase,
  identity: IdempotencyIdentity,
): Promise<IdempotencyRow | null> {
  return database.prepare(`
    SELECT
      action,
      target_type,
      target_id,
      request_hash,
      status,
      lease_expires_at,
      response_json
    FROM command_idempotency_records
    WHERE actor_type=?
      AND actor_id=?
      AND idempotency_key=?
  `).bind(
    identity.actorType,
    identity.actorId,
    identity.idempotencyKey,
  ).first<IdempotencyRow>();
}

function assertSameRequest(
  row: IdempotencyRow,
  identity: IdempotencyIdentity,
): void {
  if (row.action !== identity.action
    || row.target_type !== identity.targetType
    || row.target_id !== identity.targetId
    || row.request_hash !== identity.requestHash) {
    throw new IdempotencyError('IDEMPOTENCY_CONFLICT', 409);
  }
}

function validateIdentity(
  identity: IdempotencyIdentity,
): IdempotencyIdentity {
  const idempotencyKey = parseIdempotencyKey(identity.idempotencyKey);
  if (!idempotencyKey
    || !isSafeLabel(identity.actorType, 40)
    || !isSafeLabel(identity.actorId, 200)
    || !isSafeLabel(identity.action, 100)
    || !isSafeLabel(identity.targetType, 100)
    || !isSafeLabel(identity.targetId, 200)
    || !/^[0-9a-f]{64}$/u.test(identity.requestHash)) {
    throw new IdempotencyError('VALIDATION_ERROR', 400);
  }

  return {
    ...identity,
    idempotencyKey,
  };
}

function isSafeLabel(value: string, maxLength: number): boolean {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= maxLength
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function validateTiming(now: number, leaseMs: number): void {
  if (!Number.isSafeInteger(now) || now < 0
    || !Number.isSafeInteger(leaseMs)
    || leaseMs < 1
    || now + leaseMs > Number.MAX_SAFE_INTEGER) {
    throw new IdempotencyError('VALIDATION_ERROR', 400);
  }
}
