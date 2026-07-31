import type {
  BuyerPortalDemandDto,
  BuyerPortalPageDto,
  BuyerPortalReservationDto,
  DemandTaskType,
  ReservationStatus,
  SqlDatabase,
} from '@ygb/contracts';
import type { BuyerPortalContext } from './buyer-context';
import { BuyerPortalError } from './errors';
import {
  encodeDemandCursor,
  encodeReservationCursor,
  type DemandPageCursor,
  type ReservationPageCursor,
} from './pagination';

interface DemandRow {
  demand_batch_id: string;
  marketplace_code: 'JP';
  asin: string;
  product_name: string;
  search_keywords_json: string;
  product_url: string | null;
  buyer_visible_notes: string | null;
  store_display_name: string;
  task_type: DemandTaskType;
  target_quantity: number;
  remaining_quantity: number;
  open_at: number;
  reservation_deadline: number;
  order_deadline: number;
  submitted_at: number;
}

interface ReservationRow {
  reservation_id: string;
  status: ReservationStatus;
  reservation_version: number;
  submitted_at: number;
  updated_at: number;
  hold_expires_at: number;
  order_deadline_snapshot: number;
  decided_at: number | null;
  cancelled_at: number | null;
  expired_at: number | null;
  demand_batch_id: string;
  marketplace_code: 'JP';
  asin: string;
  product_name: string;
  search_keywords_json: string;
  product_url: string | null;
  buyer_visible_notes: string | null;
  store_display_name: string;
  task_type: DemandTaskType;
  reservation_deadline: number;
  order_deadline: number;
}

const PUBLIC_DEMAND_SELECT = `
  SELECT
    demand.id AS demand_batch_id,
    demand.marketplace_code,
    product.asin_normalized AS asin,
    version.product_name,
    version.search_keywords_json,
    version.product_url,
    demand.buyer_visible_notes,
    store.display_name AS store_display_name,
    demand.task_type,
    demand.target_quantity,
    MAX(
      demand.target_quantity
        - demand.held_reservation_count
        - demand.approved_reservation_count,
      0
    ) AS remaining_quantity,
    demand.open_at,
    demand.reservation_deadline,
    demand.order_deadline,
    demand.submitted_at
  FROM demand_batches demand
  JOIN products product
    ON product.id=demand.product_id
    AND product.organization_id=demand.organization_id
    AND product.store_id=demand.store_id
    AND product.marketplace_code=demand.marketplace_code
  JOIN product_versions version
    ON version.product_id=demand.product_id
    AND version.version_no=demand.product_version_no
  JOIN seller_stores store
    ON store.id=demand.store_id
    AND store.organization_id=demand.organization_id
  JOIN seller_organizations organization
    ON organization.id=demand.organization_id
`;

const PUBLIC_DEMAND_WHERE = `
  demand.marketplace_code=?
  AND demand.status='PUBLISHED'
  AND demand.open_at<=?
  AND demand.reservation_deadline>?
  AND demand.order_deadline>?
  AND product.status='ACTIVE'
  AND store.status='ACTIVE'
  AND organization.status='ACTIVE'
`;

const RESERVATION_SELECT = `
  SELECT
    reservation.id AS reservation_id,
    reservation.status,
    reservation.version AS reservation_version,
    reservation.submitted_at,
    reservation.updated_at,
    reservation.hold_expires_at,
    reservation.order_deadline_snapshot,
    reservation.decided_at,
    reservation.cancelled_at,
    reservation.expired_at,
    demand.id AS demand_batch_id,
    demand.marketplace_code,
    product.asin_normalized AS asin,
    version.product_name,
    version.search_keywords_json,
    version.product_url,
    demand.buyer_visible_notes,
    store.display_name AS store_display_name,
    demand.task_type,
    demand.reservation_deadline,
    demand.order_deadline
  FROM product_reservations reservation
  JOIN demand_batches demand
    ON demand.id=reservation.demand_batch_id
  JOIN products product
    ON product.id=reservation.product_id
    AND product.organization_id=reservation.organization_id
    AND product.store_id=reservation.store_id
    AND product.marketplace_code=reservation.marketplace_code
  JOIN product_versions version
    ON version.product_id=reservation.product_id
    AND version.version_no=reservation.product_version_no
  JOIN seller_stores store
    ON store.id=reservation.store_id
    AND store.organization_id=reservation.organization_id
`;

