import type {
  ReservationStatus,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import {
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
  cleanReservationIdentifier,
  cleanReservationReason,
  insertReservationEventStatement,
  normalizeReservationError,
  requireReservationDecisionPermission,
  ReservationError,
  type ReservationStaffActor,
} from './reservation-shared';

interface ReopenSource {
  reservation_id: string;
  demand_batch_id: string;
  buyer_customer_id: string;
  store_id: string;
  product_id: string;
  status: ReservationStatus;
  version: number;
  reopened_count: number;
  demand_status: string;
  reservation_deadline: number;
  order_deadline: number;
  held_reservation_count: number;
  approved_reservation_count: number;
  target_quantity: number;
}

export interface ReopenReservationResult {
  reservation_id: string;
  demand_batch_id: string;
  status: 'PENDING_REVIEW';
  version: number;
  reopened_count: number;
  reason: string;
  replayed: boolean;
}

export async function reopenReservation(
  database: SqlDatabase,
  input: {
    reservationId: string;
    expectedVersion: number;
    reason: string;
  },
  command: {
    actor: ReservationStaffActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<ReopenReservationResult> {
  requireReservationDecisionPermission(command.actor);

  const reservationId = cleanReservationIdentifier(
    input.reservationId,
  );
  if (!Number.isSafeInteger(input.expectedVersion)
    || input.expectedVersion < 1) {
    throw new ReservationError('VALIDATION_ERROR', 400);
  }
  const reason = cleanReservationReason(input.reason);
  const now = command.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new ReservationError('VALIDATION_ERROR', 400);
  }

  const requestHash = await hashCanonicalJson({
    action: 'REOPEN_RESERVATION',
    reservation_id: reservationId,
    expected_version: input.expectedVersion,
    reason,
  });

  const acquired =
    await acquireIdempotency<ReopenReservationResult>(
      database,
      {
        actorType: 'STAFF',
        actorId: command.actor.staffId,
        action: 'REOPEN_RESERVATION',
        targetType: 'RESERVATION',
        targetId: reservationId,
        idempotencyKey: command.idempotencyKey,
        requestHash,
      },
      { now },
    );

  if (acquired.kind === 'REPLAY') {
    return {
      ...acquired.response,
      replayed: true,
    };
  }

  try {
    const source = await requireReopenSource(
      database,
      reservationId,
    );
    if (source.version !== input.expectedVersion) {
      throw new ReservationError(
        'VERSION_CONFLICT',
        409,
      );
    }
    if (source.status !== 'REJECTED'
      && source.status !== 'CANCELLED'
      && source.status !== 'EXPIRED') {
      throw new ReservationError(
        'RESERVATION_ALREADY_DECIDED',
        409,
      );
    }
    if (source.demand_status !== 'PUBLISHED') {
      throw new ReservationError(
        'DEMAND_BATCH_NOT_PUBLISHED',
        409,
      );
    }
    if (source.reservation_deadline <= now
      || source.order_deadline <= now) {
      throw new ReservationError(
        'DEMAND_BATCH_EXPIRED',
        409,
      );
    }
    if (
      source.held_reservation_count
      + source.approved_reservation_count
      >= source.target_quantity
    ) {
      throw new ReservationError('CAPACITY_FULL', 409);
    }

    const activeConflict = await database.prepare(`
      SELECT id
      FROM product_reservations
      WHERE buyer_customer_id=?
        AND store_id=?
        AND status IN (
          'PENDING_REVIEW',
          'APPROVED'
        )
        AND id<>?
      LIMIT 1
    `).bind(
      source.buyer_customer_id,
      source.store_id,
      reservationId,
    ).first<{ id: string }>();
    if (activeConflict) {
      throw new ReservationError(
        'BUYER_STORE_RESERVATION_CONFLICT',
        409,
      );
    }

    const nextVersion = source.version + 1;
    const nextReopenedCount = source.reopened_count + 1;
    const response: ReopenReservationResult = {
      reservation_id: reservationId,
      demand_batch_id: source.demand_batch_id,
      status: 'PENDING_REVIEW',
      version: nextVersion,
      reopened_count: nextReopenedCount,
      reason,
      replayed: false,
    };

    const statements: SqlStatement[] = [
      database.prepare(`
        UPDATE product_reservations
        SET
          status='PENDING_REVIEW',
          version=version+1,
          reopened_count=reopened_count+1,
          updated_at=MAX(?, updated_at+1),
          decided_by_staff_id=NULL,
          decision_reason=NULL,
          decided_at=NULL,
          cancelled_at=NULL,
          expired_at=NULL
        WHERE id=?
          AND status=?
          AND version=?
          AND NOT EXISTS (
            SELECT 1
            FROM product_reservations active_store_reservation
            WHERE active_store_reservation.buyer_customer_id=?
              AND active_store_reservation.store_id=?
              AND active_store_reservation.id<>?
              AND active_store_reservation.status IN (
                'PENDING_REVIEW',
                'APPROVED'
              )
          )
      `).bind(
        now,
        reservationId,
        source.status,
        source.version,
        source.buyer_customer_id,
        source.store_id,
        reservationId,
      ),
      database.prepare(`
        UPDATE demand_batches
        SET
          held_reservation_count=
            held_reservation_count+1,
          version=version+1,
          updated_at=MAX(?, updated_at+1)
        WHERE id=?
          AND status='PUBLISHED'
          AND reservation_deadline>?
          AND order_deadline>?
          AND (
            held_reservation_count
            + approved_reservation_count
          )<target_quantity
      `).bind(
        now,
        source.demand_batch_id,
        now,
        now,
      ),
      insertReservationEventStatement(database, {
        reservationId,
        demandBatchId: source.demand_batch_id,
        buyerCustomerId: source.buyer_customer_id,
        eventType: 'RESERVATION_REOPENED',
        actorType: 'STAFF',
        actorId: command.actor.staffId,
        previousStatus: source.status,
        nextStatus: 'PENDING_REVIEW',
        reservationVersion: nextVersion,
        reason,
        idempotencyKey: acquired.claim.idempotencyKey,
        createdAt: now,
      }),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'RESERVATION',
        aggregateId: reservationId,
        eventType: 'RESERVATION_REOPENED',
        actor: {
          type: 'STAFF',
          id: command.actor.staffId,
          roles: command.actor.roles,
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: {
          status: source.status,
          version: source.version,
        },
        nextState: response,
        createdAt: now,
      }),
      completeIdempotencyStatement(
        database,
        acquired.claim,
        response,
        {
          resultReferences: {
            reservation_id: reservationId,
          },
          now,
        },
      ),
      assertReopenedStatement(
        database,
        acquired.claim,
        source,
        response,
      ),
      assertIdempotencyCompletionStatement(
        database,
        acquired.claim,
      ),
    ];

    await database.batch(statements);
    return response;
  } catch (error) {
    const normalized = normalizeReservationError(error);
    await markIdempotencyFailed(
      database,
      acquired.claim,
      normalized.code,
      now,
    );
    throw normalized;
  }
}

async function requireReopenSource(
  database: SqlDatabase,
  reservationId: string,
): Promise<ReopenSource> {
  const row = await database.prepare(`
    SELECT
      reservation.id AS reservation_id,
      reservation.demand_batch_id,
      reservation.buyer_customer_id,
      reservation.store_id,
      reservation.product_id,
      reservation.status,
      reservation.version,
      reservation.reopened_count,
      demand.status AS demand_status,
      demand.reservation_deadline,
      demand.order_deadline,
      demand.held_reservation_count,
      demand.approved_reservation_count,
      demand.target_quantity
    FROM product_reservations reservation
    JOIN demand_batches demand
      ON demand.id=reservation.demand_batch_id
    WHERE reservation.id=?
  `).bind(
    reservationId,
  ).first<ReopenSource>();

  if (!row) {
    throw new ReservationError(
      'RESERVATION_NOT_FOUND',
      404,
    );
  }
  return row;
}

function assertReopenedStatement(
  database: SqlDatabase,
  claim: {
    actorType: string;
    actorId: string;
    idempotencyKey: string;
    leaseToken: string;
  },
  source: ReopenSource,
  response: ReopenReservationResult,
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (
        SELECT 1
        FROM product_reservations
        WHERE id=?
          AND status='PENDING_REVIEW'
          AND version=?
          AND reopened_count=?
          AND decided_by_staff_id IS NULL
          AND cancelled_at IS NULL
          AND expired_at IS NULL
      )
      AND EXISTS (
        SELECT 1
        FROM demand_batches
        WHERE id=?
          AND held_reservation_count=?
          AND approved_reservation_count=?
      )
      AND EXISTS (
        SELECT 1
        FROM command_idempotency_records
        WHERE actor_type=?
          AND actor_id=?
          AND idempotency_key=?
          AND status='COMMITTED'
          AND lease_token=?
      )
    THEN 1 ELSE 0 END
  `).bind(
    response.reservation_id,
    response.version,
    response.reopened_count,
    response.demand_batch_id,
    source.held_reservation_count + 1,
    source.approved_reservation_count,
    claim.actorType,
    claim.actorId,
    claim.idempotencyKey,
    claim.leaseToken,
  );
}
