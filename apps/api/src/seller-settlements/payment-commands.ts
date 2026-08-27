import type { SqlDatabase, SqlStatement } from '@ygb/contracts';
import { canonicalJson, hashCanonicalJson } from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  markIdempotencyFailed,
} from '../foundation/idempotency';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import {
  listActiveAllocationsForPayment,
  requirePaymentBalance,
} from './records';
import type { SellerSettlementCommandResult } from './record-payment';
import {
  authorizeSellerSettlement,
  cleanSettlementIdentifier,
  cleanSettlementReason,
  cleanSettlementTimestamp,
  cleanSettlementVersion,
  normalizeSettlementError,
  SellerSettlementError,
} from './shared';

export async function correctSellerPaymentPaidAt(
  database: SqlDatabase,
  input: {
    paymentId: string;
    expectedVersion: number;
    paidAt: number;
    reason: string;
  },
  command: commandInput,
): Promise<SellerSettlementCommandResult> {
  const paymentId = cleanSettlementIdentifier(input.paymentId);
  const expectedVersion = cleanSettlementVersion(input.expectedVersion);
  const paidAt = cleanSettlementTimestamp(input.paidAt);
  const reason = cleanSettlementReason(input.reason);
  const now = cleanSettlementTimestamp(command.now ?? Date.now());
  if (paidAt > now) throw new SellerSettlementError('VALIDATION_ERROR', 400);
  const initial = await requirePaymentBalance(database, paymentId);
  await authorizeSellerSettlement(
    database,
    command.actor,
    initial.seller_organization_id,
    { correction: true },
  );
  const requestHash = await hashCanonicalJson({
    action: 'CORRECT_SELLER_PAYMENT_PAID_AT',
    payment_id: paymentId,
    expected_version: expectedVersion,
    paid_at: paidAt,
    reason,
  });
  const acquired = await acquireIdempotency<SellerSettlementCommandResult>(
    database,
    {
      actorType: 'STAFF',
      actorId: command.actor.staffId,
      action: 'CORRECT_SELLER_PAYMENT_PAID_AT',
      targetType: 'SELLER_PAYMENT',
      targetId: paymentId,
      idempotencyKey: command.idempotencyKey,
      requestHash,
    },
    { now },
  );
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }
  try {
    const payment = await requirePaymentBalance(database, paymentId);
    requireVersion(payment.version, expectedVersion);
    if (payment.derived_status === 'REVERSED' || payment.paid_at === paidAt) {
      throw new SellerSettlementError('SELLER_SETTLEMENT_CONFLICT', 409);
    }
    const nextVersion = expectedVersion + 1;
    const response = { paymentId, replayed: false } as const;
    const eventId = crypto.randomUUID();
    await database.batch([
      database.prepare(`
        UPDATE seller_payments
        SET paid_at=?, version=version+1, updated_at=MAX(?, updated_at+1)
        WHERE id=? AND version=?
      `).bind(paidAt, now, paymentId, expectedVersion),
      changedOnce(database),
      database.prepare(`
        INSERT INTO seller_payment_events (
          id, payment_id, event_type, actor_staff_id,
          payment_version, amount_cny_fen, previous_paid_at,
          next_paid_at, reason, metadata_json,
          idempotency_key, created_at
        ) VALUES (
          ?, ?, 'PAYMENT_PAID_AT_CORRECTED', ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
      `).bind(
        eventId,
        paymentId,
        command.actor.staffId,
        nextVersion,
        payment.amount_cny_fen,
        payment.paid_at,
        paidAt,
        reason,
        canonicalJson({ corrected_at: now }),
        acquired.claim.idempotencyKey,
        now,
      ),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'SELLER_PAYMENT',
        aggregateId: paymentId,
        eventType: 'SELLER_PAYMENT_PAID_AT_CORRECTED',
        actor: staffActor(command.actor),
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: {
          paid_at: payment.paid_at,
          version: expectedVersion,
        },
        nextState: {
          paid_at: paidAt,
          version: nextVersion,
        },
        reason,
        createdAt: now,
      }),
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: { payment_id: paymentId, payment_event_id: eventId },
        now,
      }),
      database.prepare(`
        INSERT INTO transaction_assertions (assertion_value)
        SELECT CASE WHEN
          EXISTS (
            SELECT 1 FROM seller_payments payment
            WHERE payment.id=? AND payment.paid_at=?
              AND payment.version=? AND payment.amount_cny_fen=?
              AND payment.recorded_at=?
          )
          AND EXISTS (
            SELECT 1 FROM seller_payment_events event
            WHERE event.id=? AND event.payment_id=?
              AND event.event_type='PAYMENT_PAID_AT_CORRECTED'
              AND event.previous_paid_at=? AND event.next_paid_at=?
              AND event.payment_version=?
          )
        THEN 1 ELSE 0 END
      `).bind(
        paymentId,
        paidAt,
        nextVersion,
        payment.amount_cny_fen,
        payment.recorded_at,
        eventId,
        paymentId,
        payment.paid_at,
        paidAt,
        nextVersion,
      ),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ]);
    return response;
  } catch (error) {
    throw await fail(database, acquired.claim, error, now);
  }
}