export async function listBuyerPortalDemands(
  database: SqlDatabase,
  buyer: BuyerPortalContext,
  options: {
    now: number;
    limit: number;
    cursor: DemandPageCursor | null;
  },
): Promise<BuyerPortalPageDto<BuyerPortalDemandDto>> {
  assertBuyerBusinessAccess(buyer);
  validateNowAndLimit(options.now, options.limit);

  const cursorSql = options.cursor
    ? `
      AND (
        demand.reservation_deadline>?
        OR (
          demand.reservation_deadline=?
          AND demand.submitted_at>?
        )
        OR (
          demand.reservation_deadline=?
          AND demand.submitted_at=?
          AND demand.id>?
        )
      )
    `
    : '';
  const bindings: unknown[] = [
    buyer.marketplaceCode,
    options.now,
    options.now,
    options.now,
  ];
  if (options.cursor) {
    bindings.push(
      options.cursor.reservationDeadline,
      options.cursor.reservationDeadline,
      options.cursor.submittedAt,
      options.cursor.reservationDeadline,
      options.cursor.submittedAt,
      options.cursor.id,
    );
  }
  bindings.push(options.limit + 1);

  const result = await database.prepare(`
    ${PUBLIC_DEMAND_SELECT}
    WHERE ${PUBLIC_DEMAND_WHERE}
      ${cursorSql}
    ORDER BY
      demand.reservation_deadline,
      demand.submitted_at,
      demand.id
    LIMIT ?
  `).bind(...bindings).all<DemandRow>();

  const hasMore = result.results.length > options.limit;
  const visibleRows = hasMore
    ? result.results.slice(0, options.limit)
    : result.results;
  const last = visibleRows.at(-1) ?? null;
  return {
    items: Object.freeze(visibleRows.map(toDemandDto)),
    next_cursor: hasMore && last
      ? encodeDemandCursor({
          reservationDeadline: Number(last.reservation_deadline),
          submittedAt: Number(last.submitted_at),
          id: last.demand_batch_id,
        })
      : null,
  };
}

export async function getBuyerPortalDemand(
  database: SqlDatabase,
  buyer: BuyerPortalContext,
  demandId: string,
  now: number,
): Promise<BuyerPortalDemandDto> {
  assertBuyerBusinessAccess(buyer);
  validateIdentifier(demandId);
  validateNowAndLimit(now, 1);

  const row = await database.prepare(`
    ${PUBLIC_DEMAND_SELECT}
    WHERE ${PUBLIC_DEMAND_WHERE}
      AND demand.id=?
    LIMIT 1
  `).bind(
    buyer.marketplaceCode,
    now,
    now,
    now,
    demandId,
  ).first<DemandRow>();
  if (!row) throw new BuyerPortalError('NOT_FOUND', 404);
  return toDemandDto(row);
}

export async function listBuyerPortalReservations(
  database: SqlDatabase,
  buyer: BuyerPortalContext,
  options: {
    limit: number;
    cursor: ReservationPageCursor | null;
  },
): Promise<BuyerPortalPageDto<BuyerPortalReservationDto>> {
  assertBuyerBusinessAccess(buyer);
  validateNowAndLimit(0, options.limit);

  const cursorSql = options.cursor
    ? `
      AND (
        reservation.submitted_at<?
        OR (
          reservation.submitted_at=?
          AND reservation.id<?
        )
      )
    `
    : '';
  const bindings: unknown[] = [buyer.buyerCustomerId];
  if (options.cursor) {
    bindings.push(
      options.cursor.submittedAt,
      options.cursor.submittedAt,
      options.cursor.id,
    );
  }
  bindings.push(options.limit + 1);

  const result = await database.prepare(`
    ${RESERVATION_SELECT}
    WHERE reservation.buyer_customer_id=?
      ${cursorSql}
    ORDER BY
      reservation.submitted_at DESC,
      reservation.id DESC
    LIMIT ?
  `).bind(...bindings).all<ReservationRow>();

  const hasMore = result.results.length > options.limit;
  const visibleRows = hasMore
    ? result.results.slice(0, options.limit)
    : result.results;
  const last = visibleRows.at(-1) ?? null;
  return {
    items: Object.freeze(visibleRows.map(toReservationDto)),
    next_cursor: hasMore && last
      ? encodeReservationCursor({
          submittedAt: Number(last.submitted_at),
          id: last.reservation_id,
        })
      : null,
  };
}

