import type {
  CanonicalMarketplaceCode,
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
  legacy_projection: 'AMAZON' | 'NONE';
  marketplace_code: 'JP' | null;
  canonical_marketplace_code: CanonicalMarketplaceCode;
  amazon_order_number: string | null;
  platform_order_identifier: string;
  store_id: string;
  store_display_name: string;
  asin: string | null;
  platform_product_identifier: string;
  product_name: string;
  product_version_id: string | null;
  product_version_no: number | null;
  review_type: 'RATING' | 'TEXT' | 'IMAGE' | 'VIDEO' | null;
  final_paid_jpy: number | string | null;
  payment_amount_minor: number | string | null;
  payment_currency_code: 'JPY' | 'USD' | 'KRW' | 'CNY' | null;
  payment_currency_exponent: 0 | 2 | null;
  source_currency_code: 'JPY' | 'USD' | 'KRW' | 'CNY' | null;
  quote_currency_code: 'CNY' | null;
  source_currency_exponent: 0 | 2 | null;
  quote_currency_exponent: 2 | null;
  rounding_rule: 'HALF_UP' | null;
  seller_expected_principal_cny_fen: number | string | null;
  principal_platform_order_date: string | null;
  principal_payment_amount_minor: number | string | null;
  principal_payment_currency_code: 'JPY' | 'USD' | 'KRW' | 'CNY' | null;
  principal_base_rate_version_id: string | null;
  principal_base_rate_business_date: string | null;
  principal_base_rate_confirmed_at: number | null;
  principal_base_rate_value: number | string | null;
  principal_base_rate_scale: number | string | null;
  principal_policy_version_id: string | null;
  principal_policy_scope_type: 'CURRENCY_PAIR_DEFAULT' | 'SELLER_ORGANIZATION' | null;
  principal_policy_seller_organization_id: string | null;
  principal_policy_version_no: number | null;
  principal_policy_effective_from: number | null;
  principal_policy_confirmed_at: number | null;
  principal_markup_rate_value: number | string | null;
  principal_markup_rate_scale: number | string | null;
  principal_final_rate_value: number | string | null;
  principal_final_rate_scale: number | string | null;
  principal_rounding_rule: 'HALF_UP' | null;
  principal_amount_minor: number | string | null;
  service_fee_version_id: string | null;
  service_fee_version_no: number | null;
  service_fee_effective_from: number | null;
  service_fee_confirmed_at: number | null;
  service_fee_cny_fen: number | string | null;
  review_status: string | null;
  principal_status: string | null;
  service_fee_status: string | null;
  chat_screenshot_status: 'AVAILABLE' | 'NONE';
  chat_screenshot_file_version: number | null;
  main_image_file_object_id: string | null;
  main_image_file_version: number | null;
  main_image_client_file_name: string | null;
  order_screenshot_file_object_id: string | null;
  order_screenshot_file_version: number | null;
  confirmed_at: number;
  confirmed_business_date: string | null;
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
    if (filters.marketplace_code === 'JP') {
      conditions.push("formal_order.marketplace_code='JP'");
    } else {
      conditions.push('generic.marketplace_code=?');
      values.push(filters.marketplace_code);
    }
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
  const legacyResult = await database.prepare(`
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

  const platform = await listPlatformFormalOrderRows(
    database,
    actor,
    pagination.limit,
    filters,
    cursor,
  );
  const rows = [...legacyResult.results, ...platform].sort((left, right) => {
    const byTime = Number(right.confirmed_at) - Number(left.confirmed_at);
    return byTime !== 0
      ? byTime
      : left.formal_order_id === right.formal_order_id
        ? 0
        : left.formal_order_id < right.formal_order_id ? 1 : -1;
  });
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

  const resolved = row ?? await database.prepare(`
    ${selectPlatformFormalOrderProjection()}
    WHERE formal_order.id=?
      AND formal_order.seller_organization_id=?
      ${storeScope(actor, 'formal_order.seller_store_id').sql}
  `).bind(
    formalOrderId,
    actor.sellerOrganizationId,
    ...storeScope(actor, 'formal_order.seller_store_id').values,
  ).first<FormalOrderRow>();

  if (!resolved) {
    throw new SellerFormalOrderPortalError(
      'FORMAL_ORDER_NOT_FOUND',
      404,
    );
  }
  return mapFormalOrder(resolved);
}

function selectFormalOrderProjection(): string {
  return `
    SELECT
      formal_order.id AS formal_order_id,
      formal_order.status,
      'AMAZON' AS legacy_projection,
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
      generic.source_currency_code,
      generic.quote_currency_code,
      generic.source_currency_exponent,
      generic.quote_currency_exponent,
      generic.rounding_rule,
      principal.platform_order_date AS principal_platform_order_date,
      principal.payment_amount_minor AS principal_payment_amount_minor,
      principal.payment_currency_code AS principal_payment_currency_code,
      principal.base_rate_version_id AS principal_base_rate_version_id,
      principal.base_rate_business_date AS principal_base_rate_business_date,
      principal.base_rate_confirmed_at AS principal_base_rate_confirmed_at,
      principal.base_rate_value AS principal_base_rate_value,
      principal.base_rate_scale AS principal_base_rate_scale,
      principal.policy_version_id AS principal_policy_version_id,
      principal.policy_scope_type AS principal_policy_scope_type,
      principal.policy_seller_organization_id AS principal_policy_seller_organization_id,
      principal.policy_version_no AS principal_policy_version_no,
      principal.policy_effective_from AS principal_policy_effective_from,
      principal.policy_confirmed_at AS principal_policy_confirmed_at,
      principal.markup_rate_value AS principal_markup_rate_value,
      principal.markup_rate_scale AS principal_markup_rate_scale,
      principal.final_rate_value AS principal_final_rate_value,
      principal.final_rate_scale AS principal_final_rate_scale,
      principal.rounding_rule AS principal_rounding_rule,
      principal.seller_expected_principal_amount_minor AS principal_amount_minor,
      snapshot.service_fee_version_id,
      snapshot.service_fee_version_no,
      snapshot.service_fee_effective_from,
      snapshot.service_fee_confirmed_at,
      snapshot.service_fee_cny_fen,
      (SELECT review.status FROM review_cases review
        WHERE review.formal_order_id=formal_order.id) AS review_status,
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
      (SELECT image_link.file_object_id
        FROM product_version_main_images main_image
        JOIN file_entity_links image_link
          ON image_link.id=main_image.file_entity_link_id
          AND image_link.purpose='PRODUCT_IMAGE'
          AND image_link.revoked_at IS NULL
        JOIN file_objects image_object
          ON image_object.id=image_link.file_object_id
          AND image_object.status='VERIFIED'
        WHERE main_image.product_version_id=formal_order.product_version_id
        LIMIT 1) AS main_image_file_object_id,
      (SELECT image_object.version
        FROM product_version_main_images main_image
        JOIN file_entity_links image_link
          ON image_link.id=main_image.file_entity_link_id
          AND image_link.purpose='PRODUCT_IMAGE'
          AND image_link.revoked_at IS NULL
        JOIN file_objects image_object
          ON image_object.id=image_link.file_object_id
          AND image_object.status='VERIFIED'
        WHERE main_image.product_version_id=formal_order.product_version_id
        LIMIT 1) AS main_image_file_version,
      (SELECT image_object.client_file_name
        FROM product_version_main_images main_image
        JOIN file_entity_links image_link
          ON image_link.id=main_image.file_entity_link_id
          AND image_link.purpose='PRODUCT_IMAGE'
          AND image_link.revoked_at IS NULL
        JOIN file_objects image_object
          ON image_object.id=image_link.file_object_id
          AND image_object.status='VERIFIED'
        WHERE main_image.product_version_id=formal_order.product_version_id
        LIMIT 1) AS main_image_client_file_name,
      (SELECT link.file_object_id
        FROM file_entity_links link
        JOIN file_objects shot
          ON shot.id=link.file_object_id
          AND shot.status='VERIFIED'
          AND shot.purpose='ORDER_EVIDENCE'
          AND shot.visibility='SELLER_VISIBLE'
        WHERE link.entity_type='ORDER'
          AND link.entity_id=formal_order.id
          AND link.purpose='ORDER_EVIDENCE'
          AND link.visibility='SELLER_VISIBLE'
          AND link.authorization_mode='EXPLICIT_AUDIENCES'
          AND link.revoked_at IS NULL
          AND EXISTS (
            SELECT 1 FROM file_entity_audience_grants seller_grant
            WHERE seller_grant.file_entity_link_id=link.id
              AND seller_grant.subject_type='SELLER_ORGANIZATION'
              AND seller_grant.seller_organization_id=formal_order.seller_organization_id
              AND seller_grant.revoked_at IS NULL
              AND seller_grant.expires_at IS NULL
          )
        ORDER BY link.created_at, link.id
        LIMIT 1) AS order_screenshot_file_object_id,
      (SELECT shot.version
        FROM file_entity_links link
        JOIN file_objects shot
          ON shot.id=link.file_object_id
          AND shot.status='VERIFIED'
          AND shot.purpose='ORDER_EVIDENCE'
          AND shot.visibility='SELLER_VISIBLE'
        WHERE link.entity_type='ORDER'
          AND link.entity_id=formal_order.id
          AND link.purpose='ORDER_EVIDENCE'
          AND link.visibility='SELLER_VISIBLE'
          AND link.authorization_mode='EXPLICIT_AUDIENCES'
          AND link.revoked_at IS NULL
          AND EXISTS (
            SELECT 1 FROM file_entity_audience_grants seller_grant
            WHERE seller_grant.file_entity_link_id=link.id
              AND seller_grant.subject_type='SELLER_ORGANIZATION'
              AND seller_grant.seller_organization_id=formal_order.seller_organization_id
              AND seller_grant.revoked_at IS NULL
              AND seller_grant.expires_at IS NULL
          )
        ORDER BY link.created_at, link.id
        LIMIT 1) AS order_screenshot_file_version,
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
      AND store.status='ACTIVE'
    JOIN formal_order_financial_snapshots snapshot
      ON snapshot.formal_order_id=formal_order.id
    JOIN formal_order_marketplace_money_snapshots generic
      ON generic.formal_order_id=formal_order.id
    JOIN seller_principal_rate_snapshots principal
      ON principal.formal_order_id=formal_order.id
  `;
}

async function listPlatformFormalOrderRows(
  database: SqlDatabase,
  actor: SellerPortalActor,
  limit: number,
  filters: SellerFormalOrderPortalFilters,
  cursor: FormalOrderCursor | null,
): Promise<FormalOrderRow[]> {
  if (filters.marketplace_code === 'JP'
    || filters.asin !== null
    || filters.amazon_order_number !== null) {
    return [];
  }
  const scope = storeScope(actor, 'formal_order.seller_store_id');
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (filters.store_id !== null) {
    conditions.push('formal_order.seller_store_id=?');
    values.push(filters.store_id);
  }
  if (filters.marketplace_code !== null) {
    conditions.push('formal_order.marketplace_code=?');
    values.push(filters.marketplace_code);
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
  if (cursor !== null) {
    conditions.push(`(
      formal_order.confirmed_at < ?
      OR (formal_order.confirmed_at=? AND formal_order.id < ?)
    )`);
    values.push(cursor.confirmed_at, cursor.confirmed_at, cursor.formal_order_id);
  }
  const extra = conditions.length > 0
    ? `AND ${conditions.join(' AND ')}`
    : '';
  const result = await database.prepare(`
    ${selectPlatformFormalOrderProjection()}
    WHERE formal_order.seller_organization_id=?
      ${scope.sql}
      ${extra}
    ORDER BY formal_order.confirmed_at DESC, formal_order.id DESC
    LIMIT ?
  `).bind(
    actor.sellerOrganizationId,
    ...scope.values,
    ...values,
    limit + 1,
  ).all<FormalOrderRow>();
  return result.results;
}

function selectPlatformFormalOrderProjection(): string {
  return `
    SELECT
      formal_order.id AS formal_order_id,
      formal_order.status,
      'NONE' AS legacy_projection,
      NULL AS marketplace_code,
      formal_order.marketplace_code AS canonical_marketplace_code,
      NULL AS amazon_order_number,
      order_identity.platform_order_identifier,
      formal_order.seller_store_id AS store_id,
      store.display_name AS store_display_name,
      NULL AS asin,
      product_identity.platform_product_identifier,
      formal_order.product_name_snapshot AS product_name,
      NULL AS product_version_id,
      NULL AS product_version_no,
      formal_order.review_type,
      NULL AS final_paid_jpy,
      NULL AS payment_amount_minor,
      NULL AS payment_currency_code,
      NULL AS payment_currency_exponent,
      NULL AS seller_expected_principal_cny_fen,
      NULL AS source_currency_code,
      NULL AS quote_currency_code,
      NULL AS source_currency_exponent,
      NULL AS quote_currency_exponent,
      NULL AS rounding_rule,
      NULL AS principal_platform_order_date,
      NULL AS principal_payment_amount_minor,
      NULL AS principal_payment_currency_code,
      NULL AS principal_base_rate_version_id,
      NULL AS principal_base_rate_business_date,
      NULL AS principal_base_rate_confirmed_at,
      NULL AS principal_base_rate_value,
      NULL AS principal_base_rate_scale,
      NULL AS principal_policy_version_id,
      NULL AS principal_policy_scope_type,
      NULL AS principal_policy_seller_organization_id,
      NULL AS principal_policy_version_no,
      NULL AS principal_policy_effective_from,
      NULL AS principal_policy_confirmed_at,
      NULL AS principal_markup_rate_value,
      NULL AS principal_markup_rate_scale,
      NULL AS principal_final_rate_value,
      NULL AS principal_final_rate_scale,
      NULL AS principal_rounding_rule,
      NULL AS principal_amount_minor,
      NULL AS service_fee_version_id,
      NULL AS service_fee_version_no,
      NULL AS service_fee_effective_from,
      NULL AS service_fee_confirmed_at,
      NULL AS service_fee_cny_fen,
      NULL AS review_status,
      NULL AS principal_status,
      NULL AS service_fee_status,
      (SELECT file_object.version
        FROM platform_order_evidence_internal_files attachment
        JOIN platform_order_evidence_records evidence
          ON evidence.id=attachment.platform_order_evidence_record_id
          AND evidence.platform_order_identity_id=
            formal_order.platform_order_identity_id
          AND evidence.platform_product_identity_id=
            formal_order.platform_product_identity_id
          AND evidence.marketplace_code=formal_order.marketplace_code
          AND evidence.seller_organization_id=
            formal_order.seller_organization_id
          AND evidence.seller_store_id=formal_order.seller_store_id
          AND evidence.evidence_type=
            'ORDER_EVIDENCE_INTERNAL_COMMUNICATION'
          AND evidence.status='VERIFIED'
        JOIN file_entity_links file_link
          ON file_link.id=attachment.file_entity_link_id
          AND file_link.file_object_id=attachment.file_object_id
          AND file_link.entity_type='ORDER_EVIDENCE_SUBMISSION'
          AND file_link.entity_id=evidence.id
          AND file_link.purpose='ORDER_EVIDENCE_INTERNAL_COMMUNICATION'
          AND file_link.visibility='SELLER_VISIBLE'
          AND file_link.authorization_mode='EXPLICIT_AUDIENCES'
          AND file_link.revoked_at IS NULL
          AND (file_link.expires_at IS NULL
            OR file_link.expires_at>
              CAST(unixepoch('now') AS INTEGER)*1000)
        JOIN file_objects file_object
          ON file_object.id=attachment.file_object_id
          AND file_object.status='VERIFIED'
          AND file_object.purpose='ORDER_EVIDENCE_INTERNAL_COMMUNICATION'
          AND file_object.visibility='SELLER_VISIBLE'
          AND file_object.detected_mime IN
            ('image/jpeg','image/png','image/webp')
        JOIN file_upload_intents upload_intent
          ON upload_intent.id=file_object.upload_intent_id
          AND upload_intent.status='VERIFIED'
          AND upload_intent.purpose=
            'ORDER_EVIDENCE_INTERNAL_COMMUNICATION'
          AND upload_intent.visibility='SELLER_VISIBLE'
        JOIN file_entity_audience_grants audience_grant
          ON audience_grant.file_entity_link_id=file_link.id
          AND audience_grant.subject_type='SELLER_ORGANIZATION'
          AND audience_grant.seller_organization_id=
            formal_order.seller_organization_id
          AND audience_grant.revoked_at IS NULL
          AND (audience_grant.expires_at IS NULL
            OR audience_grant.expires_at>
              CAST(unixepoch('now') AS INTEGER)*1000)
        WHERE attachment.platform_formal_order_id=formal_order.id
          AND attachment.slot=1
        LIMIT 1) AS chat_screenshot_file_version,
      NULL AS main_image_file_object_id,
      NULL AS main_image_file_version,
      NULL AS main_image_client_file_name,
      NULL AS order_screenshot_file_object_id,
      NULL AS order_screenshot_file_version,
      CASE WHEN EXISTS (
        SELECT 1
        FROM platform_order_evidence_internal_files attachment
        JOIN platform_order_evidence_records evidence
          ON evidence.id=attachment.platform_order_evidence_record_id
          AND evidence.platform_order_identity_id=
            formal_order.platform_order_identity_id
          AND evidence.platform_product_identity_id=
            formal_order.platform_product_identity_id
          AND evidence.marketplace_code=formal_order.marketplace_code
          AND evidence.seller_organization_id=
            formal_order.seller_organization_id
          AND evidence.seller_store_id=formal_order.seller_store_id
          AND evidence.evidence_type=
            'ORDER_EVIDENCE_INTERNAL_COMMUNICATION'
          AND evidence.status='VERIFIED'
        JOIN file_entity_links file_link
          ON file_link.id=attachment.file_entity_link_id
          AND file_link.file_object_id=attachment.file_object_id
          AND file_link.entity_type='ORDER_EVIDENCE_SUBMISSION'
          AND file_link.entity_id=evidence.id
          AND file_link.purpose='ORDER_EVIDENCE_INTERNAL_COMMUNICATION'
          AND file_link.visibility='SELLER_VISIBLE'
          AND file_link.authorization_mode='EXPLICIT_AUDIENCES'
          AND file_link.revoked_at IS NULL
          AND (file_link.expires_at IS NULL
            OR file_link.expires_at>
              CAST(unixepoch('now') AS INTEGER)*1000)
        JOIN file_objects file_object
          ON file_object.id=attachment.file_object_id
          AND file_object.status='VERIFIED'
          AND file_object.purpose='ORDER_EVIDENCE_INTERNAL_COMMUNICATION'
          AND file_object.visibility='SELLER_VISIBLE'
          AND file_object.detected_mime IN
            ('image/jpeg','image/png','image/webp')
        JOIN file_upload_intents upload_intent
          ON upload_intent.id=file_object.upload_intent_id
          AND upload_intent.status='VERIFIED'
          AND upload_intent.purpose=
            'ORDER_EVIDENCE_INTERNAL_COMMUNICATION'
          AND upload_intent.visibility='SELLER_VISIBLE'
        JOIN file_entity_audience_grants audience_grant
          ON audience_grant.file_entity_link_id=file_link.id
          AND audience_grant.subject_type='SELLER_ORGANIZATION'
          AND audience_grant.seller_organization_id=
            formal_order.seller_organization_id
          AND audience_grant.revoked_at IS NULL
          AND (audience_grant.expires_at IS NULL
            OR audience_grant.expires_at>
              CAST(unixepoch('now') AS INTEGER)*1000)
        WHERE attachment.platform_formal_order_id=formal_order.id
          AND attachment.slot=1
      ) THEN 'AVAILABLE' ELSE 'NONE' END AS chat_screenshot_status,
      formal_order.confirmed_at,
      formal_order.confirmed_business_date
    FROM platform_formal_orders formal_order
    JOIN platform_order_identities order_identity
      ON order_identity.id=formal_order.platform_order_identity_id
    JOIN platform_product_identities product_identity
      ON product_identity.id=formal_order.platform_product_identity_id
    JOIN seller_stores store
      ON store.id=formal_order.seller_store_id
      AND store.organization_id=formal_order.seller_organization_id
      AND store.status='ACTIVE'
  `;
}

export function storeScope(
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
  const common = {
    formal_order_id: row.formal_order_id,
    status: row.status,
    canonical_marketplace_code: row.canonical_marketplace_code,
    platform_order_identifier: row.platform_order_identifier,
    store: Object.freeze({
      id: row.store_id,
      display_name: row.store_display_name,
    }),
    platform_product_identifier: row.platform_product_identifier,
    product_name: row.product_name,
    main_image: row.main_image_file_object_id === null
      || row.main_image_file_version === null
      || row.main_image_client_file_name === null
      ? null
      : Object.freeze({
          file_object_id: row.main_image_file_object_id,
          file_version: Number(row.main_image_file_version),
          client_file_name: row.main_image_client_file_name,
        }),
    order_screenshot: row.order_screenshot_file_object_id === null
      || row.order_screenshot_file_version === null
      ? null
      : Object.freeze({
          file_object_id: row.order_screenshot_file_object_id,
          file_version: Number(row.order_screenshot_file_version),
        }),
    chat_screenshot: Object.freeze({
      status: row.chat_screenshot_status === 'AVAILABLE'
        ? 'AVAILABLE' as const
        : 'NONE' as const,
      file_version: row.chat_screenshot_file_version === null
        ? null
        : Number(row.chat_screenshot_file_version),
    }),
    confirmed_at: Number(row.confirmed_at),
  };
  if (row.legacy_projection === 'NONE') {
    if (row.canonical_marketplace_code !== 'RAKUTEN_JP'
      && row.canonical_marketplace_code !== 'TIKTOK_JP') {
      throw new SellerFormalOrderPortalError('DEPENDENCY_UNAVAILABLE', 503);
    }
    return Object.freeze({
      ...common,
      canonical_marketplace_code: row.canonical_marketplace_code,
      legacy_projection: 'NONE',
      marketplace_code: null,
      amazon_order_number: null,
      asin: null,
      product_version: null,
      review_type: row.review_type,
      final_paid_jpy: null,
      payment: null,
      seller_expected_principal_cny_fen: null,
      seller_principal_rate_snapshot: null,
      locked_service_fee_snapshot: null,
      business_completion: null,
      confirmed_business_date: row.confirmed_business_date,
    });
  }
  if (row.canonical_marketplace_code !== 'AMAZON_JP'
    && row.canonical_marketplace_code !== 'AMAZON_US') {
    throw new SellerFormalOrderPortalError('DEPENDENCY_UNAVAILABLE', 503);
  }
  return Object.freeze({
    ...common,
    canonical_marketplace_code: row.canonical_marketplace_code,
    legacy_projection: 'AMAZON',
    marketplace_code: row.marketplace_code!,
    amazon_order_number: row.amazon_order_number!,
    asin: row.asin!,
    product_version: Object.freeze({
      id: row.product_version_id!,
      version_no: Number(row.product_version_no),
    }),
    review_type: row.review_type!,
    final_paid_jpy: integerString(row.final_paid_jpy!),
    payment: Object.freeze({
      amount_minor: integerString(row.payment_amount_minor!),
      currency_code: row.payment_currency_code!,
      currency_exponent: Number(row.payment_currency_exponent) as 0 | 2,
    }),
    seller_expected_principal_cny_fen:
      integerString(row.seller_expected_principal_cny_fen!),
    seller_principal_rate_snapshot: Object.freeze({
          platform_order_date: row.principal_platform_order_date!,
          payment_amount_minor: integerString(row.principal_payment_amount_minor!),
          payment_currency_code: row.principal_payment_currency_code!,
          base_rate_version_id: row.principal_base_rate_version_id!,
          base_rate_business_date: row.principal_base_rate_business_date!,
          base_rate_confirmed_at: Number(row.principal_base_rate_confirmed_at),
          base_rate_value: integerString(row.principal_base_rate_value!),
          base_rate_scale: integerString(row.principal_base_rate_scale!),
          policy_version_id: row.principal_policy_version_id!,
          policy_scope_type: row.principal_policy_scope_type!,
          policy_seller_organization_id: row.principal_policy_seller_organization_id,
          policy_version_no: Number(row.principal_policy_version_no),
          policy_effective_from: Number(row.principal_policy_effective_from),
          policy_confirmed_at: Number(row.principal_policy_confirmed_at),
          markup_rate_value: integerString(row.principal_markup_rate_value!),
          markup_rate_scale: integerString(row.principal_markup_rate_scale!),
          final_rate_value: integerString(row.principal_final_rate_value!),
          final_rate_scale: integerString(row.principal_final_rate_scale!),
          rounding_rule: row.principal_rounding_rule!,
          seller_expected_principal_amount_minor:
            integerString(row.principal_amount_minor!),
        }),
    locked_service_fee_snapshot: Object.freeze({
      fee_version_id: row.service_fee_version_id!,
      version_no: Number(row.service_fee_version_no),
      review_type: row.review_type!,
      service_fee_cny_fen: integerString(row.service_fee_cny_fen!),
      effective_from: Number(row.service_fee_effective_from),
      confirmed_at: Number(row.service_fee_confirmed_at),
      marketplace_code: row.canonical_marketplace_code,
      currency_code: 'CNY',
      currency_exponent: 2,
    }),
    business_completion: sellerBusinessCompletion({
      reviewStatus: row.review_status,
      principalExpectedCnyFen:
        BigInt(String(row.seller_expected_principal_cny_fen)),
      principalStatus: row.principal_status,
      serviceFeeExpectedCnyFen: BigInt(String(row.service_fee_cny_fen)),
      serviceFeeStatus: row.service_fee_status,
    }),
    confirmed_business_date: row.confirmed_business_date!,
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
