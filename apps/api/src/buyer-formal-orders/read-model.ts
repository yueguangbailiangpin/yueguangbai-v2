import type {
  BuyerFormalOrderDto,
  BuyerFormalOrderPageDto,
  PricingReviewType,
  SqlDatabase,
} from '@ygb/contracts';
import type { BuyerPortalContext } from '../buyer-portal/buyer-context';
import { BuyerFormalOrderPortalError } from './errors';
import {
  encodeBuyerFormalOrderCursor,
  type BuyerFormalOrderCursor,
} from './pagination';

export interface BuyerFormalOrderFilters {
  marketplace: 'JP' | null;
  productName: string | null;
  reviewType: PricingReviewType | null;
  confirmedBusinessDate: string | null;
  formalOrderId: string | null;
  amazonOrderNumber: string | null;
}

interface BuyerFormalOrderRow {
  formal_order_id: string;
  buyer_customer_no: string;
  marketplace_code: 'JP';
  amazon_order_number_normalized: string;
  amazon_order_date: string | null;
  product_name_snapshot: string;
  review_type: PricingReviewType;
  final_paid_jpy: number;
  buyer_self_pay_bps: number;
  buyer_self_pay_jpy: number;
  buyer_refundable_principal_jpy: number;
  buyer_expected_principal_cny_fen: number;
  buyer_rate_version_no: number;
  buyer_rate_business_date: string;
  buyer_rate_confirmed_at: number;
  buyer_cny_per_jpy_e8: number;
  confirmed_at: number;
  confirmed_business_date: string;
  status: 'CONFIRMED';
  evidence_version_no: number;
  evidence_submitted_at: number;
  evidence_verified_at: number;
  evidence_file_count: number;
}

const BUYER_FORMAL_ORDER_SELECT = `
  SELECT
    formal_order.id AS formal_order_id,
    formal_order.buyer_customer_no,
    formal_order.marketplace_code,
    formal_order.amazon_order_number_normalized,
    formal_order.amazon_order_date,
    formal_order.product_name_snapshot,
    formal_order.review_type,
    formal_order.final_paid_jpy,
    snapshot.buyer_self_pay_bps,
    snapshot.buyer_self_pay_jpy,
    snapshot.buyer_refundable_principal_jpy,
    snapshot.buyer_expected_principal_cny_fen,
    snapshot.buyer_rate_version_no,
    snapshot.buyer_rate_business_date,
    snapshot.buyer_rate_confirmed_at,
    snapshot.buyer_cny_per_jpy_e8,
    formal_order.confirmed_at,
    formal_order.confirmed_business_date,
    formal_order.status,
    evidence.version_no AS evidence_version_no,
    submission.submitted_at AS evidence_submitted_at,
    submission.verified_at AS evidence_verified_at,
    (
      SELECT COUNT(*)
      FROM order_evidence_version_files evidence_file
      WHERE evidence_file.version_id=formal_order.order_evidence_version_id
        AND evidence_file.submission_id=formal_order.order_evidence_submission_id
        AND evidence_file.buyer_customer_id=formal_order.buyer_customer_id
    ) AS evidence_file_count
  FROM formal_orders formal_order
  JOIN formal_order_financial_snapshots snapshot
    ON snapshot.formal_order_id=formal_order.id
  JOIN order_evidence_submissions submission
    ON submission.id=formal_order.order_evidence_submission_id
    AND submission.buyer_customer_id=formal_order.buyer_customer_id
    AND submission.marketplace_code=formal_order.marketplace_code
  JOIN order_evidence_versions evidence
    ON evidence.id=formal_order.order_evidence_version_id
    AND evidence.submission_id=formal_order.order_evidence_submission_id
    AND evidence.buyer_customer_id=formal_order.buyer_customer_id
    AND evidence.marketplace_code=formal_order.marketplace_code
`;

export async function listBuyerFormalOrders(
  database: SqlDatabase,
  buyer: BuyerPortalContext,
  options: {
    limit: number;
    cursor: BuyerFormalOrderCursor | null;
    filters: BuyerFormalOrderFilters;
  },
): Promise<BuyerFormalOrderPageDto> {
  assertBuyerBusinessAccess(buyer);
  validateLimit(options.limit);

  const where = ['formal_order.buyer_customer_id=?'];
  const bindings: unknown[] = [buyer.buyerCustomerId];
  addFilters(where, bindings, options.filters);
  if (options.cursor) {
    where.push(`(
      formal_order.confirmed_at<?
      OR (
        formal_order.confirmed_at=?
        AND formal_order.id<?
      )
    )`);
    bindings.push(
      options.cursor.confirmedAt,
      options.cursor.confirmedAt,
      options.cursor.id,
    );
  }
  bindings.push(options.limit + 1);

  const result = await database.prepare(`
    ${BUYER_FORMAL_ORDER_SELECT}
    WHERE ${where.join('\n      AND ')}
    ORDER BY formal_order.confirmed_at DESC, formal_order.id DESC
    LIMIT ?
  `).bind(...bindings).all<BuyerFormalOrderRow>();

  const hasMore = result.results.length > options.limit;
  const visibleRows = hasMore
    ? result.results.slice(0, options.limit)
    : result.results;
  const last = visibleRows.at(-1) ?? null;
  return {
    items: Object.freeze(visibleRows.map(toDto)),
    next_cursor: hasMore && last
      ? encodeBuyerFormalOrderCursor({
          confirmedAt: Number(last.confirmed_at),
          id: last.formal_order_id,
        })
      : null,
  };
}