export async function getBuyerPortalReservation(
  database: SqlDatabase,
  buyer: BuyerPortalContext,
  reservationId: string,
): Promise<BuyerPortalReservationDto> {
  assertBuyerBusinessAccess(buyer);
  validateIdentifier(reservationId);

  const row = await database.prepare(`
    ${RESERVATION_SELECT}
    WHERE reservation.id=?
      AND reservation.buyer_customer_id=?
    LIMIT 1
  `).bind(
    reservationId,
    buyer.buyerCustomerId,
  ).first<ReservationRow>();
  if (!row) throw new BuyerPortalError('NOT_FOUND', 404);
  return toReservationDto(row);
}

function assertBuyerBusinessAccess(
  buyer: BuyerPortalContext,
): void {
  if (buyer.accessStatus !== 'ACTIVE') {
    throw new BuyerPortalError('CUSTOMER_NOT_ACTIVE', 409);
  }
  if (buyer.identityReviewStatus !== 'CLEAR') {
    throw new BuyerPortalError(
      'IDENTITY_REVIEW_REQUIRED',
      409,
    );
  }
}

function validateNowAndLimit(now: number, limit: number): void {
  if (!Number.isSafeInteger(now)
    || now < 0
    || !Number.isSafeInteger(limit)
    || limit < 1
    || limit > 100) {
    throw new BuyerPortalError('VALIDATION_ERROR', 400);
  }
}

function validateIdentifier(value: string): void {
  if (typeof value !== 'string'
    || value.length < 1
    || value.length > 120
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new BuyerPortalError('VALIDATION_ERROR', 400);
  }
}

function toDemandDto(row: DemandRow): BuyerPortalDemandDto {
  return {
    demand_id: row.demand_batch_id,
    marketplace_code: row.marketplace_code,
    asin: row.asin,
    product_name: row.product_name,
    search_keywords: Object.freeze(
      parseStringArray(row.search_keywords_json),
    ),
    product_url: row.product_url,
    buyer_visible_notes: row.buyer_visible_notes,
    store_display_name: row.store_display_name,
    task_type: row.task_type,
    target_quantity: Number(row.target_quantity),
    remaining_quantity: Math.max(
      0,
      Number(row.remaining_quantity),
    ),
    open_at: Number(row.open_at),
    reservation_deadline: Number(row.reservation_deadline),
    order_deadline: Number(row.order_deadline),
  };
}

function toReservationDto(
  row: ReservationRow,
): BuyerPortalReservationDto {
  return {
    reservation_id: row.reservation_id,
    status: row.status,
    version: Number(row.reservation_version),
    submitted_at: Number(row.submitted_at),
    updated_at: Number(row.updated_at),
    hold_expires_at: Number(row.hold_expires_at),
    order_deadline_snapshot:
      Number(row.order_deadline_snapshot),
    decided_at: nullableNumber(row.decided_at),
    cancelled_at: nullableNumber(row.cancelled_at),
    expired_at: nullableNumber(row.expired_at),
    can_cancel: row.status === 'PENDING_REVIEW'
      || row.status === 'APPROVED',
    demand: {
      demand_id: row.demand_batch_id,
      marketplace_code: row.marketplace_code,
      asin: row.asin,
      product_name: row.product_name,
      search_keywords: Object.freeze(
        parseStringArray(row.search_keywords_json),
      ),
      product_url: row.product_url,
      buyer_visible_notes: row.buyer_visible_notes,
      store_display_name: row.store_display_name,
      task_type: row.task_type,
      reservation_deadline:
        Number(row.reservation_deadline),
      order_deadline: Number(row.order_deadline),
    },
  };
}

function nullableNumber(value: number | null): number | null {
  return value === null ? null : Number(value);
}

function parseStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)
      || parsed.some((item) => typeof item !== 'string')) {
      throw new Error('invalid');
    }
    return parsed;
  } catch {
    throw new BuyerPortalError(
      'DEPENDENCY_UNAVAILABLE',
      503,
    );
  }
}
