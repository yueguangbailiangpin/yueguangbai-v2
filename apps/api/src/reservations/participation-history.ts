import type { SqlDatabase } from '@ygb/contracts';
import { ReservationError } from './reservation-shared';

export interface HistoricalParticipationFact {
  kind: 'APPROVED_RESERVATION' | 'FORMAL_ORDER';
  reference_id: string;
}

interface ParticipationRow {
  kind: 'APPROVED_RESERVATION' | 'FORMAL_ORDER';
  reference_id: string;
}

export interface ValidParticipationException {
  id: string;
}

/**
 * D-056 §5 permanent participation rule: a buyer who already has an
 * APPROVED reservation or a formal order under a seller organization has
 * participated. Pre-approval REJECTED/CANCELLED/EXPIRED reservations never
 * count, and deletion cannot bypass the check because reservations are
 * append-only at trigger level.
 */
export async function findHistoricalParticipation(
  database: SqlDatabase,
  input: {
    buyerCustomerId: string;
    sellerOrganizationId: string;
    excludeReservationId?: string;
  },
): Promise<HistoricalParticipationFact | null> {
  const rows = await database.prepare(`
    SELECT 'APPROVED_RESERVATION' AS kind, reservation.id AS reference_id
    FROM product_reservations reservation
    JOIN demand_batches demand ON demand.id=reservation.demand_batch_id
    WHERE reservation.buyer_customer_id=?
      AND demand.organization_id=?
      AND reservation.status='APPROVED'
      AND (? IS NULL OR reservation.id<>?)
    UNION ALL
    SELECT 'FORMAL_ORDER' AS kind, formal_order.id AS reference_id
    FROM formal_orders formal_order
    JOIN seller_stores store ON store.id=formal_order.store_id
    WHERE formal_order.buyer_customer_id=?
      AND store.organization_id=?
    LIMIT 1
  `).bind(
    input.buyerCustomerId,
    input.sellerOrganizationId,
    input.excludeReservationId ?? null,
    input.excludeReservationId ?? null,
    input.buyerCustomerId,
    input.sellerOrganizationId,
  ).all<ParticipationRow>();
  return rows.results[0] ?? null;
}

export async function findValidParticipationException(
  database: SqlDatabase,
  input: {
    buyerCustomerId: string;
    sellerOrganizationId: string;
    demandBatchId: string;
    now: number;
  },
): Promise<ValidParticipationException | null> {
  const row = await database
    .prepare(
      `SELECT id FROM reservation_participation_exceptions
      WHERE buyer_customer_id=? AND seller_organization_id=?
        AND demand_batch_id=? AND used_at IS NULL AND valid_until>?
      ORDER BY created_at DESC, id LIMIT 1`,
    )
    .bind(
      input.buyerCustomerId,
      input.sellerOrganizationId,
      input.demandBatchId,
      input.now,
    )
    .first<{ id: string }>();
  return row ? { id: row.id } : null;
}

/**
 * Gate used by submitReservation: historical participation is a stable
 * rejection unless a valid one-time exception exists for this exact batch.
 */
export async function assertNoHistoricalParticipation(
  database: SqlDatabase,
  input: {
    buyerCustomerId: string;
    sellerOrganizationId: string;
    demandBatchId: string;
    now: number;
  },
): Promise<ValidParticipationException | null> {
  const participation = await findHistoricalParticipation(database, {
    buyerCustomerId: input.buyerCustomerId,
    sellerOrganizationId: input.sellerOrganizationId,
  });
  if (!participation) return null;
  const exception = await findValidParticipationException(database, input);
  if (exception) return exception;
  // Stable public code: the buyer must contact pre-sales staff.
  throw new ReservationError('RESERVATION_HISTORY_PARTICIPATION', 409);
}
