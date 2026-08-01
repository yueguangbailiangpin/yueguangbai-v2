import type {
  FixedIntegerString,
  SellerFormalOrderPortalDto,
  SellerFormalOrderPortalFilters,
  SellerFormalOrderPortalPage,
  SqlDatabase,
} from '@ygb/contracts';
import type { SellerPortalActor } from '../seller-portal/actor';
import {
  decodeSellerPortalCursor,
  encodeSellerPortalCursor,
  isRecord,
  type SellerPortalPagination,
} from '../seller-portal/pagination';
import { SellerFormalOrderPortalError } from './errors';

interface FormalOrderRow {
  formal_order_id: string;
  status: 'CONFIRMED';
  marketplace_code: 'JP';
  amazon_order_number: string;
  store_id: string;
  store_display_name: string;
  asin: string;
  product_name: string;
  product_version_id: string;
  product_version_no: number;
  review_type: 'RATING' | 'TEXT' | 'IMAGE' | 'VIDEO';
  final_paid_jpy: number | string;
  seller_expected_principal_cny_fen: number | string;
  seller_rate_version_id: string;
  seller_rate_version_no: number;
  seller_cny_per_jpy_e8: number | string;
  seller_rate_effective_from: number;
  seller_rate_confirmed_at: number;
  service_fee_version_id: string;
  service_fee_version_no: number;
  service_fee_effective_from: number;
  service_fee_confirmed_at: number;
  service_fee_cny_fen: number | string;
  confirmed_at: number;
  confirmed_business_date: string;
}

interface FormalOrderCursor {
  confirmed_at: number;
  formal_order_id: string;
}

export async function listSellerFormalOrders(
  database: SqlDatabase,
  actor: SellerPortalActor,
  pagination: SellerPortalPagination,
  filters: SellerFormalOrderPortalFilters,
): Promise<SellerFormalOrderPortalPage> {
  const cursor = decodeSellerPortalCursor(
    pagination.cursor,
    isFormalOrderCursor,
  );
  const scope = storeScope(actor, 'formal_order.store_id');
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (filters.store_id !== null) {
    conditions.push('formal_order.store_id=?');
    values.push(filters.store_id);
  }
  if (filters.marketplace_code !== null) {
    conditions.push('formal_order.marketplace_code=?');
    values.push(filters.marketplace_code);
  }
  if (filters.asin !== null) {
    conditions.push('formal_order.asin_normalized=?');
    values.push(filters.asin);
  }
  if (filters.product_name !== null) {
    conditions.push(
      `formal_order.product_name_snapshot LIKE ? ESCAPE '\\' COLLATE NOCASE`,
    );
    values.push(`%${escapeLike(filters.product_name)}%`);
  }
  if (filters.review_type !== null) {
    conditions.push('formal_order.review_type=?');
    values.push(filters.review_type);
  }
  if (filters.confirmed_business_date !== null) {
    conditions.push('formal_order.confirmed_business_date=?');
    values.push(filters.confirmed_business_date);
  }
  if (filters.formal_order_id !== null) {
    conditions.push('formal_order.id=?');
    values.push(filters.formal_order_id);
  }
  if (filters.amazon_order_number !== null) {
    conditions.push('formal_order.amazon_order_number_normalized=?');
    values.push(filters.amazon_order_number);
  }
  if (cursor !== null) {
    conditions.push(`(
      formal_order.confirmed_at < ?
      OR (
        formal_order.confirmed_at=?
        AND formal_order.id < ?
      )
    )`);
    values.push(
      cursor.confirmed_at,
      cursor.confirmed_at,
      cursor.formal_order_id,
    );
  }

  const extra = conditions.length > 0
    ? `AND ${conditions.join(' AND ')}`
    : '';
  const result = await database.prepare(`
    ${selectFormalOrderProjection()}
    WHERE formal_order.seller_organization_id=?
      ${scope.sql}
      ${extra}
    ORDER BY formal_order.confirmed_at DESC, formal_order.id DESC
    LIMIT ?
  `).bind(
    actor.sellerOrganizationId,
    ...scope.values,
    ...values,
    pagination.limit + 1,
  ).all<FormalOrderRow>();

  const rows = result.results;
  const visible = rows.slice(0, pagination.limit);
  const last = visible.at(-1);
  return Object.freeze({
    items: Object.freeze(visible.map(mapFormalOrder)),
    page: Object.freeze({
      limit: pagination.limit,
      next_cursor: rows.length > pagination.limit && last
        ? encodeSellerPortalCursor({
            confirmed_at: Number(last.confirmed_at),
            formal_order_id: last.formal_order_id,
          })
        : null,
    }),
  });
}

