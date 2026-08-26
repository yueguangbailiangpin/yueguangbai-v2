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
  cleanReservationIdentifier,
  normalizeReservationError,
  requireReservationDecisionPermission,
  ReservationError,
  type ReservationStaffActor,
} from './reservation-shared';

export interface CreateParticipationExceptionResult {
  exception_id: string;
  buyer_customer_id: string;
  seller_organization_id: string;
  demand_batch_id: string;
  valid_until: number;
  used: false;
  replayed: boolean;
}

interface DemandRow {
  organization_id: string;
  buyer_exists: number;
  buyer_status: string | null;
}

/**
 * D-056 §5 one-time manual exception: pre-sales or owner may let a buyer who
 * already participated in a seller organization reserve once more for one
 * specific demand batch. The exception binds buyer + organization + batch,
 * requires a reason, expires, is consumed at reservation submit inside the
 * same D1 transaction, and can never be updated or deleted once used.
 */
export async function createReservationParticipationException(
  database: SqlDatabase,
  input: {
    buyerCustomerId: string;
    demandBatchId: string;
    reason: string;
    validUntil: number;
  },
  command: {
    actor: ReservationStaffActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<CreateParticipationExceptionResult> {
  requireReservationDecisionPermission(command.actor);
  if (!command.actor.roles.some(
    (role) => role === 'owner' || role === 'pre_sales',
  )) {
    throw new ReservationError('FORBIDDEN', 403);
  }

  const buyerCustomerId = cleanReservationIdentifier(input.buyerCustomerId);
  const demandBatchId = cleanReservationIdentifier(input.demandBatchId);
  const reason = input.reason.normalize('NFKC').trim();
  if (reason.length < 1 || reason.length > 1000) {
    throw new ReservationError('VALIDATION_ERROR', 400);
  }
  const now = command.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0
    || !Number.isSafeInteger(input.validUntil) || input.validUntil <= now) {
    throw new ReservationError('VALIDATION_ERROR', 400);
  }

  const demand = await database.prepare(`
    SELECT demand.organization_id,
      (SELECT COUNT(*) FROM buyer_customers buyer WHERE buyer.id=?) AS buyer_exists,
      (SELECT access_status FROM buyer_customers buyer WHERE buyer.id=?) AS buyer_status
    FROM demand_batches demand
    WHERE demand.id=?
  `).bind(
    buyerCustomerId,
    buyerCustomerId,
    demandBatchId,
  ).first<DemandRow>();
  if (!demand || Number(demand.buyer_exists) !== 1) {
    throw new ReservationError('NOT_FOUND', 404);
  }
  if (demand.buyer_status !== 'ACTIVE') {
    throw new ReservationError('CUSTOMER_NOT_ACTIVE', 409);
  }

  const requestHash = await hashCanonicalJson({
    action: 'CREATE_RESERVATION_PARTICIPATION_EXCEPTION',
    buyer_customer_id: buyerCustomerId,
    seller_organization_id: demand.organization_id,
    demand_batch_id: demandBatchId,
    reason,
    valid_until: input.validUntil,
  });
  const acquired = await acquireIdempotency<CreateParticipationExceptionResult>(
    database,
    {
      actorType: 'STAFF',
      actorId: command.actor.staffId,
      action: 'CREATE_RESERVATION_PARTICIPATION_EXCEPTION',
      targetType: 'BUYER_CUSTOMER',
      targetId: buyerCustomerId,
      idempotencyKey: command.idempotencyKey,
      requestHash,
    },
    { now },
  );
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }

  try {
    const exceptionId = crypto.randomUUID();
    const response: CreateParticipationExceptionResult = {
      exception_id: exceptionId,
      buyer_customer_id: buyerCustomerId,
      seller_organization_id: demand.organization_id,
      demand_batch_id: demandBatchId,
      valid_until: input.validUntil,
      used: false,
      replayed: false,
    };
    const statements: SqlStatement[] = [
      database.prepare(`
        INSERT INTO reservation_participation_exceptions (
          id, buyer_customer_id, seller_organization_id, demand_batch_id,
          reason, created_by_staff_id, valid_until,
          used_at, used_by_reservation_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
      `).bind(
        exceptionId,
        buyerCustomerId,
        demand.organization_id,
        demandBatchId,
        reason,
        command.actor.staffId,
        input.validUntil,
        now,
      ),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'BUYER_CUSTOMER',
        aggregateId: buyerCustomerId,
        eventType: 'RESERVATION_PARTICIPATION_EXCEPTION_CREATED',
        actor: {
          type: 'STAFF',
          id: command.actor.staffId,
          roles: [...command.actor.roles],
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        nextState: {
          exception_id: exceptionId,
          seller_organization_id: demand.organization_id,
          demand_batch_id: demandBatchId,
          reason,
          valid_until: input.validUntil,
        },
        createdAt: now,
      }),
      database.prepare(`
        INSERT INTO transaction_assertions (assertion_value)
        SELECT CASE WHEN EXISTS (
          SELECT 1 FROM reservation_participation_exceptions
          WHERE id=? AND used_at IS NULL
        ) THEN 1 ELSE 0 END
      `).bind(exceptionId),
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: { exception_id: exceptionId },
        now,
      }),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ];
    await database.batch(statements);
    return response;
  } catch (error) {
    const normalized = normalizeReservationError(error);
    await markIdempotencyFailed(database, acquired.claim, normalized.code, now);
    throw normalized;
  }
}
