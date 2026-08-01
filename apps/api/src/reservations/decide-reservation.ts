import type {
  ReservationDecision,
  ReservationStatus,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import {
  isReservationDecision,
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
  prepareWorkItemCompletionStatements,
  requireAssignedWorkflowActor,
} from '../staff-assignment';
import {
  cleanReservationIdentifier,
  cleanReservationReason,
  insertReservationEventStatement,
  normalizeReservationError,
  requireReservationDecisionPermission,
  ReservationError,
  type ReservationStaffActor,
} from './reservation-shared';

interface ReservationSource {
  reservation_id: string;
  demand_batch_id: string;
  buyer_customer_id: string;
  status: ReservationStatus;
  reservation_version: number;
  hold_expires_at: number;
  demand_status: string;
  reservation_deadline: number;
  order_deadline: number;
  held_reservation_count: number;
  approved_reservation_count: number;
  target_quantity: number;
}

export interface DecideReservationResult {
  reservation_id: string;
  demand_batch_id: string;
  buyer_customer_id: string;
  status: 'APPROVED' | 'REJECTED';
  version: number;
  decision_reason: string | null;
  replayed: boolean;
}

export async function decideReservation(
  database: SqlDatabase,
  input: {
    reservationId: string;
    expectedVersion: number;
    decision: ReservationDecision;
    rejectionReason?: string | null;
  },
  command: {
    actor: ReservationStaffActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<DecideReservationResult> {
  requireReservationDecisionPermission(command.actor);

  const reservationId = cleanReservationIdentifier(
    input.reservationId,
  );
  if (!Number.isSafeInteger(input.expectedVersion)
    || input.expectedVersion < 1
    || !isReservationDecision(input.decision)) {
    throw new ReservationError('VALIDATION_ERROR', 400);
  }

  const rejectionReason = input.decision === 'REJECT'
    ? cleanReservationReason(input.rejectionReason)
    : null;
  if (input.decision === 'APPROVE'
    && input.rejectionReason != null
    && input.rejectionReason.trim().length > 0) {
    throw new ReservationError('VALIDATION_ERROR', 400);
  }

  const now = command.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new ReservationError('VALIDATION_ERROR', 400);
  }

  const requestHash = await hashCanonicalJson({
    action: 'DECIDE_RESERVATION',
    reservation_id: reservationId,
    expected_version: input.expectedVersion,
    decision: input.decision,
    rejection_reason: rejectionReason,
  });

  const acquired =
    await acquireIdempotency<DecideReservationResult>(
      database,
      {
        actorType: 'STAFF',
        actorId: command.actor.staffId,
        action: 'DECIDE_RESERVATION',
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
    const source = await requireDecisionSource(
      database,
      reservationId,
    );
    if (source.reservation_version
      !== input.expectedVersion) {
      throw new ReservationError(
        'VERSION_CONFLICT',
        409,
      );
    }
    if (source.status !== 'PENDING_REVIEW') {
      throw new ReservationError(
        'RESERVATION_ALREADY_DECIDED',
        409,
      );
    }

    if (input.decision === 'APPROVE') {
      if (source.demand_status !== 'PUBLISHED') {
        throw new ReservationError(
          'DEMAND_BATCH_NOT_PUBLISHED',
          409,
        );
      }
      if (source.reservation_deadline <= now
        || source.order_deadline <= now
        || source.hold_expires_at <= now) {
        throw new ReservationError(
          'DEMAND_BATCH_EXPIRED',
          409,
        );
      }
      if (source.held_reservation_count < 1
        || source.approved_reservation_count
          >= source.target_quantity) {
        throw new ReservationError(
          'CAPACITY_FULL',
          409,
        );
      }
    }

    const nextStatus = input.decision === 'APPROVE'
      ? 'APPROVED'
      : 'REJECTED';
    const nextVersion = source.reservation_version + 1;
    const response: DecideReservationResult = {
      reservation_id: reservationId,
      demand_batch_id: source.demand_batch_id,
      buyer_customer_id: source.buyer_customer_id,
      status: nextStatus,
      version: nextVersion,
      decision_reason: rejectionReason,
      replayed: false,
    };

    const eventType = input.decision === 'APPROVE'
      ? 'RESERVATION_APPROVED'
      : 'RESERVATION_REJECTED';
    const outbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey: `reservation-decided:${reservationId}`,
      eventType,
      aggregateType: 'RESERVATION',
      aggregateId: reservationId,
      payload: response,
      createdAt: now,
    });

    await requireAssignedWorkflowActor(database, {
      staffId: command.actor.staffId,
      workType: 'RESERVATION_DECISION',
      sourceEntityType: 'RESERVATION',
      sourceEntityId: reservationId,
    });

    const statements: SqlStatement[] = [
      // Phase 3H access was resolved from persisted Staff facts above.
      database.prepare(`
        UPDATE product_reservations
        SET
          status=?,
          version=version+1,
          updated_at=MAX(?, updated_at+1),
          decided_by_staff_id=?,
          decision_reason=?,
          decided_at=?,
          cancelled_at=NULL,
          expired_at=NULL
        WHERE id=?
          AND status='PENDING_REVIEW'
          AND version=?
      `).bind(
        nextStatus,
        now,
        command.actor.staffId,
        rejectionReason,
        now,
        reservationId,
        source.reservation_version,
      ),
      input.decision === 'APPROVE'
        ? database.prepare(`
            UPDATE demand_batches
            SET
              held_reservation_count=
                held_reservation_count-1,
              approved_reservation_count=
                approved_reservation_count+1,
              version=version+1,
              updated_at=MAX(?, updated_at+1)
            WHERE id=?
              AND status='PUBLISHED'
              AND held_reservation_count>=1
              AND reservation_deadline>?
              AND order_deadline>?
              AND (
                approved_reservation_count+1
              )<=target_quantity
          `).bind(
            now,
            source.demand_batch_id,
            now,
            now,
          )
        : database.prepare(`
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
          ),
      insertReservationEventStatement(database, {
        reservationId,
        demandBatchId: source.demand_batch_id,
        buyerCustomerId: source.buyer_customer_id,
        eventType,
        actorType: 'STAFF',
        actorId: command.actor.staffId,
        previousStatus: 'PENDING_REVIEW',
        nextStatus,
        reservationVersion: nextVersion,
        reason: rejectionReason,
        idempotencyKey: acquired.claim.idempotencyKey,
        createdAt: now,
      }),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'RESERVATION',
        aggregateId: reservationId,
        eventType,
        actor: {
          type: 'STAFF',
          id: command.actor.staffId,
          roles: command.actor.roles,
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: {
          status: 'PENDING_REVIEW',
          version: source.reservation_version,
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
      assertDecisionStatement(
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

    await database.batch([
      ...statements,
      ...await prepareWorkItemCompletionStatements(database, {
        workType: 'RESERVATION_DECISION',
        sourceEntityType: 'RESERVATION',
        sourceEntityId: reservationId,
        outcome: 'COMPLETED',
        actorType: 'STAFF',
        actorId: command.actor.staffId,
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
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

async function requireDecisionSource(
  database: SqlDatabase,
  reservationId: string,
): Promise<ReservationSource> {
  const row = await database.prepare(`
    SELECT
      reservation.id AS reservation_id,
      reservation.demand_batch_id,
      reservation.buyer_customer_id,
      reservation.status,
      reservation.version AS reservation_version,
      reservation.hold_expires_at,
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
  ).first<ReservationSource>();

  if (!row) {
    throw new ReservationError(
      'RESERVATION_NOT_FOUND',
      404,
    );
  }
  return row;
}

function assertDecisionStatement(
  database: SqlDatabase,
  claim: {
    actorType: string;
    actorId: string;
    idempotencyKey: string;
    leaseToken: string;
  },
  source: ReservationSource,
  response: DecideReservationResult,
): SqlStatement {
  const expectedHeld =
    source.held_reservation_count - 1;
  const expectedApproved =
    response.status === 'APPROVED'
      ? source.approved_reservation_count + 1
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
          AND decided_by_staff_id IS NOT NULL
          AND decided_at IS NOT NULL
      )
      AND EXISTS (
        SELECT 1
        FROM demand_batches
        WHERE id=?
          AND held_reservation_count=?
          AND approved_reservation_count=?
          AND (
            held_reservation_count
            + approved_reservation_count
          )<=target_quantity
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
    response.status,
    response.version,
    response.demand_batch_id,
    expectedHeld,
    expectedApproved,
    claim.actorType,
    claim.actorId,
    claim.idempotencyKey,
    claim.leaseToken,
  );
}
