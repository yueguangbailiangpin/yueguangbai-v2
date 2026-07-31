import type {
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
  reservationPrecheckSnapshot,
  validateBuyerReservationActor,
  ReservationError,
  type BuyerReservationActor,
} from './reservation-shared';

interface DemandEligibilityRow {
  demand_batch_id: string;
  organization_id: string;
  store_id: string;
  product_id: string;
  product_version_no: number;
  marketplace_code: 'JP';
  demand_status: string;
  target_quantity: number;
  held_reservation_count: number;
  approved_reservation_count: number;
  open_at: number;
  reservation_deadline: number;
  order_deadline: number;
  product_status: string;
  store_status: string;
  organization_status: string;
  buyer_access_status: string;
  buyer_identity_review_status: string;
}

export interface SubmitReservationResult {
  reservation_id: string;
  demand_batch_id: string;
  buyer_customer_id: string;
  product_id: string;
  product_version_no: number;
  marketplace_code: 'JP';
  status: 'PENDING_REVIEW';
  hold_expires_at: number;
  order_deadline_snapshot: number;
  version: 1;
  replayed: boolean;
}

export async function submitReservation(
  database: SqlDatabase,
  input: {
    demandBatchId: string;
  },
  command: {
    actor: BuyerReservationActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<SubmitReservationResult> {
  validateBuyerReservationActor(command.actor);

  const demandBatchId = cleanReservationIdentifier(
    input.demandBatchId,
  );
  const now = command.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new ReservationError('VALIDATION_ERROR', 400);
  }

  const requestHash = await hashCanonicalJson({
    action: 'SUBMIT_RESERVATION',
    demand_batch_id: demandBatchId,
    buyer_customer_id: command.actor.buyerCustomerId,
    marketplace_code: command.actor.marketplaceCode,
  });

  const acquired =
    await acquireIdempotency<SubmitReservationResult>(
      database,
      {
        actorType: 'BUYER_CUSTOMER',
        actorId: command.actor.buyerCustomerId,
        action: 'SUBMIT_RESERVATION',
        targetType: 'DEMAND_BATCH',
        targetId: demandBatchId,
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
    const source = await requireEligibility(
      database,
      demandBatchId,
      command.actor,
      now,
    );
    await assertNoReservationConflict(
      database,
      source,
      command.actor.buyerCustomerId,
    );

    const reservationId = crypto.randomUUID();
    const response: SubmitReservationResult = {
      reservation_id: reservationId,
      demand_batch_id: source.demand_batch_id,
      buyer_customer_id: command.actor.buyerCustomerId,
      product_id: source.product_id,
      product_version_no:
        Number(source.product_version_no),
      marketplace_code: source.marketplace_code,
      status: 'PENDING_REVIEW',
      hold_expires_at:
        Number(source.reservation_deadline),
      order_deadline_snapshot:
        Number(source.order_deadline),
      version: 1,
      replayed: false,
    };

    const precheck = reservationPrecheckSnapshot({
      buyerCustomerId: command.actor.buyerCustomerId,
      marketplaceCode: command.actor.marketplaceCode,
      demandBatchId: source.demand_batch_id,
      productId: source.product_id,
      demandStatus: source.demand_status,
      buyerAccessStatus: source.buyer_access_status,
      buyerIdentityReviewStatus:
        source.buyer_identity_review_status,
      openAt: Number(source.open_at),
      reservationDeadline:
        Number(source.reservation_deadline),
      orderDeadline: Number(source.order_deadline),
      targetQuantity: Number(source.target_quantity),
      heldCount:
        Number(source.held_reservation_count),
      approvedCount:
        Number(source.approved_reservation_count),
      checkedAt: now,
    });

    const outbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey: `reservation-submitted:${reservationId}`,
      eventType: 'RESERVATION_SUBMITTED',
      aggregateType: 'RESERVATION',
      aggregateId: reservationId,
      payload: {
        ...response,
        seller_organization_id:
          source.organization_id,
        store_id: source.store_id,
      },
      createdAt: now,
    });

    const statements: SqlStatement[] = [
      database.prepare(`
        INSERT INTO product_reservations (
          id,
          demand_batch_id,
          buyer_customer_id,
          organization_id,
          store_id,
          product_id,
          product_version_no,
          marketplace_code,
          status,
          precheck_snapshot_json,
          hold_expires_at,
          order_deadline_snapshot,
          version,
          submitted_at,
          updated_at,
          decided_by_staff_id,
          decision_reason,
          decided_at,
          cancelled_at,
          expired_at,
          reopened_count
        )
        SELECT
          ?, demand.id, buyer.id,
          demand.organization_id,
          demand.store_id,
          demand.product_id,
          demand.product_version_no,
          demand.marketplace_code,
          'PENDING_REVIEW',
          ?,
          demand.reservation_deadline,
          demand.order_deadline,
          1, ?, ?, NULL, NULL, NULL, NULL, NULL, 0
        FROM demand_batches demand
        JOIN buyer_customers buyer
          ON buyer.id=?
          AND buyer.marketplace_code=demand.marketplace_code
        JOIN products product
          ON product.id=demand.product_id
          AND product.organization_id=demand.organization_id
        JOIN seller_stores store
          ON store.id=demand.store_id
          AND store.organization_id=demand.organization_id
        JOIN seller_organizations organization
          ON organization.id=demand.organization_id
        WHERE demand.id=?
          AND demand.marketplace_code=?
          AND demand.status='PUBLISHED'
          AND demand.open_at<=?
          AND demand.reservation_deadline>?
          AND demand.order_deadline>?
          AND (
            demand.held_reservation_count
            + demand.approved_reservation_count
          ) < demand.target_quantity
          AND buyer.access_status='ACTIVE'
          AND buyer.identity_review_status='CLEAR'
          AND product.status='ACTIVE'
          AND store.status='ACTIVE'
          AND organization.status='ACTIVE'
          AND NOT EXISTS (
            SELECT 1
            FROM product_reservations existing
            WHERE existing.demand_batch_id=demand.id
              AND existing.buyer_customer_id=buyer.id
          )
          AND NOT EXISTS (
            SELECT 1
            FROM product_reservations active
            WHERE active.buyer_customer_id=buyer.id
              AND active.product_id=demand.product_id
              AND active.status IN (
                'PENDING_REVIEW',
                'APPROVED'
              )
          )
      `).bind(
        reservationId,
        precheck,
        now,
        now,
        command.actor.buyerCustomerId,
        demandBatchId,
        command.actor.marketplaceCode,
        now,
        now,
        now,
      ),
      database.prepare(`
        INSERT INTO transaction_assertions (assertion_value)
        SELECT CASE WHEN EXISTS (
          SELECT 1
          FROM product_reservations
          WHERE id=?
            AND status='PENDING_REVIEW'
        ) THEN 1 ELSE 0 END
      `).bind(reservationId),
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
          ) < target_quantity
          AND EXISTS (
            SELECT 1
            FROM product_reservations reservation
            WHERE reservation.id=?
              AND reservation.demand_batch_id=
                demand_batches.id
              AND reservation.status='PENDING_REVIEW'
          )
      `).bind(
        now,
        demandBatchId,
        now,
        now,
        reservationId,
      ),
      insertReservationEventStatement(database, {
        reservationId,
        demandBatchId,
        buyerCustomerId: command.actor.buyerCustomerId,
        eventType: 'RESERVATION_SUBMITTED',
        actorType: 'BUYER_CUSTOMER',
        actorId: command.actor.buyerCustomerId,
        previousStatus: null,
        nextStatus: 'PENDING_REVIEW',
        reservationVersion: 1,
        idempotencyKey: acquired.claim.idempotencyKey,
        createdAt: now,
      }),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'RESERVATION',
        aggregateId: reservationId,
        eventType: 'RESERVATION_SUBMITTED',
        actor: {
          type: 'BUYER_CUSTOMER',
          id: command.actor.buyerCustomerId,
          roles: [],
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: null,
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
            demand_batch_id: demandBatchId,
          },
          now,
        },
      ),
      assertSubmittedStatement(
        database,
        acquired.claim,
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

async function requireEligibility(
  database: SqlDatabase,
  demandBatchId: string,
  actor: BuyerReservationActor,
  now: number,
): Promise<DemandEligibilityRow> {
  const row = await database.prepare(`
    SELECT
      demand.id AS demand_batch_id,
      demand.organization_id,
      demand.store_id,
      demand.product_id,
      demand.product_version_no,
      demand.marketplace_code,
      demand.status AS demand_status,
      demand.target_quantity,
      demand.held_reservation_count,
      demand.approved_reservation_count,
      demand.open_at,
      demand.reservation_deadline,
      demand.order_deadline,
      product.status AS product_status,
      store.status AS store_status,
      organization.status AS organization_status,
      buyer.access_status AS buyer_access_status,
      buyer.identity_review_status
        AS buyer_identity_review_status
    FROM demand_batches demand
    JOIN products product
      ON product.id=demand.product_id
      AND product.organization_id=demand.organization_id
    JOIN seller_stores store
      ON store.id=demand.store_id
      AND store.organization_id=demand.organization_id
    JOIN seller_organizations organization
      ON organization.id=demand.organization_id
    JOIN buyer_customers buyer
      ON buyer.id=?
      AND buyer.marketplace_code=demand.marketplace_code
    WHERE demand.id=?
      AND demand.marketplace_code=?
  `).bind(
    actor.buyerCustomerId,
    demandBatchId,
    actor.marketplaceCode,
  ).first<DemandEligibilityRow>();

  if (!row) {
    throw new ReservationError(
      'DEMAND_BATCH_NOT_FOUND',
      404,
    );
  }
  if (row.buyer_access_status !== 'ACTIVE') {
    throw new ReservationError(
      'CUSTOMER_NOT_ACTIVE',
      409,
    );
  }
  if (row.buyer_identity_review_status !== 'CLEAR') {
    throw new ReservationError(
      'IDENTITY_REVIEW_REQUIRED',
      409,
    );
  }
  if (row.demand_status !== 'PUBLISHED') {
    throw new ReservationError(
      'DEMAND_BATCH_NOT_PUBLISHED',
      409,
    );
  }
  if (Number(row.open_at) > now
    || Number(row.reservation_deadline) <= now
    || Number(row.order_deadline) <= now) {
    throw new ReservationError(
      'DEMAND_BATCH_EXPIRED',
      409,
    );
  }
  if (row.product_status !== 'ACTIVE'
    || row.store_status !== 'ACTIVE'
    || row.organization_status !== 'ACTIVE') {
    throw new ReservationError(
      'DEMAND_BATCH_NOT_PUBLISHED',
      409,
    );
  }
  if (
    Number(row.held_reservation_count)
    + Number(row.approved_reservation_count)
    >= Number(row.target_quantity)
  ) {
    throw new ReservationError('CAPACITY_FULL', 409);
  }
  return row;
}

async function assertNoReservationConflict(
  database: SqlDatabase,
  source: DemandEligibilityRow,
  buyerCustomerId: string,
): Promise<void> {
  const sameDemand = await database.prepare(`
    SELECT id
    FROM product_reservations
    WHERE demand_batch_id=?
      AND buyer_customer_id=?
    LIMIT 1
  `).bind(
    source.demand_batch_id,
    buyerCustomerId,
  ).first<{ id: string }>();
  if (sameDemand) {
    throw new ReservationError(
      'RESERVATION_ALREADY_EXISTS',
      409,
    );
  }

  const activeProduct = await database.prepare(`
    SELECT id
    FROM product_reservations
    WHERE buyer_customer_id=?
      AND product_id=?
      AND status IN (
        'PENDING_REVIEW',
        'APPROVED'
      )
    LIMIT 1
  `).bind(
    buyerCustomerId,
    source.product_id,
  ).first<{ id: string }>();
  if (activeProduct) {
    throw new ReservationError(
      'BUYER_PRODUCT_RESERVATION_CONFLICT',
      409,
    );
  }
}

function assertSubmittedStatement(
  database: SqlDatabase,
  claim: {
    actorType: string;
    actorId: string;
    idempotencyKey: string;
    leaseToken: string;
  },
  response: SubmitReservationResult,
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (
        SELECT 1
        FROM product_reservations
        WHERE id=?
          AND demand_batch_id=?
          AND buyer_customer_id=?
          AND status='PENDING_REVIEW'
          AND version=1
      )
      AND EXISTS (
        SELECT 1
        FROM demand_batches
        WHERE id=?
          AND held_reservation_count>=1
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
    response.demand_batch_id,
    response.buyer_customer_id,
    response.demand_batch_id,
    claim.actorType,
    claim.actorId,
    claim.idempotencyKey,
    claim.leaseToken,
  );
}
