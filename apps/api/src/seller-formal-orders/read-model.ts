import type {
  FixedIntegerString,
  SellerFormalOrderPortalDto,
  SellerFormalOrderPortalFilters,
  SellerFormalOrderPortalPage,
  SqlDatabase,
} from '@ygb/contracts';
import { sellerBusinessCompletion } from '@ygb/domain';
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
  canonical_marketplace_code: 'AMAZON_JP' | 'AMAZON_US' | 'COUPANG_KR';
  amazon_order_number: string;
  platform_order_identifier: string;
  store_id: string;
  store_display_name: string;
  asin: string;
  platform_product_identifier: string;
  product_name: string;
  product_version_id: string;
  product_version_no: number;
  review_type: 'RATING' | 'TEXT' | 'IMAGE' | 'VIDEO';
  final_paid_jpy: number | string;
  payment_amount_minor: number | string;
  payment_currency_code: 'JPY' | 'USD' | 'KRW' | 'CNY';
  payment_currency_exponent: 0 | 2;
  source_currency_code: 'JPY' | 'USD' | 'KRW' | 'CNY';
  quote_currency_code: 'CNY';
  source_currency_exponent: 0 | 2;
  quote_currency_exponent: 2;
  seller_rate_value: number | string;
  seller_rate_scale: number | string;
  rounding_rule: 'HALF_UP';
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
  refund_expected_cny_fen: number | string;
  review_status: string | null;
  buyer_refund_status: string | null;
  principal_status: string | null;
  service_fee_status: string | null;
  chat_screenshot_status: 'AVAILABLE' | 'NONE';
  chat_screenshot_file_version: number | null;
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
      generic.marketplace_code AS canonical_marketplace_code,
      formal_order.amazon_order_number_normalized AS amazon_order_number,
      generic.platform_order_identifier,
      formal_order.store_id,
      store.display_name AS store_display_name,
      formal_order.asin_normalized AS asin,
      generic.platform_product_identifier,
      formal_order.product_name_snapshot AS product_name,
      formal_order.product_version_id,
      formal_order.product_version_no,
      formal_order.review_type,
      formal_order.final_paid_jpy,
      generic.payment_amount_minor,
      generic.payment_currency_code,
      generic.payment_currency_exponent,
      snapshot.seller_expected_principal_cny_fen,
      snapshot.seller_rate_version_id,
      snapshot.seller_rate_version_no,
      snapshot.seller_cny_per_jpy_e8,
      generic.source_currency_code,
      generic.quote_currency_code,
      generic.source_currency_exponent,
      generic.quote_currency_exponent,
      generic.seller_rate_value,
      generic.seller_rate_scale,
      generic.rounding_rule,
      snapshot.seller_rate_effective_from,
      snapshot.seller_rate_confirmed_at,
      snapshot.service_fee_version_id,
      snapshot.service_fee_version_no,
      snapshot.service_fee_effective_from,
      snapshot.service_fee_confirmed_at,
      snapshot.service_fee_cny_fen,
      generic.buyer_expected_principal_amount_minor
        AS refund_expected_cny_fen,
      (SELECT review.status FROM review_cases review
        WHERE review.formal_order_id=formal_order.id) AS review_status,
      (SELECT refund.status FROM buyer_refund_ledger_balances refund
        WHERE refund.formal_order_id=formal_order.id) AS buyer_refund_status,
      (SELECT payable.derived_status FROM seller_payable_balances payable
        WHERE payable.formal_order_id=formal_order.id
          AND payable.payable_type='SELLER_PRINCIPAL') AS principal_status,
      (SELECT payable.derived_status FROM seller_payable_balances payable
        WHERE payable.formal_order_id=formal_order.id
          AND payable.payable_type='SELLER_SERVICE_FEE') AS service_fee_status,
      (SELECT file_object.version
        FROM order_evidence_internal_files attachment
        JOIN file_objects file_object ON file_object.id=attachment.file_object_id
        JOIN file_upload_intents upload_intent
          ON upload_intent.id=file_object.upload_intent_id
          AND upload_intent.status='VERIFIED'
        JOIN file_entity_links file_link ON file_link.id=attachment.file_entity_link_id
        JOIN file_entity_audience_grants audience_grant
          ON audience_grant.file_entity_link_id=file_link.id
          AND audience_grant.subject_type='SELLER_ORGANIZATION'
          AND audience_grant.seller_organization_id=
            formal_order.seller_organization_id
          AND audience_grant.revoked_at IS NULL
          AND (audience_grant.expires_at IS NULL
            OR audience_grant.expires_at>CAST(unixepoch('now') AS INTEGER)*1000)
        WHERE attachment.order_evidence_submission_id=
          formal_order.order_evidence_submission_id
          AND attachment.slot=1
          AND store.status='ACTIVE'
          AND file_object.status='VERIFIED'
          AND file_link.file_object_id=attachment.file_object_id
          AND file_link.entity_type='ORDER_EVIDENCE_SUBMISSION'
          AND file_link.entity_id=formal_order.order_evidence_submission_id
          AND file_link.purpose='ORDER_EVIDENCE_INTERNAL_COMMUNICATION'
          AND file_link.visibility='SELLER_VISIBLE'
          AND file_link.authorization_mode='EXPLICIT_AUDIENCES'
          AND file_link.revoked_at IS NULL
          AND (file_link.expires_at IS NULL OR file_link.expires_at>CAST(unixepoch('now') AS INTEGER)*1000)
        LIMIT 1) AS chat_screenshot_file_version,
      CASE WHEN EXISTS (
        SELECT 1
        FROM order_evidence_internal_files attachment
        JOIN file_entity_links file_link
          ON file_link.id=attachment.file_entity_link_id
          AND file_link.file_object_id=attachment.file_object_id
          AND file_link.entity_type='ORDER_EVIDENCE_SUBMISSION'
          AND file_link.entity_id=formal_order.order_evidence_submission_id
          AND file_link.purpose='ORDER_EVIDENCE_INTERNAL_COMMUNICATION'
          AND file_link.visibility='SELLER_VISIBLE'
          AND file_link.authorization_mode='EXPLICIT_AUDIENCES'
          AND file_link.revoked_at IS NULL
          AND (file_link.expires_at IS NULL OR file_link.expires_at>CAST(unixepoch('now') AS INTEGER)*1000)
        JOIN file_objects file_object
          ON file_object.id=attachment.file_object_id
          AND file_object.status='VERIFIED'
        JOIN file_upload_intents upload_intent
          ON upload_intent.id=file_object.upload_intent_id
          AND upload_intent.status='VERIFIED'
        JOIN file_entity_audience_grants audience_grant
          ON audience_grant.file_entity_link_id=file_link.id
          AND audience_grant.subject_type='SELLER_ORGANIZATION'
          AND audience_grant.seller_organization_id=
            formal_order.seller_organization_id
          AND audience_grant.revoked_at IS NULL
          AND (audience_grant.expires_at IS NULL
            OR audience_grant.expires_at>CAST(unixepoch('now') AS INTEGER)*1000)
        WHERE attachment.order_evidence_submission_id=
          formal_order.order_evidence_submission_id
          AND attachment.slot=1
          AND store.status='ACTIVE'
      ) THEN 'AVAILABLE' ELSE 'NONE' END AS chat_screenshot_status,
      formal_order.confirmed_at,
      formal_order.confirmed_business_date
    FROM formal_orders formal_order
    JOIN seller_stores store
      ON store.id=formal_order.store_id
      AND store.organization_id=formal_order.seller_organization_id
    JOIN formal_order_financial_snapshots snapshot
      ON snapshot.formal_order_id=formal_order.id
    JOIN formal_order_marketplace_money_snapshots generic
      ON generic.formal_order_id=formal_order.id
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
    canonical_marketplace_code: row.canonical_marketplace_code,
    amazon_order_number: row.amazon_order_number,
    platform_order_identifier: row.platform_order_identifier,
    store: Object.freeze({
      id: row.store_id,
      display_name: row.store_display_name,
    }),
    asin: row.asin,
    platform_product_identifier: row.platform_product_identifier,
    product_name: row.product_name,
    product_version: Object.freeze({
      id: row.product_version_id,
      version_no: Number(row.product_version_no),
    }),
    review_type: row.review_type,
    final_paid_jpy: integerString(row.final_paid_jpy),
    payment: Object.freeze({
      amount_minor: integerString(row.payment_amount_minor),
      currency_code: row.payment_currency_code,
      currency_exponent: Number(row.payment_currency_exponent) as 0 | 2,
    }),
    seller_expected_principal_cny_fen:
      integerString(row.seller_expected_principal_cny_fen),
    seller_agreement_rate_snapshot: Object.freeze({
      rate_version_id: row.seller_rate_version_id,
      version_no: Number(row.seller_rate_version_no),
      cny_per_jpy_e8: integerString(row.seller_cny_per_jpy_e8),
      effective_from: Number(row.seller_rate_effective_from),
      confirmed_at: Number(row.seller_rate_confirmed_at),
      source_currency_code: row.source_currency_code,
      quote_currency_code: row.quote_currency_code,
      source_currency_exponent: Number(row.source_currency_exponent) as 0 | 2,
      quote_currency_exponent: 2,
      rate_value: integerString(row.seller_rate_value),
      rate_scale: integerString(row.seller_rate_scale),
      rounding_rule: row.rounding_rule,
    }),
    locked_service_fee_snapshot: Object.freeze({
      fee_version_id: row.service_fee_version_id,
      version_no: Number(row.service_fee_version_no),
      review_type: row.review_type,
      service_fee_cny_fen: integerString(row.service_fee_cny_fen),
      effective_from: Number(row.service_fee_effective_from),
      confirmed_at: Number(row.service_fee_confirmed_at),
      marketplace_code: row.canonical_marketplace_code,
      currency_code: 'CNY',
      currency_exponent: 2,
    }),
    business_completion: sellerBusinessCompletion({
      reviewStatus: row.review_status,
      buyerRefundExpectedCnyFen:
        BigInt(String(row.refund_expected_cny_fen)),
      buyerRefundStatus: row.buyer_refund_status,
      principalExpectedCnyFen:
        BigInt(String(row.seller_expected_principal_cny_fen)),
      principalStatus: row.principal_status,
      serviceFeeExpectedCnyFen: BigInt(String(row.service_fee_cny_fen)),
      serviceFeeStatus: row.service_fee_status,
    }),
    chat_screenshot: Object.freeze({
      status: row.chat_screenshot_status === 'AVAILABLE'
        ? 'AVAILABLE'
        : 'NONE',
      file_version: row.chat_screenshot_file_version === null
        ? null
        : Number(row.chat_screenshot_file_version),
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
