import {
  statementChangedOnce,
  type SqlDatabase,
  type SqlStatement,
} from '@ygb/contracts';
import {
  canonicalJson,
  hashCanonicalJson,
} from '@ygb/domain';

const DEFAULT_LEASE_MS = 5 * 60 * 1000;

export class OutboxError extends Error {
  constructor(
    public readonly code:
      | 'VALIDATION_ERROR'
      | 'OUTBOX_CONFLICT'
      | 'DEPENDENCY_UNAVAILABLE',
  ) {
    super(code);
    this.name = 'OutboxError';
  }
}

export interface OutboxEventInput {
  id: string;
  dedupKey: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: unknown;
  availableAt?: number;
  createdAt?: number;
}

export interface PreparedOutboxEvent {
  input: Omit<OutboxEventInput, 'payload'>;
  payloadJson: string;
  payloadHash: string;
}

export interface ClaimedOutboxEvent {
  id: string;
  dedup_key: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload_json: string;
  payload_hash: string;
  attempt_count: number;
  lease_token: string;
  lease_expires_at: number;
}

export async function prepareOutboxEvent(
  input: OutboxEventInput,
): Promise<PreparedOutboxEvent> {
  validateInput(input);
  const createdAt = input.createdAt ?? Date.now();
  const availableAt = input.availableAt ?? createdAt;

  if (!Number.isSafeInteger(createdAt) || createdAt < 0
    || !Number.isSafeInteger(availableAt) || availableAt < 0) {
    throw new OutboxError('VALIDATION_ERROR');
  }

  return {
    input: {
      id: input.id,
      dedupKey: input.dedupKey,
      eventType: input.eventType,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      availableAt,
      createdAt,
    },
    payloadJson: canonicalJson(input.payload),
    payloadHash: await hashCanonicalJson(input.payload),
  };
}

export function createOutboxStatements(
  database: SqlDatabase,
  event: PreparedOutboxEvent,
): readonly SqlStatement[] {
  const {
    id,
    dedupKey,
    eventType,
    aggregateType,
    aggregateId,
    availableAt,
    createdAt,
  } = event.input;

  return [
    database.prepare(`
      INSERT OR IGNORE INTO integration_outbox (
        id,
        dedup_key,
        event_type,
        aggregate_type,
        aggregate_id,
        payload_json,
        payload_hash,
        status,
        available_at,
        lease_token,
        lease_expires_at,
        attempt_count,
        last_error,
        created_at,
        updated_at,
        sent_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        'PENDING', ?, NULL, NULL, 0, NULL, ?, ?, NULL
      )
    `).bind(
      id,
      dedupKey,
      eventType,
      aggregateType,
      aggregateId,
      event.payloadJson,
      event.payloadHash,
      availableAt,
      createdAt,
      createdAt,
    ),
    database.prepare(`
      INSERT INTO transaction_assertions (assertion_value)
      SELECT CASE WHEN EXISTS (
        SELECT 1
        FROM integration_outbox
        WHERE dedup_key=?
          AND event_type=?
          AND aggregate_type=?
          AND aggregate_id=?
          AND payload_hash=?
      ) THEN 1 ELSE 0 END
    `).bind(
      dedupKey,
      eventType,
      aggregateType,
      aggregateId,
      event.payloadHash,
    ),
  ] as const;
}

export async function claimNextOutboxEvent(
  database: SqlDatabase,
  options: {
    now?: number;
    leaseMs?: number;
  } = {},
): Promise<ClaimedOutboxEvent | null> {
  const now = options.now ?? Date.now();
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  validateTiming(now, leaseMs);
  const leaseToken = `outbox-lease:${crypto.randomUUID()}`;

  return database.prepare(`
    UPDATE integration_outbox
    SET
      status='PROCESSING',
      lease_token=?,
      lease_expires_at=?,
      attempt_count=attempt_count+1,
      last_error=NULL,
      updated_at=?
    WHERE id=(
      SELECT id
      FROM integration_outbox
      WHERE available_at<=?
        AND (
          status IN ('PENDING', 'FAILED')
          OR (
            status='PROCESSING'
            AND lease_expires_at IS NOT NULL
            AND lease_expires_at<=?
          )
        )
      ORDER BY available_at, created_at, id
      LIMIT 1
    )
    AND (
      status IN ('PENDING', 'FAILED')
      OR (
        status='PROCESSING'
        AND lease_expires_at IS NOT NULL
        AND lease_expires_at<=?
      )
    )
    RETURNING
      id,
      dedup_key,
      event_type,
      aggregate_type,
      aggregate_id,
      payload_json,
      payload_hash,
      attempt_count,
      lease_token,
      lease_expires_at
  `).bind(
    leaseToken,
    now + leaseMs,
    now,
    now,
    now,
    now,
  ).first<ClaimedOutboxEvent>();
}

export async function markOutboxSent(
  database: SqlDatabase,
  event: Pick<ClaimedOutboxEvent, 'id' | 'lease_token'>,
  now = Date.now(),
): Promise<boolean> {
  validateTiming(now, 1);
  const result = await database.prepare(`
    UPDATE integration_outbox
    SET
      status='SENT',
      lease_token=NULL,
      lease_expires_at=NULL,
      last_error=NULL,
      sent_at=?,
      updated_at=?
    WHERE id=?
      AND status='PROCESSING'
      AND lease_token=?
  `).bind(
    now,
    now,
    event.id,
    event.lease_token,
  ).run();

  return statementChangedOnce(result);
}

export async function markOutboxFailed(
  database: SqlDatabase,
  event: Pick<ClaimedOutboxEvent, 'id' | 'lease_token'>,
  input: {
    error: string;
    nextAttemptAt: number;
    now?: number;
  },
): Promise<boolean> {
  const now = input.now ?? Date.now();
  validateTiming(now, 1);
  if (!Number.isSafeInteger(input.nextAttemptAt)
    || input.nextAttemptAt < now
    || !safe(input.error, 1000)) {
    throw new OutboxError('VALIDATION_ERROR');
  }

  const result = await database.prepare(`
    UPDATE integration_outbox
    SET
      status='FAILED',
      available_at=?,
      lease_token=NULL,
      lease_expires_at=NULL,
      last_error=?,
      sent_at=NULL,
      updated_at=?
    WHERE id=?
      AND status='PROCESSING'
      AND lease_token=?
  `).bind(
    input.nextAttemptAt,
    input.error,
    now,
    event.id,
    event.lease_token,
  ).run();

  return statementChangedOnce(result);
}

function validateInput(input: OutboxEventInput): void {
  if (!safe(input.id, 200)
    || !safe(input.dedupKey, 200)
    || input.dedupKey.length < 8
    || !safe(input.eventType, 100)
    || !safe(input.aggregateType, 100)
    || !safe(input.aggregateId, 200)) {
    throw new OutboxError('VALIDATION_ERROR');
  }
}

function safe(value: string, maximum: number): boolean {
  return value.length >= 1
    && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function validateTiming(now: number, leaseMs: number): void {
  if (!Number.isSafeInteger(now) || now < 0
    || !Number.isSafeInteger(leaseMs)
    || leaseMs < 1
    || now + leaseMs > Number.MAX_SAFE_INTEGER) {
    throw new OutboxError('VALIDATION_ERROR');
  }
}
