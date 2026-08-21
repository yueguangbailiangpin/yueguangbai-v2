import type {
  DemandOrderScheduleVersionDto,
  ReservationStatus,
  SqlDatabase,
  StaffProductDetailDto,
  StaffProductListItemDto,
  StaffProductPageDto,
  StaffProductVersionDto,
  StaffReservationScheduleItemDto,
  StaffReservationSchedulePageDto,
} from '@ygb/contracts';
import {
  PRODUCT_SCHEDULE_TIMEZONE,
} from '@ygb/contracts';
import { plannedOrderDate } from '@ygb/domain';
import { scopeAllowsBuyer } from '../staff-assignment';
import {
  canViewDemand,
  canViewProduct,
  cleanScheduleIdentifier,
  decodeScheduleCursor,
  encodeScheduleCursor,
  placeholders,
  requireScheduleView,
  SchedulingError,
  type SchedulingStaffActor,
} from './shared';

interface ProductRow {
  product_id: string;
  seller_organization_id: string;
  store_id: string;
  store_name: string;
  marketplace_code: string;
  asin: string;
  status: 'ACTIVE' | 'DISABLED';
  aggregate_version: number;
  current_version_no: number;
  product_name: string;
  order_interval_days: number | null;
  orders_per_run: number | null;
  updated_at: number;
}

interface ProductVersionRow {
  product_version_id: string;
  version_no: number;
  product_name: string;
  search_keywords_json: string;
  ordering_guide_expected_amount_jpy: number;
  color_spec_mode: 'MAIN_IMAGE_VARIANT' | 'ANY_VARIANT';
  default_buyer_self_pay_bps: number;
  product_url: string | null;
  buyer_visible_notes: string | null;
  internal_notes: string | null;
  order_interval_days: number | null;
  orders_per_run: number | null;
  created_at: number;
  main_image_file_object_id: string | null;
  main_image_file_version: number | null;
  main_image_client_file_name: string | null;
  main_image_bound_at: number | null;
}

interface DemandRow {
  demand_batch_id: string;
  status: StaffProductDetailDto['demands'][number]['status'];
  target_quantity: number;
  effective_reservation_count: number;
  order_deadline: number;
  demand_version: number;
  schedule_version: number | null;
  first_order_date: string | null;
}

export interface DemandHeaderRow {
  demand_batch_id: string;
  seller_organization_id: string;
  product_id: string;
  source_product_version_id: string;
  status: string;
  product_name: string;
  target_quantity: number;
  order_deadline: number;
  demand_version: number;
  schedule_version_id: string | null;
  schedule_version: number | null;
  schedule_demand_version: number | null;
  first_order_date: string | null;
  order_interval_days: number | null;
  orders_per_run: number | null;
  theoretical_last_order_date: string | null;
  affected_reservation_count: number | null;
  preview_hash: string | null;
  change_reason: string | null;
  changed_by_staff_id: string | null;
  schedule_created_at: number | null;
  effective_reservation_count: number;
}

interface ReservationRow {
  reservation_id: string;
  buyer_customer_id: string;
  buyer_customer_no: string | null;
  buyer_display_name: string;
  status: ReservationStatus;
  submitted_at: number;
  queue_rank: number | null;
  evidence_status: string | null;
  formal_order_status: string | null;
  evidence_order_date: string | null;
  formal_order_date: string | null;
}

