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
  createOutboxStatements,
  prepareOutboxEvent,
} from '../foundation/outbox';
import {
  cleanRequiredReason,
  assertPreviousStatementChangedOnce,
  insertInstructionEventStatement,
  normalizeOrderInstructionError,
  OrderInstructionError,
  requireInstructionBuyerScope,
  requireInstructionPermission,
  validateExpectedVersion,
  validateTimestamp,
  type OrderInstructionStaffActor,
} from './shared';
import { requireInstructionContext } from './records';
import { revokeInstructionFilesStatements } from './expiry';
import { releaseProvisionalOrderNumberClaimStatement } from './order-number-claim-release';

export async function cancelOrderInstruction(
  database: SqlDatabase,
  input: {
    instructionId: string;
    expectedVersion: number;
    reason: string;
  },
  command: {
    actor: OrderInstructionStaffActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<{
  instruction_id: string;
  reservation_id: string;
  status: 'CANCELLED';
  released_capacity: true;
  replayed: boolean;
}> {
  const expectedVersion = validateExpectedVersion(input.expectedVersion);
  const reason = cleanRequiredReason(input.reason);
  const now = validateTimestamp(command.now ?? Date.now());
  const requestHash = await hashCanonicalJson({
    action: 'CANCEL_ORDER_INSTRUCTION',
    instruction_id: input.instructionId,
    expected_version: expectedVersion,
    reason,
  });
  const acquired = await acquireIdempotency<any>(database, {
    actorType: 'STAFF', actorId: command.actor.staffId,
    action: 'CANCEL_ORDER_INSTRUCTION',
    targetType: 'ORDER_INSTRUCTION', targetId: input.instructionId,
    idempotencyKey: command.idempotencyKey, requestHash,
  }, { now });
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }
  try {
    const source = await requireInstructionContext(database, input.instructionId);
    const requiredPermission = source.evidence_version_count > 0
      ? 'ORDER_INSTRUCTION_MANAGE'
      : 'ORDER_INSTRUCTION_PUBLISH';
    requireInstructionPermission(command.actor, requiredPermission);
    await requireInstructionBuyerScope(
      database,
      command.actor,
      source.buyer_customer_id,
      requiredPermission,
    );
    if (source.instruction_version !== expectedVersion) {
      throw new OrderInstructionError('VERSION_CONFLICT', 409);
    }
    if (source.formal_order_id !== null) {
      throw new OrderInstructionError('FORMAL_ORDER_ALREADY_EXISTS', 409);
    }
    if (source.instruction_status !== 'ACTIVE'
      && source.instruction_status !== 'UNPUBLISHED') {
      throw new OrderInstructionError('INSTRUCTION_TERMINAL', 409);
    }
    const response = {
      instruction_id: source.instruction_id,
      reservation_id: source.reservation_id,
      status: 'CANCELLED' as const,
      released_capacity: true as const,
      replayed: false,
    };
    const nextVersion = source.instruction_version + 1;
    const outbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey: `order-instruction-cancelled:${source.instruction_id}`,
      eventType: 'ORDER_INSTRUCTION_CANCELLED',
      aggregateType: 'ORDER_INSTRUCTION',
      aggregateId: source.instruction_id,
      payload: { ...response, reason },
      createdAt: now,
    });
    const statements: SqlStatement[] = [
      database.prepare(`
        UPDATE order_instructions
        SET status='CANCELLED', version=version+1,
            cancelled_at=?, updated_at=MAX(?, updated_at+1)
        WHERE id=? AND version=? AND status IN ('UNPUBLISHED','ACTIVE')
      `).bind(now, now, source.instruction_id, expectedVersion),
      assertPreviousStatementChangedOnce(database),
      database.prepare(`
        UPDATE product_reservations
        SET status='CANCELLED', version=version+1,
            updated_at=MAX(?, updated_at+1), cancelled_at=?, expired_at=NULL
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
      `).bind(now, now, source.instruction_id, source.evidence_submission_id),
      insertInstructionEventStatement(database, {
        instructionId: source.instruction_id,
        reservationId: source.reservation_id,
        eventType: 'INSTRUCTION_CANCELLED',
        actorType: 'STAFF',
        actorId: command.actor.staffId,
        previousStatus: source.instruction_status,
        nextStatus: 'CANCELLED',
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
        eventType: 'ORDER_INSTRUCTION_CANCELLED',
        actor: { type: 'STAFF', id: command.actor.staffId, roles: [...command.actor.roles] },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: {
          status: source.instruction_status,
          version: source.instruction_version,
        },
        nextState: { ...response, reason },
        createdAt: now,
      }),
      ...createOutboxStatements(database, outbox),
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
            WHERE id=? AND status='CANCELLED' AND version=?)
          AND EXISTS (SELECT 1 FROM product_reservations
            WHERE id=? AND status='CANCELLED')
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
    await markIdempotencyFailed(database, acquired.claim, normalized.code, now)
      .catch(() => false);
    throw normalized;
  }
}
