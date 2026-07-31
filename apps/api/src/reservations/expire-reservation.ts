import type {
  ReservationStatus,
  SqlDatabase,
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
  assertReleasedStatement,
  releaseCapacityStatement,
} from './cancel-reservation';
import {
  cleanReservationIdentifier,
  insertReservationEventStatement,
  normalizeReservationError,
  ReservationError,
} from './reservation-shared';

interface ExpirySource {
  reservation_id: string;
  demand_batch_id: string;
  buyer_customer_id: string;
  status: ReservationStatus;
  version: number;
  hold_expires_at: number;
  order_deadline_snapshot: number;
  held_reservation_count: number;
  approved_reservation_count: number;
}

export interface ExpireReservationResult {
  reservation_id: string;
  demand_batch_id: string;
  status: 'EXPIRED';
  version: number;
  replayed: boolean;
}

export async function expireReservation(
  database: SqlDatabase,
  input: {
    reservationId: string;
    expectedVersion: number;
  },
  command: {
    idempotencyKey: string;
    now?: number;
  },
): Promise<ExpireReservationResult> {
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
    action: 'EXPIRE_RESERVATION',
    reservation_id: reservationId,
    expected_version: input.expectedVersion,
  });

  const acquired =
    await acquireIdempotency<ExpireReservationResult>(
      database,
      {
        actorType: 'SYSTEM',
        actorId: 'reservation-expiry',
        action: 'EXPIRE_RESERVATION',
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
    const source = await requireExpirySource(
      database,
      reservationId,
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

    const deadline = source.status === 'PENDING_REVIEW'
      ? source.hold_expires_at
      : source.order_deadline_snapshot;
    if (now < deadline) {
      throw new ReservationError(
        'VALIDATION_ERROR',
        409,
      );
    }

    const nextVersion = source.version + 1;
    const response: ExpireReservationResult = {
      reservation_id: reservationId,
      demand_batch_id: source.demand_batch_id,
      status: 'EXPIRED',
      version: nextVersion,
      replayed: false,
    };
    const outbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey:
        `reservation-expired:${reservationId}:${nextVersion}`,
      eventType: 'RESERVATION_EXPIRED',
      aggregateType: 'RESERVATION',
      aggregateId: reservationId,
      payload: response,
      createdAt: now,
    });

    const statements = [
      database.prepare(`
        UPDATE product_reservations
        SET
          status='EXPIRED',
          version=version+1,
          updated_at=MAX(?, updated_at+1),
          expired_at=?,
          cancelled_at=NULL
        WHERE id=?
          AND status=?
          AND version=?
      `).bind(
        now,
        now,
        reservationId,
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
        eventType: 'RESERVATION_EXPIRED',
        actorType: 'SYSTEM',
        actorId: 'reservation-expiry',
        previousStatus: source.status,
        nextStatus: 'EXPIRED',
        reservationVersion: nextVersion,
        idempotencyKey: acquired.claim.idempotencyKey,
        createdAt: now,
      }),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'RESERVATION',
        aggregateId: reservationId,
        eventType: 'RESERVATION_EXPIRED',
        actor: {
          type: 'SYSTEM',
          id: 'reservation-expiry',
          roles: [],
        },
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
        'EXPIRED',
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

async function requireExpirySource(
  database: SqlDatabase,
  reservationId: string,
): Promise<ExpirySource> {
  const row = await database.prepare(`
    SELECT
      reservation.id AS reservation_id,
      reservation.demand_batch_id,
      reservation.buyer_customer_id,
      reservation.status,
      reservation.version,
      reservation.hold_expires_at,
      reservation.order_deadline_snapshot,
      demand.held_reservation_count,
      demand.approved_reservation_count
    FROM product_reservations reservation
    JOIN demand_batches demand
      ON demand.id=reservation.demand_batch_id
    WHERE reservation.id=?
  `).bind(
    reservationId,
  ).first<ExpirySource>();

  if (!row) {
    throw new ReservationError(
      'RESERVATION_NOT_FOUND',
      404,
    );
  }
  return row;
}