export async function listStaffProducts(
  database: SqlDatabase,
  actor: SchedulingStaffActor,
  query: { limit: number; cursor?: string; search?: string },
): Promise<StaffProductPageDto> {
  requireScheduleView(actor);
  const cursor = decodeScheduleCursor('product', query.cursor);
  const scope = actor.dataScope;
  const visibility = scope.type === 'GLOBAL'
    ? '1=1'
    : `(
        product.organization_id IN (${placeholders(scope.sellerOrganizationIds)})
        OR EXISTS (
          SELECT 1 FROM product_reservations visible_reservation
          WHERE visible_reservation.product_id=product.id
            AND visible_reservation.buyer_customer_id IN (
              ${placeholders(scope.buyerCustomerIds)}
            )
        )
      )`;
  const search = query.search?.normalize('NFKC').trim() ?? '';
  if (search.length > 200 || /[\u0000-\u001f\u007f]/u.test(search)) {
    throw new SchedulingError('VALIDATION_ERROR', 400);
  }
  const searchSql = search
    ? `AND (
        version.product_name LIKE ? ESCAPE '\\'
        OR product.asin_normalized LIKE ? ESCAPE '\\'
        OR store.display_name LIKE ? ESCAPE '\\'
      )`
    : '';
  const cursorSql = cursor
    ? 'AND (product.updated_at<? OR (product.updated_at=? AND product.id<?))'
    : '';
  const pattern = `%${escapeLike(search)}%`;
  const result = await database.prepare(`
    SELECT
      product.id AS product_id,
      product.organization_id AS seller_organization_id,
      product.store_id,
      store.display_name AS store_name,
      product.marketplace_code,
      product.asin_display AS asin,
      product.status,
      product.version AS aggregate_version,
      product.current_version_no,
      version.product_name,
      version.order_interval_days,
      version.orders_per_run,
      product.updated_at
    FROM products product
    JOIN seller_stores store ON store.id=product.store_id
    JOIN product_versions version
      ON version.product_id=product.id
      AND version.version_no=product.current_version_no
    WHERE ${visibility}
      ${searchSql}
      ${cursorSql}
    ORDER BY product.updated_at DESC, product.id DESC
    LIMIT ?
  `).bind(
    ...(scope.type === 'GLOBAL'
      ? []
      : [...scope.sellerOrganizationIds, ...scope.buyerCustomerIds]),
    ...(search ? [pattern, pattern, pattern] : []),
    ...(cursor ? [cursor.at, cursor.at, cursor.id] : []),
    query.limit + 1,
  ).all<ProductRow>();
  const hasMore = result.results.length > query.limit;
  const rows = hasMore ? result.results.slice(0, query.limit) : result.results;
  const last = rows.at(-1);
  return {
    items: rows.map(productDto),
    next_cursor: hasMore && last
      ? encodeScheduleCursor('product', {
          at: Number(last.updated_at), id: last.product_id,
        })
      : null,
    data_as_of: Date.now(),
  };
}

