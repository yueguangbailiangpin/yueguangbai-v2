import type {
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import { canonicalJson } from '@ygb/domain';

export interface AuditActor {
  type: string;
  id: string | null;
  roles: readonly string[];
}

export interface AuditEventInput {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  actor: AuditActor;
  requestId?: string | null;
  idempotencyKey?: string | null;
  previousState?: unknown | null;
  nextState: unknown;
  reason?: string | null;
  metadata?: unknown;
  createdAt?: number;
}

export function createAuditEventStatement(
  database: SqlDatabase,
  input: AuditEventInput,
): SqlStatement {
  validateInput(input);
  const createdAt = input.createdAt ?? Date.now();

  return database.prepare(`
    INSERT INTO audit_events (
      id,
      aggregate_type,
      aggregate_id,
      event_type,
      actor_type,
      actor_id,
      actor_roles_json,
      request_id,
      idempotency_key,
      previous_state_json,
      next_state_json,
      reason,
      metadata_json,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    input.id,
    input.aggregateType,
    input.aggregateId,
    input.eventType,
    input.actor.type,
    input.actor.id,
    canonicalJson([...input.actor.roles].sort()),
    input.requestId ?? null,
    input.idempotencyKey ?? null,
    input.previousState === undefined || input.previousState === null
      ? null
      : canonicalJson(input.previousState),
    canonicalJson(input.nextState),
    input.reason ?? null,
    canonicalJson(input.metadata ?? {}),
    createdAt,
  );
}

function validateInput(input: AuditEventInput): void {
  if (!safe(input.id, 200)
    || !safe(input.aggregateType, 100)
    || !safe(input.aggregateId, 200)
    || !safe(input.eventType, 100)
    || !safe(input.actor.type, 40)
    || (input.actor.id !== null && !safe(input.actor.id, 200))
    || input.actor.roles.some((role) => !safe(role, 100))
    || (input.requestId != null && !safe(input.requestId, 200))
    || (input.idempotencyKey != null
      && !safe(input.idempotencyKey, 128))
    || (input.reason != null && !safe(input.reason, 2000))
    || (input.createdAt !== undefined
      && (!Number.isSafeInteger(input.createdAt)
        || input.createdAt < 0))) {
    throw new Error('invalid_audit_event');
  }
}

function safe(value: string, maximum: number): boolean {
  return value.length >= 1
    && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/u.test(value);
}
