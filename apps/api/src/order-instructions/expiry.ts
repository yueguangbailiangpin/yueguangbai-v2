import type { SqlDatabase, SqlStatement } from '@ygb/contracts';
import { hashCanonicalJson } from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  markIdempotencyFailed,
} from '../foundation/idempotency';
import {
  assertPreviousStatementChangedOnce,
  insertInstructionEventStatement,
  normalizeOrderInstructionError,
  OrderInstructionError,
  validateTimestamp,
} from './shared';
import {
  requireInstructionContext,
  type InstructionContextRow,
} from './records';
import { releaseProvisionalOrderNumberClaimStatement } from './order-number-claim-release';

export interface ExpireOrderInstructionResult {
  instruction_id: string;
  reservation_id: string;
  status: 'EXPIRED' | 'UNCHANGED';
  released_capacity: boolean;
  reason: 'INITIAL_DEADLINE_EXPIRED' | 'RESUBMISSION_DEADLINE_EXPIRED' | null;
  replayed: boolean;
}

export async function expireInstructionIfDue(
  database: SqlDatabase,
  instructionId: string,
  command: {
    actorType: 'STAFF' | 'SYSTEM';
    actorId: string;
    now: number;
  },
): Promise<InstructionContextRow> {
  const source = await requireInstructionContext(database, instructionId);
  const due = expiryReason(source, command.now);
  if (due === null) return source;
  await expireOrderInstruction(database, {
    instructionId,
    expectedVersion: source.instruction_version,
  }, {
    actorType: command.actorType,
    actorId: command.actorId,
    idempotencyKey:
      `expire:${instructionId}:${due}:${deadlineFor(source, due)}`,
    now: command.now,
  });
  return requireInstructionContext(database, instructionId);
}

export async function expireOrderInstruction(
  database: SqlDatabase,
  input: { instructionId: string; expectedVersion: number },
  command: {
    actorType: 'STAFF' | 'SYSTEM';
    actorId: string;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<ExpireOrderInstructionResult> {
  const now = validateTimestamp(command.now ?? Date.now());
  const requestHash = await hashCanonicalJson({
    action: 'EXPIRE_ORDER_INSTRUCTION',
    instruction_id: input.instructionId,
    expected_version: input.expectedVersion,
  });
  const acquired = await acquireIdempotency<ExpireOrderInstructionResult>(
    database,
    {
      actorType: command.actorType,
      actorId: command.actorId,
      action: 'EXPIRE_ORDER_INSTRUCTION',
      targetType: 'ORDER_INSTRUCTION',
      targetId: input.instructionId,
      idempotencyKey: command.idempotencyKey,
      requestHash,
    },
    { now },
  );
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }
  try {
    const source = await requireInstructionContext(database, input.instructionId);
    if (source.instruction_status !== 'ACTIVE') {
      const response: ExpireOrderInstructionResult = {
        instruction_id: source.instruction_id,
        reservation_id: source.reservation_id,
        status: 'UNCHANGED',
        released_capacity: false,
        reason: null,
        replayed: false,
      };
      await database.batch([
        completeIdempotencyStatement(database, acquired.claim, response, {
          resultReferences: { instruction_id: source.instruction_id },
          now,
        }),
        assertIdempotencyCompletionStatement(database, acquired.claim),
      ]);
      return response;
    }
    if (source.instruction_version !== input.expectedVersion) {
      throw new OrderInstructionError('VERSION_CONFLICT', 409);
    }
    const reason = expiryReason(source, now);
    if (reason === null) {
      const response: ExpireOrderInstructionResult = {
        instruction_id: source.instruction_id,
        reservation_id: source.reservation_id,
        status: 'UNCHANGED',
        released_capacity: false,
        reason: null,
        replayed: false,
      };
      await database.batch([
        completeIdempotencyStatement(database, acquired.claim, response, {
          resultReferences: { instruction_id: source.instruction_id },
          now,
        }),
        assertIdempotencyCompletionStatement(database, acquired.claim),
      ]);
      return response;
    }
    if (source.formal_order_id !== null) {
      throw new OrderInstructionError('FORMAL_ORDER_ALREADY_EXISTS', 409);
    }
    const response: ExpireOrderInstructionResult = {
      instruction_id: source.instruction_id,
      reservation_id: source.reservation_id,
      status: 'EXPIRED',
      released_capacity: true,
      reason,
      replayed: false,
    };
    const nextVersion = source.instruction_version + 1;
    const statements: SqlStatement[] = [
      database.prepare(`
        UPDATE order_instructions
        SET status='EXPIRED', version=version+1,
            expired_at=?, updated_at=MAX(?, updated_at+1)
        WHERE id=? AND status='ACTIVE' AND version=?
          AND NOT EXISTS (
            SELECT 1 FROM formal_orders WHERE reservation_id=?
          )
      `).bind(
        now,
        now,
        source.instruction_id,
        source.instruction_version,
        source.reservation_id,
      ),
      assertPreviousStatementChangedOnce(database),
      database.prepare(`
        UPDATE product_reservations
        SET status='EXPIRED', version=version+1,
            updated_at=MAX(?, updated_at+1), expired_at=?, cancelled_at=NULL
        WHERE id=? AND status='APPROVED'
      `).bind(now, now, source.reservation_id),
      assertPreviousStatementChangedOnce(database),
      database.prepare(`
        UPDATE demand_batches
        SET approved_reservation_count=approved_reservation_count-1,
            version=version+1, updated_at=MAX(?, updated_at+1)
        WHERE id=? AND approved_reservation_count>=1
      `).bind(now, source.demand_batch_id),
      assertPreviousStatementChangedOnce(database),
      releaseProvisionalOrderNumberClaimStatement(
        database,
        source.evidence_submission_id,
        now,
      ),
      ...revokeInstructionFilesStatements(database, source.instruction_id, now),
      database.prepare(`
        UPDATE staff_work_items
        SET status='CANCELLED', version=version+1,
            updated_at=MAX(?, updated_at+1), cancelled_at=?
        WHERE status='OPEN' AND (
          (source_entity_type='ORDER_INSTRUCTION' AND source_entity_id=?)
          OR (source_entity_type='ORDER_EVIDENCE'
              AND source_entity_id=COALESCE(?, ''))
        )
      `).bind(
        now,
        now,
        source.instruction_id,
        source.evidence_submission_id,
      ),
      insertInstructionEventStatement(database, {
        instructionId: source.instruction_id,
        reservationId: source.reservation_id,
        eventType: 'INSTRUCTION_EXPIRED',
        actorType: command.actorType,
        actorId: command.actorId,
        previousStatus: 'ACTIVE',
        nextStatus: 'EXPIRED',
        instructionVersion: nextVersion,
        reason,
        metadata: { released_capacity: true },
        idempotencyKey: acquired.claim.idempotencyKey,
        createdAt: now,
      }),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'ORDER_INSTRUCTION',
        aggregateId: source.instruction_id,
        eventType: 'ORDER_INSTRUCTION_EXPIRED',
        actor: { type: command.actorType, id: command.actorId, roles: [] },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: {
          status: 'ACTIVE',
          version: source.instruction_version,
          reservation_status: source.reservation_status,
        },
        nextState: response,
        createdAt: now,
      }),
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: {
          instruction_id: source.instruction_id,
          reservation_id: source.reservation_id,
        },
        now,
      }),
      database.prepare(`
        INSERT INTO transaction_assertions (assertion_value)
        SELECT CASE WHEN
          EXISTS (SELECT 1 FROM order_instructions
            WHERE id=? AND status='EXPIRED' AND version=?)
          AND EXISTS (SELECT 1 FROM product_reservations
            WHERE id=? AND status='EXPIRED')
          AND (SELECT approved_reservation_count FROM demand_batches
            WHERE id=?)=?
          AND NOT EXISTS (
            SELECT 1 FROM formal_order_number_claims
            WHERE evidence_submission_id=COALESCE(?, '')
              AND status='PROVISIONAL'
          )
        THEN 1 ELSE 0 END
      `).bind(
        source.instruction_id,
        nextVersion,
        source.reservation_id,
        source.demand_batch_id,
        Number(source.approved_reservation_count) - 1,
        source.evidence_submission_id,
      ),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ];
    await database.batch(statements);
    return response;
  } catch (error) {
    const normalized = normalizeOrderInstructionError(error);
    await markIdempotencyFailed(
      database,
      acquired.claim,
      normalized.code,
      now,
    ).catch(() => false);
    throw normalized;
  }
}