export async function readStaffProduct(
  database: SqlDatabase,
  actor: SchedulingStaffActor,
  rawProductId: string,
): Promise<StaffProductDetailDto> {
  requireScheduleView(actor);
  const productId = cleanScheduleIdentifier(rawProductId);
  const product = await database.prepare(`
    SELECT
      product.id AS product_id,
      product.organization_id AS seller_organization_id,
      product.store_id,
      store.display_name AS store_name,
      product.marketplace_code,
      product.asin_display AS asin,
      product.status,
      product.version AS aggregate_version,
      product.current_version_no,
      version.product_name,
      version.order_interval_days,
      version.orders_per_run,
      product.updated_at
    FROM products product
    JOIN seller_stores store ON store.id=product.store_id
    JOIN product_versions version
      ON version.product_id=product.id
      AND version.version_no=product.current_version_no
    WHERE product.id=?
  `).bind(productId).first<ProductRow>();
  if (!product || !await canViewProduct(
    database, actor, productId, product.seller_organization_id,
  )) throw new SchedulingError('NOT_FOUND', 404);

  const [versions, demands] = await Promise.all([
    database.prepare(`
      SELECT
        version.id AS product_version_id, version.version_no, version.product_name,
        version.search_keywords_json, version.ordering_guide_expected_amount_jpy,
        version.color_spec_mode, version.default_buyer_self_pay_bps, version.product_url,
        version.buyer_visible_notes, version.internal_notes,
        version.order_interval_days, version.orders_per_run, version.created_at,
        image_link.file_object_id AS main_image_file_object_id,
        image_file.version AS main_image_file_version,
        image_file.client_file_name AS main_image_client_file_name,
        main_image.created_at AS main_image_bound_at
      FROM product_versions version
      LEFT JOIN product_version_main_images main_image
        ON main_image.product_version_id=version.id
      LEFT JOIN file_entity_links image_link
        ON image_link.id=main_image.file_entity_link_id
        AND image_link.entity_type='PRODUCT_VERSION'
        AND image_link.entity_id=version.id
        AND image_link.purpose='PRODUCT_IMAGE'
        AND image_link.revoked_at IS NULL
      LEFT JOIN file_objects image_file
        ON image_file.id=image_link.file_object_id
        AND image_file.status='VERIFIED'
        AND image_file.purpose='PRODUCT_IMAGE'
      WHERE version.product_id=?
      ORDER BY version.version_no DESC
    `).bind(productId).all<ProductVersionRow>(),
    database.prepare(`
      SELECT
        demand.id AS demand_batch_id,
        demand.status,
        demand.target_quantity,
        SUM(CASE WHEN reservation.status IN ('PENDING_REVIEW','APPROVED')
          THEN 1 ELSE 0 END) AS effective_reservation_count,
        demand.order_deadline,
        demand.version AS demand_version,
        schedule.version_no AS schedule_version,
        schedule.first_order_date
      FROM demand_batches demand
      LEFT JOIN product_reservations reservation
        ON reservation.demand_batch_id=demand.id
      LEFT JOIN demand_order_schedule_versions schedule
        ON schedule.id=(
          SELECT latest.id
          FROM demand_order_schedule_versions latest
          WHERE latest.demand_batch_id=demand.id
          ORDER BY latest.version_no DESC
          LIMIT 1
        )
      WHERE demand.product_id=?
      GROUP BY demand.id
      ORDER BY demand.submitted_at DESC, demand.id DESC
      LIMIT 100
    `).bind(productId).all<DemandRow>(),
  ]);
  return {
    ...productDto(product),
    versions: versions.results.map(versionDto),
    demands: demands.results.map((row) => ({
      ...row,
      target_quantity: Number(row.target_quantity),
      effective_reservation_count: Number(row.effective_reservation_count),
      order_deadline: Number(row.order_deadline),
      demand_version: Number(row.demand_version),
      schedule_version: row.schedule_version === null
        ? null : Number(row.schedule_version),
    })),
    timezone: PRODUCT_SCHEDULE_TIMEZONE,
    data_as_of: Date.now(),
  };
}

