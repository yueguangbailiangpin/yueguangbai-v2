import type { SqlDatabase, SqlStatement } from '@ygb/contracts';
import { hashCanonicalJson } from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  markIdempotencyFailed,
} from '../foundation/idempotency';
import { createOutboxStatements, prepareOutboxEvent } from '../foundation/outbox';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import {
  requireAllocationBalance,
  requirePayableBalance,
  requirePaymentBalance,
} from './records';
import type { SellerSettlementCommandResult } from './record-payment';
import {
  authorizeSellerSettlement,
  cleanPositiveCnyFen,
  cleanSettlementIdentifier,
  cleanSettlementReason,
  cleanSettlementTimestamp,
  cleanSettlementVersion,
  normalizeSettlementError,
  SellerSettlementError,
} from './shared';

export async function allocateSellerPayment(
  database: SqlDatabase,
  input: {
    paymentId: string;
    payableId: string;
    amountCnyFen: string;
    expectedPaymentVersion: number;
  },
  command: commandInput,
): Promise<SellerSettlementCommandResult> {
  const paymentId = cleanSettlementIdentifier(input.paymentId);
  const payableId = cleanSettlementIdentifier(input.payableId);
  const amount = cleanPositiveCnyFen(input.amountCnyFen);
  const expectedVersion = cleanSettlementVersion(input.expectedPaymentVersion);
  const now = cleanSettlementTimestamp(command.now ?? Date.now());
  const initial = await requirePaymentBalance(database, paymentId);
  await authorizeSellerSettlement(
    database,
    command.actor,
    initial.seller_organization_id,
  );
  const requestHash = await hashCanonicalJson({
    action: 'ALLOCATE_SELLER_PAYMENT',
    payment_id: paymentId,
    payable_id: payableId,
    amount_cny_fen: String(amount),
    expected_payment_version: expectedVersion,
  });
  const acquired = await acquireIdempotency<SellerSettlementCommandResult>(
    database,
    {
      actorType: 'STAFF',
      actorId: command.actor.staffId,
      action: 'ALLOCATE_SELLER_PAYMENT',
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
    const payable = await requirePayableBalance(database, payableId);
    requireVersion(payment.version, expectedVersion);
    requireSameOrganization(
      payment.seller_organization_id,
      payable.seller_organization_id,
    );
    if (payment.derived_status === 'REVERSED'
      || amount > payment.unallocated_amount_cny_fen
      || amount > payable.outstanding_amount_cny_fen) {
      throw new SellerSettlementError('SELLER_SETTLEMENT_CONFLICT', 409);
    }
    const allocationId = crypto.randomUUID();
    const nextVersion = expectedVersion + 1;
    const response = { paymentId, replayed: false } as const;
    const outbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey: `seller-allocation:${allocationId}`,
      eventType: 'SELLER_PAYMENT_ALLOCATED',
      aggregateType: 'SELLER_PAYMENT',
      aggregateId: paymentId,
      payload: {
        seller_organization_id: payment.seller_organization_id,
        payment_id: paymentId,
        allocation_id: allocationId,
        payable_id: payableId,
        amount_cny_fen: String(amount),
      },
      createdAt: now,
    });
    await database.batch([
      bumpPayment(database, paymentId, expectedVersion, now),
      changedOnce(database),
      database.prepare(`
        INSERT INTO seller_payment_allocations (
          id, payment_id, payable_id, seller_organization_id,
          amount_cny_fen, allocated_by_staff_id, allocated_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        allocationId,
        paymentId,
        payableId,
        payment.seller_organization_id,
        amount,
        command.actor.staffId,
        now,
        now,
      ),
      audit(database, {
        id: crypto.randomUUID(),
        paymentId,
        eventType: 'SELLER_PAYMENT_ALLOCATED',
        actor: command.actor,
        requestId: command.requestId,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: {
          payment_version: expectedVersion,
          payment_available_cny_fen: String(payment.unallocated_amount_cny_fen),
          payable_outstanding_cny_fen: String(payable.outstanding_amount_cny_fen),
        },
        nextState: {
          allocation_id: allocationId,
          payable_id: payableId,
          amount_cny_fen: String(amount),
          payment_version: nextVersion,
        },
        now,
      }),
      ...createOutboxStatements(database, outbox),
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: {
          payment_id: paymentId,
          payable_id: payableId,
          allocation_id: allocationId,
        },
        now,
      }),
      database.prepare(`
        INSERT INTO transaction_assertions (assertion_value)
        SELECT CASE WHEN
          EXISTS (
            SELECT 1 FROM seller_payment_allocations allocation
            WHERE allocation.id=? AND allocation.payment_id=?
              AND allocation.payable_id=?
              AND allocation.seller_organization_id=?
              AND allocation.amount_cny_fen=?
          )
          AND EXISTS (
            SELECT 1 FROM seller_payments payment
            WHERE payment.id=? AND payment.version=?
          )
          AND (SELECT unallocated_amount_cny_fen
            FROM seller_payment_balances WHERE payment_id=?)>=0
          AND (SELECT outstanding_amount_cny_fen
            FROM seller_payable_balances WHERE payable_id=?)>=0
        THEN 1 ELSE 0 END
      `).bind(
        allocationId,
        paymentId,
        payableId,
        payment.seller_organization_id,
        amount,
        paymentId,
        nextVersion,
        paymentId,
        payableId,
      ),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ]);
    return response;
  } catch (error) {
    throw await fail(database, acquired.claim, error, now);
  }
}

export async function reverseSellerAllocation(
  database: SqlDatabase,
  input: {
    allocationId: string;
    amountCnyFen: string;
    reason: string;
    expectedPaymentVersion: number;
  },
  command: commandInput,
): Promise<SellerSettlementCommandResult> {
  const allocationId = cleanSettlementIdentifier(input.allocationId);
  const amount = cleanPositiveCnyFen(input.amountCnyFen);
  const reason = cleanSettlementReason(input.reason);
  const expectedVersion = cleanSettlementVersion(input.expectedPaymentVersion);
  const now = cleanSettlementTimestamp(command.now ?? Date.now());
  const initial = await requireAllocationBalance(database, allocationId);
  await authorizeSellerSettlement(
    database,
    command.actor,
    initial.seller_organization_id,
    { correction: true },
  );
  const requestHash = await hashCanonicalJson({
    action: 'REVERSE_SELLER_ALLOCATION',
    allocation_id: allocationId,
    amount_cny_fen: String(amount),
    reason,
    expected_payment_version: expectedVersion,
  });
  const acquired = await acquireIdempotency<SellerSettlementCommandResult>(
    database,
    {
      actorType: 'STAFF',
      actorId: command.actor.staffId,
      action: 'REVERSE_SELLER_ALLOCATION',
      targetType: 'SELLER_PAYMENT_ALLOCATION',
      targetId: allocationId,
      idempotencyKey: command.idempotencyKey,
      requestHash,
    },
    { now },
  );
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }
  try {
    const allocation = await requireAllocationBalance(database, allocationId);
    const payment = await requirePaymentBalance(database, allocation.payment_id);
    requireVersion(payment.version, expectedVersion);
    if (payment.derived_status === 'REVERSED'
      || amount > allocation.net_amount_cny_fen) {
      throw new SellerSettlementError('SELLER_SETTLEMENT_CONFLICT', 409);
    }
    const reversalId = crypto.randomUUID();
    const nextVersion = expectedVersion + 1;
    const response = { paymentId: payment.payment_id, replayed: false } as const;
    const outbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey: `seller-allocation-reversal:${reversalId}`,
      eventType: 'SELLER_ALLOCATION_REVERSED',
      aggregateType: 'SELLER_PAYMENT',
      aggregateId: payment.payment_id,
      payload: {
        seller_organization_id: payment.seller_organization_id,
        payment_id: payment.payment_id,
        allocation_id: allocationId,
        reversal_id: reversalId,
        amount_cny_fen: String(amount),
      },
      createdAt: now,
    });
    await database.batch([
      bumpPayment(database, payment.payment_id, expectedVersion, now),
      changedOnce(database),
      allocationReversal(database, {
        reversalId,
        allocation,
        amount,
        reason,
        actorStaffId: command.actor.staffId,
        idempotencyKey: acquired.claim.idempotencyKey,
        now,
      }),
      audit(database, {
        id: crypto.randomUUID(),
        paymentId: payment.payment_id,
        eventType: 'SELLER_ALLOCATION_REVERSED',
        actor: command.actor,
        requestId: command.requestId,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: {
          allocation_id: allocationId,
          allocation_net_cny_fen: String(allocation.net_amount_cny_fen),
          payment_version: expectedVersion,
        },
        nextState: {
          reversal_id: reversalId,
          reversed_amount_cny_fen: String(amount),
          payment_version: nextVersion,
        },
        reason,
        now,
      }),
      ...createOutboxStatements(database, outbox),
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: {
          payment_id: payment.payment_id,
          allocation_id: allocationId,
          reversal_id: reversalId,
        },
        now,
      }),
      database.prepare(`
        INSERT INTO transaction_assertions (assertion_value)
        SELECT CASE WHEN
          EXISTS (
            SELECT 1 FROM seller_payment_allocation_reversals reversal
            WHERE reversal.id=? AND reversal.allocation_id=?
              AND reversal.amount_cny_fen=?
          )
          AND EXISTS (
            SELECT 1 FROM seller_payments payment
            WHERE payment.id=? AND payment.version=?
          )
          AND (SELECT net_amount_cny_fen
            FROM seller_allocation_net_amounts WHERE allocation_id=?)>=0
        THEN 1 ELSE 0 END
      `).bind(
        reversalId,
        allocationId,
        amount,
        payment.payment_id,
        nextVersion,
        allocationId,
      ),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ]);
    return response;
  } catch (error) {
    throw await fail(database, acquired.claim, error, now);
  }
}

export async function reallocateSellerAllocation(
  database: SqlDatabase,
  input: {
    allocationId: string;
    targetPayableId: string;
    amountCnyFen: string;
    reason: string;
    expectedPaymentVersion: number;
  },
  command: commandInput,
): Promise<SellerSettlementCommandResult> {
  const allocationId = cleanSettlementIdentifier(input.allocationId);
  const targetPayableId = cleanSettlementIdentifier(input.targetPayableId);
  const amount = cleanPositiveCnyFen(input.amountCnyFen);
  const reason = cleanSettlementReason(input.reason);
  const expectedVersion = cleanSettlementVersion(input.expectedPaymentVersion);
  const now = cleanSettlementTimestamp(command.now ?? Date.now());
  const initial = await requireAllocationBalance(database, allocationId);
  await authorizeSellerSettlement(
    database,
    command.actor,
    initial.seller_organization_id,
    { correction: true },
  );
  if (targetPayableId === initial.payable_id) {
    throw new SellerSettlementError('VALIDATION_ERROR', 400);
  }
  const requestHash = await hashCanonicalJson({
    action: 'REALLOCATE_SELLER_ALLOCATION',
    allocation_id: allocationId,
    target_payable_id: targetPayableId,
    amount_cny_fen: String(amount),
    reason,
    expected_payment_version: expectedVersion,
  });
  const acquired = await acquireIdempotency<SellerSettlementCommandResult>(
    database,
    {
      actorType: 'STAFF',
      actorId: command.actor.staffId,
      action: 'REALLOCATE_SELLER_ALLOCATION',
      targetType: 'SELLER_PAYMENT_ALLOCATION',
      targetId: allocationId,
      idempotencyKey: command.idempotencyKey,
      requestHash,
    },
    { now },
  );
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }
  try {
    const allocation = await requireAllocationBalance(database, allocationId);
    const payment = await requirePaymentBalance(database, allocation.payment_id);
    const target = await requirePayableBalance(database, targetPayableId);
    requireVersion(payment.version, expectedVersion);
    requireSameOrganization(
      payment.seller_organization_id,
      target.seller_organization_id,
    );
    if (payment.derived_status === 'REVERSED'
      || amount > allocation.net_amount_cny_fen
      || amount > target.outstanding_amount_cny_fen) {
      throw new SellerSettlementError('SELLER_SETTLEMENT_CONFLICT', 409);
    }
    const reversalId = crypto.randomUUID();
    const newAllocationId = crypto.randomUUID();
    const nextVersion = expectedVersion + 1;
    const response = { paymentId: payment.payment_id, replayed: false } as const;
    const outbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey: `seller-reallocation:${reversalId}`,
      eventType: 'SELLER_ALLOCATION_REALLOCATED',
      aggregateType: 'SELLER_PAYMENT',
      aggregateId: payment.payment_id,
      payload: {
        seller_organization_id: payment.seller_organization_id,
        payment_id: payment.payment_id,
        source_allocation_id: allocationId,
        source_payable_id: allocation.payable_id,
        target_allocation_id: newAllocationId,
        target_payable_id: targetPayableId,
        amount_cny_fen: String(amount),
      },
      createdAt: now,
    });
    await database.batch([
      bumpPayment(database, payment.payment_id, expectedVersion, now),
      changedOnce(database),
      allocationReversal(database, {
        reversalId,
        allocation,
        amount,
        reason,
        actorStaffId: command.actor.staffId,
        idempotencyKey: acquired.claim.idempotencyKey,
        now,
      }),
      database.prepare(`
        INSERT INTO seller_payment_allocations (
          id, payment_id, payable_id, seller_organization_id,
          amount_cny_fen, allocated_by_staff_id, allocated_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        newAllocationId,
        payment.payment_id,
        targetPayableId,
        payment.seller_organization_id,
        amount,
        command.actor.staffId,
        now,
        now,
      ),
      audit(database, {
        id: crypto.randomUUID(),
        paymentId: payment.payment_id,
        eventType: 'SELLER_ALLOCATION_REALLOCATED',
        actor: command.actor,
        requestId: command.requestId,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: {
          source_allocation_id: allocationId,
          source_payable_id: allocation.payable_id,
          source_net_cny_fen: String(allocation.net_amount_cny_fen),
          payment_version: expectedVersion,
        },
        nextState: {
          reversal_id: reversalId,
          target_allocation_id: newAllocationId,
          target_payable_id: targetPayableId,
          amount_cny_fen: String(amount),
          payment_version: nextVersion,
        },
        reason,
        now,
      }),
      ...createOutboxStatements(database, outbox),
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: {
          payment_id: payment.payment_id,
          source_allocation_id: allocationId,
          reversal_id: reversalId,
          target_allocation_id: newAllocationId,
          target_payable_id: targetPayableId,
        },
        now,
      }),
      database.prepare(`
        INSERT INTO transaction_assertions (assertion_value)
        SELECT CASE WHEN
          EXISTS (
            SELECT 1 FROM seller_payment_allocation_reversals
            WHERE id=? AND allocation_id=? AND amount_cny_fen=?
          )
          AND EXISTS (
            SELECT 1 FROM seller_payment_allocations
            WHERE id=? AND payment_id=? AND payable_id=?
              AND amount_cny_fen=?
          )
          AND EXISTS (
            SELECT 1 FROM seller_payments
            WHERE id=? AND version=?
          )
          AND (SELECT outstanding_amount_cny_fen
            FROM seller_payable_balances WHERE payable_id=?)>=0
        THEN 1 ELSE 0 END
      `).bind(
        reversalId,
        allocationId,
        amount,
        newAllocationId,
        payment.payment_id,
        targetPayableId,
        amount,
        payment.payment_id,
        nextVersion,
        targetPayableId,
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

function bumpPayment(
  database: SqlDatabase,
  paymentId: string,
  expectedVersion: number,
  now: number,
): SqlStatement {
  return database.prepare(`
    UPDATE seller_payments
    SET version=version+1, updated_at=MAX(?, updated_at+1)
    WHERE id=? AND version=?
  `).bind(now, paymentId, expectedVersion);
}

function changedOnce(database: SqlDatabase): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END
  `);
}

function allocationReversal(
  database: SqlDatabase,
  input: {
    reversalId: string;
    allocation: Awaited<ReturnType<typeof requireAllocationBalance>>;
    amount: number;
    reason: string;
    actorStaffId: string;
    idempotencyKey: string;
    now: number;
  },
): SqlStatement {
  return database.prepare(`
    INSERT INTO seller_payment_allocation_reversals (
      id, allocation_id, payment_id, payable_id, seller_organization_id,
      amount_cny_fen, reason, reversed_by_staff_id, reversed_at,
      idempotency_key, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    input.reversalId,
    input.allocation.allocation_id,
    input.allocation.payment_id,
    input.allocation.payable_id,
    input.allocation.seller_organization_id,
    input.amount,
    input.reason,
    input.actorStaffId,
    input.now,
    input.idempotencyKey,
    input.now,
  );
}

function audit(
  database: SqlDatabase,
  input: {
    id: string;
    paymentId: string;
    eventType: string;
    actor: AssignmentStaffAuthorization;
    requestId?: string | null;
    idempotencyKey: string;
    previousState: unknown;
    nextState: unknown;
    reason?: string;
    now: number;
  },
): SqlStatement {
  return createAuditEventStatement(database, {
    id: input.id,
    aggregateType: 'SELLER_PAYMENT',
    aggregateId: input.paymentId,
    eventType: input.eventType,
    actor: {
      type: 'STAFF',
      id: input.actor.staffId,
      roles: [...input.actor.roles],
    },
    requestId: input.requestId ?? null,
    idempotencyKey: input.idempotencyKey,
    previousState: input.previousState,
    nextState: input.nextState,
    reason: input.reason ?? null,
    createdAt: input.now,
  });
}

function requireVersion(actual: number, expected: number): void {
  if (actual !== expected) {
    throw new SellerSettlementError('VERSION_CONFLICT', 409);
  }
}

function requireSameOrganization(left: string, right: string): void {
  if (left !== right) {
    throw new SellerSettlementError('NOT_FOUND', 404);
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