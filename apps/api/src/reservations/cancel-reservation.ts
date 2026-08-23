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
  createOutboxStatements,
  prepareOutboxEvent,
} from '../foundation/outbox';
import {
  cleanReservationIdentifier,
  insertReservationEventStatement,
  normalizeReservationError,
  validateBuyerReservationActor,
  ReservationError,
  type BuyerReservationActor,
} from './reservation-shared';
import { prepareWorkItemCompletionStatements } from '../staff-assignment';

interface CancellationSource {
  reservation_id: string;
  demand_batch_id: string;
  buyer_customer_id: string;
  status: ReservationStatus;
  version: number;
  held_reservation_count: number;
  approved_reservation_count: number;
}

export interface CancelReservationResult {
  reservation_id: string;
  demand_batch_id: string;
  status: 'CANCELLED';
  version: number;
  replayed: boolean;
}

export async function cancelReservation(
  database: SqlDatabase,
  input: {
    reservationId: string;
    expectedVersion: number;
  },
  command: {
    actor: BuyerReservationActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<CancelReservationResult> {
  validateBuyerReservationActor(command.actor);

  const reservationId = cleanReservationIdentifier(
    input.reservationId,
  );
  if (!Number.isSafeInteger(input.expectedVersion)
    || input.expectedVersion < 1) {
    throw new ReservationError('VALIDATION_ERROR', 400);
  }
  const now = command.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new ReservationError('VALIDATION_ERROR', 400);
  }

  const requestHash = await hashCanonicalJson({
    action: 'CANCEL_RESERVATION',
    reservation_id: reservationId,
    expected_version: input.expectedVersion,
    buyer_customer_id: command.actor.buyerCustomerId,
  });

  const acquired =
    await acquireIdempotency<CancelReservationResult>(
      database,
      {
        actorType: 'BUYER_CUSTOMER',
        actorId: command.actor.buyerCustomerId,
        action: 'CANCEL_RESERVATION',
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
    const source = await requireCancellationSource(
      database,
      reservationId,
      command.actor.buyerCustomerId,
    );
    if (source.version !== input.expectedVersion) {
      throw new ReservationError(
        'VERSION_CONFLICT',
        409,
      );
    }
    if (source.status !== 'PENDING_REVIEW'
      && source.status !== 'APPROVED') {
      throw new ReservationError(
        'RESERVATION_ALREADY_DECIDED',
        409,
      );
    }

    const nextVersion = source.version + 1;
    const response: CancelReservationResult = {
      reservation_id: reservationId,
      demand_batch_id: source.demand_batch_id,
      status: 'CANCELLED',
      version: nextVersion,
      replayed: false,
    };
    const outbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey:
        `reservation-cancelled:${reservationId}:${nextVersion}`,
      eventType: 'RESERVATION_CANCELLED',
      aggregateType: 'RESERVATION',
      aggregateId: reservationId,
      payload: response,
      createdAt: now,
    });

    const statements: SqlStatement[] = [
      database.prepare(`
        UPDATE product_reservations
        SET
          status='CANCELLED',
          version=version+1,
          updated_at=MAX(?, updated_at+1),
          cancelled_at=?,
          expired_at=NULL
        WHERE id=?
          AND buyer_customer_id=?
          AND status=?
          AND version=?
      `).bind(
        now,
        now,
        reservationId,
        command.actor.buyerCustomerId,
        source.status,
        source.version,
      ),
      releaseCapacityStatement(
        database,
        source,
        now,
      ),
      insertReservationEventStatement(database, {
        reservationId,
        demandBatchId: source.demand_batch_id,
        buyerCustomerId: source.buyer_customer_id,
        eventType: 'RESERVATION_CANCELLED',
        actorType: 'BUYER_CUSTOMER',
        actorId: command.actor.buyerCustomerId,
        previousStatus: source.status,
        nextStatus: 'CANCELLED',
        reservationVersion: nextVersion,
        idempotencyKey: acquired.claim.idempotencyKey,
        createdAt: now,
      }),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'RESERVATION',
        aggregateId: reservationId,
        eventType: 'RESERVATION_CANCELLED',
        actor: {
          type: 'BUYER_CUSTOMER',
          id: command.actor.buyerCustomerId,
          roles: [],
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
      ...createOutboxStatements(database, outbox),
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
      assertReleasedStatement(
        database,
        acquired.claim,
        source,
        response.reservation_id,
        response.version,
        'CANCELLED',
      ),
      assertIdempotencyCompletionStatement(
        database,
        acquired.claim,
      ),
    ];

    await database.batch([
      ...statements,
      // 买家取消 PENDING_REVIEW 预约时同步取消 RESERVATION_DECISION 待办，
      // 避免队列残留点开必报错的死项。
      ...await prepareWorkItemCompletionStatements(database, {
        workType: 'RESERVATION_DECISION',
        sourceEntityType: 'RESERVATION',
        sourceEntityId: reservationId,
        outcome: 'CANCELLED',
        actorType: 'SYSTEM',
        actorId: `buyer:${command.actor.buyerCustomerId}`,
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        reason: 'reservation cancelled by buyer',
        now,
      }),
    ]);
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

export function releaseCapacityStatement(
  database: SqlDatabase,
  source: CancellationSource,
  now: number,
): SqlStatement {
  return source.status === 'PENDING_REVIEW'
    ? database.prepare(`
        UPDATE demand_batches
        SET
          held_reservation_count=
            held_reservation_count-1,
          version=version+1,
          updated_at=MAX(?, updated_at+1)
        WHERE id=?
          AND held_reservation_count>=1
      `).bind(
        now,
        source.demand_batch_id,
      )
    : database.prepare(`
        UPDATE demand_batches
        SET
          approved_reservation_count=
            approved_reservation_count-1,
          version=version+1,
          updated_at=MAX(?, updated_at+1)
        WHERE id=?
          AND approved_reservation_count>=1
      `).bind(
        now,
        source.demand_batch_id,
      );
}

export function assertReleasedStatement(
  database: SqlDatabase,
  claim: {
    actorType: string;
    actorId: string;
    idempotencyKey: string;
    leaseToken: string;
  },
  source: CancellationSource,
  reservationId: string,
  reservationVersion: number,
  terminalStatus: 'CANCELLED' | 'EXPIRED',
): SqlStatement {
  const expectedHeld = source.status === 'PENDING_REVIEW'
    ? source.held_reservation_count - 1
    : source.held_reservation_count;
  const expectedApproved = source.status === 'APPROVED'
    ? source.approved_reservation_count - 1
    : source.approved_reservation_count;

  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (
        SELECT 1
        FROM product_reservations
        WHERE id=?
          AND status=?
          AND version=?
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
    reservationId,
    terminalStatus,
    reservationVersion,
    source.demand_batch_id,
    expectedHeld,
    expectedApproved,
    claim.actorType,
    claim.actorId,
    claim.idempotencyKey,
    claim.leaseToken,
  );
}

async function requireCancellationSource(
  database: SqlDatabase,
  reservationId: string,
  buyerCustomerId: string,
): Promise<CancellationSource> {
  const row = await database.prepare(`
    SELECT
      reservation.id AS reservation_id,
      reservation.demand_batch_id,
      reservation.buyer_customer_id,
      reservation.status,
      reservation.version,
      demand.held_reservation_count,
      demand.approved_reservation_count
    FROM product_reservations reservation
    JOIN demand_batches demand
      ON demand.id=reservation.demand_batch_id
    WHERE reservation.id=?
      AND reservation.buyer_customer_id=?
  `).bind(
    reservationId,
    buyerCustomerId,
  ).first<CancellationSource>();

  if (!row) {
    throw new ReservationError(
      'RESERVATION_NOT_FOUND',
      404,
    );
  }
  return row;
}