export async function readStaffReservationSchedule(
  database: SqlDatabase,
  actor: SchedulingStaffActor,
  rawDemandBatchId: string,
  query: { limit: number; cursor?: string },
): Promise<StaffReservationSchedulePageDto> {
  requireScheduleView(actor);
  const demandBatchId = cleanScheduleIdentifier(rawDemandBatchId);
  const cursor = decodeScheduleCursor('reservation', query.cursor);
  const header = await readDemandHeader(database, demandBatchId);
  if (!header || !await canViewDemand(
    database, actor, demandBatchId, header.seller_organization_id,
  )) throw new SchedulingError('NOT_FOUND', 404);

  const rows = await database.prepare(`
    WITH ranked AS (
      SELECT
        reservation.id AS reservation_id,
        reservation.buyer_customer_id,
        customer.buyer_customer_no,
        customer.display_name AS buyer_display_name,
        reservation.status,
        reservation.submitted_at,
        CASE WHEN reservation.status IN ('PENDING_REVIEW','APPROVED')
          THEN SUM(CASE WHEN reservation.status IN ('PENDING_REVIEW','APPROVED')
            THEN 1 ELSE 0 END) OVER (
              ORDER BY reservation.submitted_at ASC, reservation.id ASC
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            )
          ELSE NULL
        END AS queue_rank,
        evidence.status AS evidence_status,
        formal_order.status AS formal_order_status,
        evidence_version.amazon_order_date AS evidence_order_date,
        formal_order.amazon_order_date AS formal_order_date
      FROM product_reservations reservation
      JOIN buyer_customers customer ON customer.id=reservation.buyer_customer_id
      LEFT JOIN order_evidence_submissions evidence
        ON evidence.reservation_id=reservation.id
      LEFT JOIN order_evidence_versions evidence_version
        ON evidence_version.submission_id=evidence.id
        AND evidence_version.version_no=evidence.current_version_no
      LEFT JOIN formal_orders formal_order
        ON formal_order.reservation_id=reservation.id
      WHERE reservation.demand_batch_id=?
    )
    SELECT * FROM ranked
    WHERE 1=1
      ${cursor
        ? 'AND (submitted_at>? OR (submitted_at=? AND reservation_id>?))'
        : ''}
    ORDER BY submitted_at ASC, reservation_id ASC
    LIMIT ?
  `).bind(
    demandBatchId,
    ...(cursor ? [cursor.at, cursor.at, cursor.id] : []),
    query.limit + 1,
  ).all<ReservationRow>();
  const hasMore = rows.results.length > query.limit;
  const page = hasMore ? rows.results.slice(0, query.limit) : rows.results;
  const last = page.at(-1);
  const schedule = headerSchedule(header);
  return {
    demand: {
      demand_batch_id: demandBatchId,
      product_id: header.product_id,
      product_name: header.product_name,
      target_quantity: Number(header.target_quantity),
      effective_reservation_count: Number(header.effective_reservation_count),
      order_deadline: Number(header.order_deadline),
      demand_version: Number(header.demand_version),
      schedule,
    },
    items: page.map((row) => reservationDto(row, actor, schedule)),
    next_cursor: hasMore && last
      ? encodeScheduleCursor('reservation', {
          at: Number(last.submitted_at), id: last.reservation_id,
        })
      : null,
    timezone: PRODUCT_SCHEDULE_TIMEZONE,
    sorting: 'submitted_at ASC, id ASC',
    data_as_of: Date.now(),
  };
}

export async function readDemandHeader(
  database: SqlDatabase,
  demandBatchId: string,
): Promise<DemandHeaderRow | null> {
  return database.prepare(`
    SELECT
      demand.id AS demand_batch_id,
      demand.organization_id AS seller_organization_id,
      demand.product_id,
      version.id AS source_product_version_id,
      demand.status,
      version.product_name,
      demand.target_quantity,
      demand.order_deadline,
      demand.version AS demand_version,
      schedule.id AS schedule_version_id,
      schedule.version_no AS schedule_version,
      schedule.demand_version AS schedule_demand_version,
      schedule.first_order_date,
      schedule.order_interval_days,
      schedule.orders_per_run,
      schedule.theoretical_last_order_date,
      schedule.affected_reservation_count,
      schedule.preview_hash,
      schedule.change_reason,
      schedule.changed_by_staff_id,
      schedule.created_at AS schedule_created_at,
      (
        SELECT COUNT(*) FROM product_reservations reservation
        WHERE reservation.demand_batch_id=demand.id
          AND reservation.status IN ('PENDING_REVIEW','APPROVED')
      ) AS effective_reservation_count
    FROM demand_batches demand
    JOIN product_versions version
      ON version.product_id=demand.product_id
      AND version.version_no=demand.product_version_no
    LEFT JOIN demand_order_schedule_versions schedule
      ON schedule.id=(
        SELECT latest.id
        FROM demand_order_schedule_versions latest
        WHERE latest.demand_batch_id=demand.id
        ORDER BY latest.version_no DESC
        LIMIT 1
      )
    WHERE demand.id=?
  `).bind(demandBatchId).first<DemandHeaderRow>();
}

function productDto(row: ProductRow): StaffProductListItemDto {
  return {
    product_id: row.product_id,
    seller_organization_id: row.seller_organization_id,
    store_id: row.store_id,
    store_name: row.store_name,
    marketplace_code: row.marketplace_code,
    asin: row.asin,
    status: row.status,
    aggregate_version: Number(row.aggregate_version),
    current_version_no: Number(row.current_version_no),
    product_name: row.product_name,
    cadence: row.order_interval_days === null || row.orders_per_run === null
      ? null
      : {
          order_interval_days: Number(row.order_interval_days),
          orders_per_run: Number(row.orders_per_run),
        },
    updated_at: Number(row.updated_at),
  };
}