function expiryReason(
  source: InstructionContextRow,
  now: number,
): ExpireOrderInstructionResult['reason'] {
  if (source.instruction_status !== 'ACTIVE'
    || source.formal_order_id !== null) return null;
  if (source.evidence_status === null
    && source.evidence_version_count === 0
    && source.initial_deadline_at !== null
    && now >= source.initial_deadline_at) {
    return 'INITIAL_DEADLINE_EXPIRED';
  }
  if (source.evidence_status === 'CHANGES_REQUESTED'
    && source.resubmission_deadline_at !== null
    && now >= source.resubmission_deadline_at) {
    return 'RESUBMISSION_DEADLINE_EXPIRED';
  }
  return null;
}

function deadlineFor(
  source: InstructionContextRow,
  reason: NonNullable<ExpireOrderInstructionResult['reason']>,
): number {
  return reason === 'INITIAL_DEADLINE_EXPIRED'
    ? source.initial_deadline_at ?? 0
    : source.resubmission_deadline_at ?? 0;
}

export function revokeInstructionFilesStatements(
  database: SqlDatabase,
  instructionId: string,
  now: number,
): readonly SqlStatement[] {
  return [
    database.prepare(`
      UPDATE file_entity_audience_grants
      SET revoked_at=?
      WHERE revoked_at IS NULL AND file_entity_link_id IN (
        SELECT link.id
        FROM file_entity_links link
        JOIN order_instruction_versions version
          ON version.id=link.entity_id
          AND link.entity_type='ORDER_INSTRUCTION_VERSION'
        WHERE version.instruction_id=?
      )
    `).bind(now, instructionId),
    database.prepare(`
      UPDATE file_entity_links
      SET revoked_at=?
      WHERE revoked_at IS NULL AND entity_type='ORDER_INSTRUCTION_VERSION'
        AND entity_id IN (
          SELECT id FROM order_instruction_versions WHERE instruction_id=?
        )
    `).bind(now, instructionId),
    database.prepare(`
      UPDATE file_read_intents
      SET status='REVOKED', revoked_at=?, updated_at=MAX(?, updated_at+1)
      WHERE status='ISSUED' AND file_entity_link_id IN (
        SELECT link.id
        FROM file_entity_links link
        JOIN order_instruction_versions version
          ON version.id=link.entity_id
        WHERE version.instruction_id=?
      )
    `).bind(now, now, instructionId),
  ];
}