export async function reverseSellerPayment(
  database: SqlDatabase,
  input: {
    paymentId: string;
    expectedVersion: number;
    reason: string;
  },
  command: commandInput,
): Promise<SellerSettlementCommandResult> {
  const paymentId = cleanSettlementIdentifier(input.paymentId);
  const expectedVersion = cleanSettlementVersion(input.expectedVersion);
  const reason = cleanSettlementReason(input.reason);
  const now = cleanSettlementTimestamp(command.now ?? Date.now());
  const initial = await requirePaymentBalance(database, paymentId);
  await authorizeSellerSettlement(
    database,
    command.actor,
    initial.seller_organization_id,
    { correction: true },
  );
  const requestHash = await hashCanonicalJson({
    action: 'REVERSE_SELLER_PAYMENT',
    payment_id: paymentId,
    expected_version: expectedVersion,
    reason,
  });
  const acquired = await acquireIdempotency<SellerSettlementCommandResult>(
    database,
    {
      actorType: 'STAFF',
      actorId: command.actor.staffId,
      action: 'REVERSE_SELLER_PAYMENT',
      targetType: 'SELLER_PAYMENT',
      targetId: paymentId,
      idempotencyKey: command.idempotencyKey,
      requestHash,
    },
    { now },
  );
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }
  try {
    const payment = await requirePaymentBalance(database, paymentId);
    requireVersion(payment.version, expectedVersion);
    if (payment.derived_status === 'REVERSED') {
      throw new SellerSettlementError('SELLER_SETTLEMENT_CONFLICT', 409);
    }
    const allocations = await listActiveAllocationsForPayment(database, paymentId);
    const reversalId = crypto.randomUUID();
    const eventId = crypto.randomUUID();
    const nextVersion = expectedVersion + 1;
    const response = { paymentId, replayed: false } as const;
    const allocationReversals: SqlStatement[] = allocations.map(
      (allocation) => {
        const allocationReversalId = crypto.randomUUID();
        return database.prepare(`
          INSERT INTO seller_payment_allocation_reversals (
            id, allocation_id, payment_id, payable_id,
            seller_organization_id, amount_cny_fen, reason,
            reversed_by_staff_id, reversed_at, idempotency_key, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          allocationReversalId,
          allocation.allocation_id,
          paymentId,
          allocation.payable_id,
          payment.seller_organization_id,
          allocation.net_amount_cny_fen,
          reason,
          command.actor.staffId,
          now,
          allocationReversalId,
          now,
        );
      },
    );
    await database.batch([
      database.prepare(`
        UPDATE seller_payments
        SET version=version+1, updated_at=MAX(?, updated_at+1)
        WHERE id=? AND version=?
      `).bind(now, paymentId, expectedVersion),
      changedOnce(database),
      ...allocationReversals,
      database.prepare(`
        INSERT INTO seller_payment_reversals (
          id, payment_id, seller_organization_id, amount_cny_fen,
          reason, reversed_by_staff_id, reversed_at,
          idempotency_key, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        reversalId,
        paymentId,
        payment.seller_organization_id,
        payment.amount_cny_fen,
        reason,
        command.actor.staffId,
        now,
        acquired.claim.idempotencyKey,
        now,
      ),
      database.prepare(`
        INSERT INTO seller_payment_events (
          id, payment_id, event_type, actor_staff_id,
          payment_version, amount_cny_fen, previous_paid_at,
          next_paid_at, reason, metadata_json,
          idempotency_key, created_at
        ) VALUES (
          ?, ?, 'PAYMENT_REVERSED', ?, ?, ?, NULL, NULL, ?, ?, ?, ?
        )
      `).bind(
        eventId,
        paymentId,
        command.actor.staffId,
        nextVersion,
        payment.amount_cny_fen,
        reason,
        canonicalJson({ reversed_allocation_count: allocations.length }),
        acquired.claim.idempotencyKey,
        now,
      ),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'SELLER_PAYMENT',
        aggregateId: paymentId,
        eventType: 'SELLER_PAYMENT_REVERSED',
        actor: staffActor(command.actor),
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: {
          amount_cny_fen: String(payment.amount_cny_fen),
          allocated_amount_cny_fen: String(payment.allocated_amount_cny_fen),
          version: expectedVersion,
        },
        nextState: {
          reversal_id: reversalId,
          amount_cny_fen: String(payment.amount_cny_fen),
          reversed_allocation_count: allocations.length,
          version: nextVersion,
        },
        reason,
        createdAt: now,
      }),
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: {
          payment_id: paymentId,
          payment_reversal_id: reversalId,
          payment_event_id: eventId,
        },
        now,
      }),
      database.prepare(`
        INSERT INTO transaction_assertions (assertion_value)
        SELECT CASE WHEN
          EXISTS (
            SELECT 1 FROM seller_payment_reversals reversal
            WHERE reversal.id=? AND reversal.payment_id=?
              AND reversal.amount_cny_fen=?
          )
          AND EXISTS (
            SELECT 1 FROM seller_payment_events event
            WHERE event.id=? AND event.payment_id=?
              AND event.event_type='PAYMENT_REVERSED'
              AND event.payment_version=?
          )
          AND NOT EXISTS (
            SELECT 1 FROM seller_allocation_net_amounts allocation
            WHERE allocation.payment_id=? AND allocation.net_amount_cny_fen>0
          )
          AND EXISTS (
            SELECT 1 FROM seller_payment_balances balance
            WHERE balance.payment_id=?
              AND balance.derived_status='REVERSED'
              AND balance.allocated_amount_cny_fen=0
              AND balance.unallocated_amount_cny_fen=0
          )
        THEN 1 ELSE 0 END
      `).bind(
        reversalId,
        paymentId,
        payment.amount_cny_fen,
        eventId,
        paymentId,
        nextVersion,
        paymentId,
        paymentId,
      ),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ]);
    return response;
  } catch (error) {
    throw await fail(database, acquired.claim, error, now);
  }
}

type commandInput = {
  actor: AssignmentStaffAuthorization;
  idempotencyKey: string;
  requestId?: string | null;
  now?: number;
};

function changedOnce(database: SqlDatabase): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END
  `);
}

function staffActor(actor: AssignmentStaffAuthorization) {
  return {
    type: 'STAFF',
    id: actor.staffId,
    roles: [...actor.roles],
  } as const;
}

function requireVersion(actual: number, expected: number): void {
  if (actual !== expected) {
    throw new SellerSettlementError('VERSION_CONFLICT', 409);
  }
}

async function fail(
  database: SqlDatabase,
  claim: Parameters<typeof markIdempotencyFailed>[1],
  error: unknown,
  now: number,
): Promise<SellerSettlementError> {
  const normalized = normalizeSettlementError(error);
  await markIdempotencyFailed(database, claim, normalized.code, now).catch(() => false);
  return normalized;
}