export async function getBuyerFormalOrder(
  database: SqlDatabase,
  buyer: BuyerPortalContext,
  formalOrderId: string,
): Promise<BuyerFormalOrderDto> {
  assertBuyerBusinessAccess(buyer);
  validateIdentifier(formalOrderId, true);

  const row = await database.prepare(`
    ${BUYER_FORMAL_ORDER_SELECT}
    WHERE formal_order.id=?
      AND formal_order.buyer_customer_id=?
    LIMIT 1
  `).bind(
    formalOrderId,
    buyer.buyerCustomerId,
  ).first<BuyerFormalOrderRow>();
  if (!row) {
    throw new BuyerFormalOrderPortalError(
      'BUYER_FORMAL_ORDER_NOT_FOUND',
      404,
    );
  }
  return toDto(row);
}

function addFilters(
  where: string[],
  bindings: unknown[],
  filters: BuyerFormalOrderFilters,
): void {
  if (filters.marketplace) {
    where.push('formal_order.marketplace_code=?');
    bindings.push(filters.marketplace);
  }
  if (filters.productName) {
    where.push(
      "formal_order.product_name_snapshot LIKE ? ESCAPE '\\'",
    );
    bindings.push(`%${escapeLike(filters.productName)}%`);
  }
  if (filters.reviewType) {
    where.push('formal_order.review_type=?');
    bindings.push(filters.reviewType);
  }
  if (filters.confirmedBusinessDate) {
    where.push('formal_order.confirmed_business_date=?');
    bindings.push(filters.confirmedBusinessDate);
  }
  if (filters.formalOrderId) {
    where.push('formal_order.id=?');
    bindings.push(filters.formalOrderId);
  }
  if (filters.amazonOrderNumber) {
    where.push('formal_order.amazon_order_number_normalized=?');
    bindings.push(filters.amazonOrderNumber);
  }
}

function toDto(row: BuyerFormalOrderRow): BuyerFormalOrderDto {
  const verifiedAt = Number(row.evidence_verified_at);
  if (!Number.isSafeInteger(verifiedAt) || verifiedAt < 0) {
    throw new BuyerFormalOrderPortalError(
      'DEPENDENCY_UNAVAILABLE',
      503,
    );
  }
  return {
    formal_order_id: row.formal_order_id,
    buyer_customer_no: row.buyer_customer_no,
    marketplace: row.marketplace_code,
    amazon_order_number: row.amazon_order_number_normalized,
    amazon_order_date: row.amazon_order_date,
    product_name: row.product_name_snapshot,
    review_type: row.review_type,
    final_paid_jpy: integerString(row.final_paid_jpy),
    buyer_self_pay_bps: safeNonNegativeInteger(row.buyer_self_pay_bps),
    buyer_self_pay_jpy: integerString(row.buyer_self_pay_jpy),
    buyer_refundable_principal_jpy:
      integerString(row.buyer_refundable_principal_jpy),
    buyer_expected_principal_cny_fen:
      integerString(row.buyer_expected_principal_cny_fen),
    buyer_exchange_rate_snapshot: {
      version_no: safePositiveInteger(row.buyer_rate_version_no),
      business_date: row.buyer_rate_business_date,
      confirmed_at: safeNonNegativeInteger(row.buyer_rate_confirmed_at),
      cny_per_jpy_e8: integerString(row.buyer_cny_per_jpy_e8),
    },
    confirmed_at: safeNonNegativeInteger(row.confirmed_at),
    confirmed_business_date: row.confirmed_business_date,
    status: 'CONFIRMED',
    order_evidence_summary: {
      evidence_version_no: safePositiveInteger(row.evidence_version_no),
      submitted_at: safeNonNegativeInteger(row.evidence_submitted_at),
      verified_at: verifiedAt,
      file_count: safeNonNegativeInteger(row.evidence_file_count),
    },
  };
}

function assertBuyerBusinessAccess(buyer: BuyerPortalContext): void {
  if (buyer.accessStatus !== 'ACTIVE') {
    throw new BuyerFormalOrderPortalError('CUSTOMER_NOT_ACTIVE', 409);
  }
  if (buyer.identityReviewStatus !== 'CLEAR') {
    throw new BuyerFormalOrderPortalError(
      'IDENTITY_REVIEW_REQUIRED',
      409,
    );
  }
}

function validateLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new BuyerFormalOrderPortalError('VALIDATION_ERROR', 400);
  }
}

function validateIdentifier(value: string, notFound: boolean): void {
  if (typeof value !== 'string'
    || value.length < 1
    || value.length > 120
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new BuyerFormalOrderPortalError(
      notFound ? 'BUYER_FORMAL_ORDER_NOT_FOUND' : 'VALIDATION_ERROR',
      notFound ? 404 : 400,
    );
  }
}

function safePositiveInteger(value: number): number {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 1) {
    throw new BuyerFormalOrderPortalError(
      'DEPENDENCY_UNAVAILABLE',
      503,
    );
  }
  return numeric;
}

function safeNonNegativeInteger(value: number): number {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    throw new BuyerFormalOrderPortalError(
      'DEPENDENCY_UNAVAILABLE',
      503,
    );
  }
  return numeric;
}

function integerString(value: number): string {
  return String(safeNonNegativeInteger(value));
}

function escapeLike(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('%', '\\%')
    .replaceAll('_', '\\_');
}
