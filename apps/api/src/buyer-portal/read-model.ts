import type {
  BuyerPortalDemandDto,
  BuyerPortalPageDto,
  BuyerPortalReservationDto,
  DemandTaskType,
  ReservationStatus,
  SqlDatabase,
} from '@ygb/contracts';
import {
  calculateBuyerSelfPayFacts,
  fixedIntegerString,
  parseJpyInteger,
} from '@ygb/domain';
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
  demand_version: number;
  marketplace_code: 'JP';
  product_name: string;
  main_image_file_object_id: string | null;
  main_image_file_version: number | null;
  reference_order_amount_jpy: number;
  buyer_self_pay_bps: number;
  buyer_visible_notes: string | null;
  store_display_name: string;
  task_type: DemandTaskType;
  target_quantity: number;
  remaining_quantity: number;
  open_at: number;
  reservation_deadline: number;
  order_deadline: number;
  submitted_at: number;
  reservation_eligibility:
    | 'ELIGIBLE'
    | 'INELIGIBLE_ACTIVE_STORE_RESERVATION';
}

interface ReservationRow {
  reservation_id: string;
  status: ReservationStatus;
  reservation_version: number;
  submitted_at: number;
  updated_at: number;
  hold_expires_at: number;
  order_deadline_snapshot: number;
  buyer_self_pay_bps_snapshot: number;
  reference_order_amount_jpy_snapshot: number;
  estimated_self_pay_jpy_snapshot: number;
  estimated_refundable_principal_jpy_snapshot: number;
  buyer_self_pay_accepted_at: number;
  buyer_self_pay_accepted_demand_version: number;
  decided_at: number | null;
  cancelled_at: number | null;
  expired_at: number | null;
  demand_batch_id: string;
  demand_version: number;
  marketplace_code: 'JP';
  product_name: string;
  reference_order_amount_jpy: number;
  buyer_self_pay_bps: number;
  buyer_visible_notes: string | null;
  store_display_name: string;
  task_type: DemandTaskType;
  reservation_deadline: number;
  order_deadline: number;
}