function versionDto(row: ProductVersionRow): StaffProductVersionDto {
  let searchKeywords: readonly string[] = [];
  try {
    const parsed = JSON.parse(row.search_keywords_json) as unknown;
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
      searchKeywords = parsed;
    }
  } catch { /* Migration constraints protect new rows; legacy stays readable. */ }
  return {
    product_version_id: row.product_version_id,
    version_no: Number(row.version_no),
    product_name: row.product_name,
    search_keywords: searchKeywords,
    ordering_guide_expected_amount_jpy:
      Number(row.ordering_guide_expected_amount_jpy),
    color_spec_mode: row.color_spec_mode,
    default_buyer_self_pay_bps: Number(row.default_buyer_self_pay_bps),
    product_url: row.product_url,
    buyer_visible_notes: row.buyer_visible_notes,
    internal_notes: row.internal_notes,
    cadence: row.order_interval_days === null || row.orders_per_run === null
      ? null
      : {
          order_interval_days: Number(row.order_interval_days),
          orders_per_run: Number(row.orders_per_run),
        },
    main_image: row.main_image_file_object_id === null
      || row.main_image_file_version === null
      || row.main_image_bound_at === null
      ? null
      : {
          file_object_id: row.main_image_file_object_id,
          file_version: Number(row.main_image_file_version),
          client_file_name: row.main_image_client_file_name ?? '',
          bound_at: Number(row.main_image_bound_at),
        },
    created_at: Number(row.created_at),
  };
}

function headerSchedule(
  row: DemandHeaderRow,
): DemandOrderScheduleVersionDto | null {
  if (row.schedule_version_id === null
    || row.schedule_version === null
    || row.schedule_demand_version === null
    || row.first_order_date === null
    || row.order_interval_days === null
    || row.orders_per_run === null
    || row.theoretical_last_order_date === null
    || row.affected_reservation_count === null
    || row.preview_hash === null
    || row.change_reason === null
    || row.changed_by_staff_id === null
    || row.schedule_created_at === null) return null;
  return {
    schedule_version_id: row.schedule_version_id,
    version_no: Number(row.schedule_version),
    demand_version: Number(row.schedule_demand_version),
    first_order_date: row.first_order_date,
    order_interval_days: Number(row.order_interval_days),
    orders_per_run: Number(row.orders_per_run),
    theoretical_last_order_date: row.theoretical_last_order_date,
    affected_reservation_count: Number(row.affected_reservation_count),
    preview_hash: row.preview_hash,
    change_reason: row.change_reason,
    changed_by_staff_id: row.changed_by_staff_id,
    created_at: Number(row.schedule_created_at),
  };
}

function reservationDto(
  row: ReservationRow,
  actor: SchedulingStaffActor,
  schedule: DemandOrderScheduleVersionDto | null,
): StaffReservationScheduleItemDto {
  const inBuyerScope = scopeAllowsBuyer(
    actor.dataScope, row.buyer_customer_id,
  );
  const rank = row.queue_rank === null ? null : Number(row.queue_rank);
  return {
    reservation_id: row.reservation_id,
    status: row.status,
    submitted_at: Number(row.submitted_at),
    rank,
    planned_order_date: rank === null || schedule === null
      ? null
      : plannedOrderDate({
          firstOrderDate: schedule.first_order_date,
          rank,
          orderIntervalDays: schedule.order_interval_days,
          ordersPerRun: schedule.orders_per_run,
        }),
    buyer_reference: row.buyer_customer_no ?? row.reservation_id,
    buyer_customer_id: inBuyerScope ? row.buyer_customer_id : null,
    buyer_display_name: inBuyerScope ? row.buyer_display_name : null,
    actual_order_status: row.formal_order_status ?? row.evidence_status,
    actual_order_date: row.formal_order_date ?? row.evidence_order_date,
  };
}

function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%')
    .replaceAll('_', '\\_');
}