export async function getSellerFormalOrder(
  database: SqlDatabase,
  actor: SellerPortalActor,
  formalOrderId: string,
): Promise<SellerFormalOrderPortalDto> {
  const scope = storeScope(actor, 'formal_order.store_id');
  const row = await database.prepare(`
    ${selectFormalOrderProjection()}
    WHERE formal_order.id=?
      AND formal_order.seller_organization_id=?
      ${scope.sql}
  `).bind(
    formalOrderId,
    actor.sellerOrganizationId,
    ...scope.values,
  ).first<FormalOrderRow>();

  if (!row) {
    throw new SellerFormalOrderPortalError(
      'FORMAL_ORDER_NOT_FOUND',
      404,
    );
  }
  return mapFormalOrder(row);
}

function selectFormalOrderProjection(): string {
  return `
    SELECT
      formal_order.id AS formal_order_id,
      formal_order.status,
      formal_order.marketplace_code,
      formal_order.amazon_order_number_normalized AS amazon_order_number,
      formal_order.store_id,
      store.display_name AS store_display_name,
      formal_order.asin_normalized AS asin,
      formal_order.product_name_snapshot AS product_name,
      formal_order.product_version_id,
      formal_order.product_version_no,
      formal_order.review_type,
      formal_order.final_paid_jpy,
      snapshot.seller_expected_principal_cny_fen,
      snapshot.seller_rate_version_id,
      snapshot.seller_rate_version_no,
      snapshot.seller_cny_per_jpy_e8,
      snapshot.seller_rate_effective_from,
      snapshot.seller_rate_confirmed_at,
      snapshot.service_fee_version_id,
      snapshot.service_fee_version_no,
      snapshot.service_fee_effective_from,
      snapshot.service_fee_confirmed_at,
      snapshot.service_fee_cny_fen,
      formal_order.confirmed_at,
      formal_order.confirmed_business_date
    FROM formal_orders formal_order
    JOIN seller_stores store
      ON store.id=formal_order.store_id
      AND store.organization_id=formal_order.seller_organization_id
    JOIN formal_order_financial_snapshots snapshot
      ON snapshot.formal_order_id=formal_order.id
  `;
}

function storeScope(
  actor: SellerPortalActor,
  column: string,
): { sql: string; values: readonly unknown[] } {
  if (actor.allActiveStores) return { sql: '', values: [] };
  if (actor.storeIds.length === 0) {
    return { sql: 'AND 1=0', values: [] };
  }
  return {
    sql: `AND ${column} IN (${actor.storeIds.map(() => '?').join(', ')})`,
    values: actor.storeIds,
  };
}

function mapFormalOrder(
  row: FormalOrderRow,
): SellerFormalOrderPortalDto {
  return Object.freeze({
    formal_order_id: row.formal_order_id,
    status: row.status,
    marketplace_code: row.marketplace_code,
    amazon_order_number: row.amazon_order_number,
    store: Object.freeze({
      id: row.store_id,
      display_name: row.store_display_name,
    }),
    asin: row.asin,
    product_name: row.product_name,
    product_version: Object.freeze({
      id: row.product_version_id,
      version_no: Number(row.product_version_no),
    }),
    review_type: row.review_type,
    final_paid_jpy: integerString(row.final_paid_jpy),
    seller_expected_principal_cny_fen:
      integerString(row.seller_expected_principal_cny_fen),
    seller_agreement_rate_snapshot: Object.freeze({
      rate_version_id: row.seller_rate_version_id,
      version_no: Number(row.seller_rate_version_no),
      cny_per_jpy_e8: integerString(row.seller_cny_per_jpy_e8),
      effective_from: Number(row.seller_rate_effective_from),
      confirmed_at: Number(row.seller_rate_confirmed_at),
    }),
    locked_service_fee_snapshot: Object.freeze({
      fee_version_id: row.service_fee_version_id,
      version_no: Number(row.service_fee_version_no),
      review_type: row.review_type,
      service_fee_cny_fen: integerString(row.service_fee_cny_fen),
      effective_from: Number(row.service_fee_effective_from),
      confirmed_at: Number(row.service_fee_confirmed_at),
    }),
    confirmed_at: Number(row.confirmed_at),
    confirmed_business_date: row.confirmed_business_date,
  });
}

function integerString(value: number | string): FixedIntegerString {
  const serialized = String(value);
  if (!/^(0|[1-9][0-9]*)$/u.test(serialized)) {
    throw new SellerFormalOrderPortalError(
      'DEPENDENCY_UNAVAILABLE',
      503,
    );
  }
  return serialized;
}

function escapeLike(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('%', '\\%')
    .replaceAll('_', '\\_');
}

function isFormalOrderCursor(
  value: unknown,
): value is FormalOrderCursor {
  return isRecord(value)
    && Number.isSafeInteger(value['confirmed_at'])
    && Number(value['confirmed_at']) >= 0
    && typeof value['formal_order_id'] === 'string';
}