const PUBLIC_DEMAND_SELECT = `
  SELECT
    demand.id AS demand_batch_id,
    demand.version AS demand_version,
    demand.marketplace_code,
    version.product_name,
    main_image_object.id AS main_image_file_object_id,
    main_image_object.version AS main_image_file_version,
    version.ordering_guide_expected_amount_jpy AS reference_order_amount_jpy,
    demand.buyer_self_pay_bps_snapshot AS buyer_self_pay_bps,
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
    demand.submitted_at,
    CASE WHEN EXISTS (
      SELECT 1
      FROM product_reservations active_store_reservation
      WHERE active_store_reservation.buyer_customer_id=?
        AND active_store_reservation.store_id=demand.store_id
        AND active_store_reservation.status IN ('PENDING_REVIEW', 'APPROVED')
    ) THEN 'INELIGIBLE_ACTIVE_STORE_RESERVATION'
      ELSE 'ELIGIBLE'
    END AS reservation_eligibility
  FROM demand_batches demand
  JOIN products product
    ON product.id=demand.product_id
    AND product.organization_id=demand.organization_id
    AND product.store_id=demand.store_id
    AND product.marketplace_code=demand.marketplace_code
  JOIN product_versions version
    ON version.product_id=demand.product_id
      AND version.version_no=demand.product_version_no
  LEFT JOIN product_version_main_images main_image
    ON main_image.product_version_id=version.id
  LEFT JOIN file_entity_links main_image_link
    ON main_image_link.id=main_image.file_entity_link_id
    AND main_image_link.entity_type='PRODUCT_VERSION'
    AND main_image_link.entity_id=version.id
    AND main_image_link.purpose='PRODUCT_IMAGE'
    AND main_image_link.authorization_mode='EXPLICIT_AUDIENCES'
    AND main_image_link.revoked_at IS NULL
  LEFT JOIN file_objects main_image_object
    ON main_image_object.id=main_image_link.file_object_id
    AND main_image_object.status='VERIFIED'
    AND EXISTS (
      SELECT 1
      FROM file_upload_intents main_image_intent
      WHERE main_image_intent.id=main_image_object.upload_intent_id
        AND main_image_intent.status='VERIFIED'
    )
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
  AND (
    demand.held_reservation_count
    + demand.approved_reservation_count
  ) < demand.target_quantity
  AND NOT EXISTS (
    SELECT 1
    FROM product_reservations existing
    WHERE existing.demand_batch_id=demand.id
      AND existing.buyer_customer_id=?
  )
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
    reservation.buyer_self_pay_bps_snapshot,
    reservation.reference_order_amount_jpy_snapshot,
    reservation.estimated_self_pay_jpy_snapshot,
    reservation.estimated_refundable_principal_jpy_snapshot,
    reservation.buyer_self_pay_accepted_at,
    reservation.buyer_self_pay_accepted_demand_version,
    reservation.decided_at,
    reservation.cancelled_at,
    reservation.expired_at,
    demand.id AS demand_batch_id,
    demand.version AS demand_version,
    demand.marketplace_code,
    version.product_name,
    reservation.reference_order_amount_jpy_snapshot AS reference_order_amount_jpy,
    reservation.buyer_self_pay_bps_snapshot AS buyer_self_pay_bps,
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
    buyer.buyerCustomerId,
    buyer.marketplaceCode,
    options.now,
    options.now,
    options.now,
    buyer.buyerCustomerId,
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
    buyer.buyerCustomerId,
    buyer.marketplaceCode,
    now,
    now,
    now,
    buyer.buyerCustomerId,
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
  const estimate = calculateBuyerSelfPayFacts(
    parseJpyInteger(String(row.reference_order_amount_jpy)),
    Number(row.buyer_self_pay_bps),
  );
  return {
    demand_id: row.demand_batch_id,
    demand_version: Number(row.demand_version),
    reference_order_amount_jpy: fixedIntegerString(
      parseJpyInteger(String(row.reference_order_amount_jpy)),
    ),
    buyer_self_pay_bps: Number(row.buyer_self_pay_bps),
    estimated_buyer_self_pay_jpy: fixedIntegerString(
      estimate.buyerSelfPayJpy,
    ),
    estimated_refundable_principal_jpy: fixedIntegerString(
      estimate.refundablePrincipalJpy,
    ),
    marketplace_code: row.marketplace_code,
    product_name: row.product_name,
    main_image: row.main_image_file_object_id === null
      || row.main_image_file_version === null
      ? null
      : {
          file_object_id: row.main_image_file_object_id,
          file_version: Number(row.main_image_file_version),
          purpose: 'PRODUCT_IMAGE',
          visibility: 'SELLER_VISIBLE',
        },
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
    reservation_eligibility: row.reservation_eligibility,
    reservation_ineligibility_reason:
      row.reservation_eligibility === 'ELIGIBLE'
        ? null
        : 'ACTIVE_STORE_RESERVATION',
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
    buyer_self_pay_bps_snapshot: Number(row.buyer_self_pay_bps_snapshot),
    reference_order_amount_jpy_snapshot: String(
      row.reference_order_amount_jpy_snapshot,
    ),
    estimated_self_pay_jpy_snapshot: String(
      row.estimated_self_pay_jpy_snapshot,
    ),
    estimated_refundable_principal_jpy_snapshot: String(
      row.estimated_refundable_principal_jpy_snapshot,
    ),
    buyer_self_pay_accepted_at: Number(row.buyer_self_pay_accepted_at),
    buyer_self_pay_accepted_demand_version: Number(
      row.buyer_self_pay_accepted_demand_version,
    ),
    decided_at: nullableNumber(row.decided_at),
    cancelled_at: nullableNumber(row.cancelled_at),
    expired_at: nullableNumber(row.expired_at),
    can_cancel: row.status === 'PENDING_REVIEW'
      || row.status === 'APPROVED',
    demand: {
      demand_id: row.demand_batch_id,
      demand_version: Number(row.demand_version),
      marketplace_code: row.marketplace_code,
      product_name: row.product_name,
      reference_order_amount_jpy: String(row.reference_order_amount_jpy),
      buyer_self_pay_bps: Number(row.buyer_self_pay_bps),
      estimated_buyer_self_pay_jpy: String(row.estimated_self_pay_jpy_snapshot),
      estimated_refundable_principal_jpy: String(
        row.estimated_refundable_principal_jpy_snapshot,
      ),
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
