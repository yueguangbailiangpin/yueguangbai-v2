import {
  isPricingReviewType,
  isReviewCaseStatus,
  isSupportedFileMime,
  type BuyerReviewAction,
  type BuyerReviewDetailDto,
  type BuyerReviewEligibleOrderDto,
  type BuyerReviewFileDto,
  type BuyerReviewOrderSummaryDto,
  type BuyerReviewPageDto,
  type BuyerReviewSummaryDto,
  type PricingReviewType,
  type ReviewCaseStatus,
  type SqlDatabase,
  type SupportedFileMime,
} from '@ygb/contracts';
import type { BuyerPortalContext } from '../buyer-portal/buyer-context';
import { BuyerReviewPortalError } from './errors';
import {
  encodeBuyerReviewCursor,
  encodeEligibleReviewOrderCursor,
  type BuyerReviewCursor,
  type EligibleReviewOrderCursor,
} from './pagination';

interface EligibleOrderRow {
  formal_order_id: string;
  marketplace_code: 'JP';
  amazon_order_number_normalized: string;
  amazon_order_date: string | null;
  product_name_snapshot: string;
  review_type: PricingReviewType;
  confirmed_at: number;
  confirmed_business_date: string;
  order_status: 'CONFIRMED';
  review_case_id: string | null;
  review_status: ReviewCaseStatus | null;
  review_version: number | null;
}

interface ReviewRow {
  review_case_id: string;
  formal_order_id: string;
  marketplace_code: 'JP';
  amazon_order_number_normalized: string;
  amazon_order_date: string | null;
  product_name_snapshot: string;
  order_review_type: PricingReviewType;
  confirmed_at: number;
  confirmed_business_date: string;
  order_status: 'CONFIRMED';
  review_type: PricingReviewType;
  review_status: ReviewCaseStatus;
  review_version: number;
  current_evidence_version_no: number;
  current_evidence_version_id: string;
  submitted_at: number;
  updated_at: number;
  public_change_reason: string | null;
  review_approved_at: number | null;
  buyer_refund_due_amount_cny_fen: number | null;
  buyer_refund_became_due_at: number | null;
  file_count: number;
}

interface ReviewFileRow {
  file_object_id: string;
  file_entity_link_id: string;
  client_file_name: string;
  mime: SupportedFileMime;
  byte_size: number;
  file_status: string;
  file_version: number;
  verified_at: number;
}

export interface BuyerReviewFileLinkSource {
  fileObjectId: string;
  fileEntityLinkId: string;
  fileVersion: number;
}

const NO_ACTIONS = Object.freeze([] as BuyerReviewAction[]);
const SUBMIT_ACTION = Object.freeze(['SUBMIT'] as BuyerReviewAction[]);
const WITHDRAW_ACTION = Object.freeze(['WITHDRAW'] as BuyerReviewAction[]);
const RESUBMIT_WITHDRAW_ACTIONS = Object.freeze([
  'RESUBMIT',
  'WITHDRAW',
] as BuyerReviewAction[]);
const READ_FILE_ACTION = Object.freeze(['CREATE_READ_INTENT'] as const);

const REVIEW_SELECT = `
  SELECT
    review_case.id AS review_case_id,
    formal_order.id AS formal_order_id,
    formal_order.marketplace_code,
    formal_order.amazon_order_number_normalized,
    formal_order.amazon_order_date,
    formal_order.product_name_snapshot,
    formal_order.review_type AS order_review_type,
    formal_order.confirmed_at,
    formal_order.confirmed_business_date,
    formal_order.status AS order_status,
    review_case.review_type,
    review_case.status AS review_status,
    review_case.version AS review_version,
    review_case.current_evidence_version_no,
    evidence.id AS current_evidence_version_id,
    review_case.submitted_at,
    review_case.updated_at,
    review_case.public_change_reason,
    (
      SELECT approved.created_at
      FROM review_events approved
      WHERE approved.review_case_id=review_case.id
        AND approved.event_type='REVIEW_APPROVED'
      ORDER BY approved.created_at, approved.id
      LIMIT 1
    ) AS review_approved_at,
    (
      SELECT due.amount_cny_fen
      FROM review_events due
      WHERE due.review_case_id=review_case.id
        AND due.event_type='BUYER_REFUND_BECAME_DUE'
      ORDER BY due.created_at, due.id
      LIMIT 1
    ) AS buyer_refund_due_amount_cny_fen,
    (
      SELECT due.created_at
      FROM review_events due
      WHERE due.review_case_id=review_case.id
        AND due.event_type='BUYER_REFUND_BECAME_DUE'
      ORDER BY due.created_at, due.id
      LIMIT 1
    ) AS buyer_refund_became_due_at,
    (
      SELECT COUNT(*)
      FROM review_evidence_version_files version_file
      JOIN file_objects object
        ON object.id=version_file.file_object_id
      JOIN file_upload_intents intent
        ON intent.id=object.upload_intent_id
      JOIN file_entity_links link
        ON link.id=version_file.file_entity_link_id
        AND link.file_object_id=object.id
      JOIN file_entity_audience_grants buyer_grant
        ON buyer_grant.file_entity_link_id=link.id
        AND buyer_grant.subject_type='BUYER'
        AND buyer_grant.buyer_customer_id=review_case.buyer_customer_id
      WHERE version_file.review_case_id=review_case.id
        AND version_file.evidence_version_id=evidence.id
        AND object.status='VERIFIED'
        AND intent.status='VERIFIED'
        AND object.purpose='REVIEW_EVIDENCE'
        AND intent.purpose='REVIEW_EVIDENCE'
        AND intent.owner_actor_type='BUYER_CUSTOMER'
        AND intent.owner_actor_id=review_case.buyer_customer_id
        AND link.entity_type='REVIEW'
        AND link.entity_id=evidence.id
        AND link.purpose='REVIEW_EVIDENCE'
        AND link.authorization_mode='EXPLICIT_AUDIENCES'
        AND link.revoked_at IS NULL
        AND buyer_grant.revoked_at IS NULL
    ) AS file_count
  FROM review_cases review_case
  JOIN formal_orders formal_order
    ON formal_order.id=review_case.formal_order_id
    AND formal_order.buyer_customer_id=review_case.buyer_customer_id
    AND formal_order.review_type=review_case.review_type
    AND formal_order.status='CONFIRMED'
  JOIN review_evidence_versions evidence
    ON evidence.review_case_id=review_case.id
    AND evidence.formal_order_id=formal_order.id
    AND evidence.version_no=review_case.current_evidence_version_no
    AND evidence.submitted_by_buyer_id=review_case.buyer_customer_id
    AND evidence.review_type=review_case.review_type
`;

export async function listBuyerReviewEligibleOrders(
  database: SqlDatabase,
  buyer: BuyerPortalContext,
  options: {
    limit: number;
    cursor: EligibleReviewOrderCursor | null;
  },
): Promise<BuyerReviewPageDto<BuyerReviewEligibleOrderDto>> {
  assertBuyerReviewBusinessAccess(buyer);
  validateLimit(options.limit);

  const cursorSql = options.cursor
    ? `
      AND (
        formal_order.confirmed_at<?
        OR (
          formal_order.confirmed_at=?
          AND formal_order.id<?
        )
      )
    `
    : '';
  const bindings: unknown[] = [buyer.buyerCustomerId];
  if (options.cursor) {
    bindings.push(
      options.cursor.confirmedAt,
      options.cursor.confirmedAt,
      options.cursor.id,
    );
  }
  bindings.push(options.limit + 1);

  const result = await database.prepare(`
    SELECT
      formal_order.id AS formal_order_id,
      formal_order.marketplace_code,
      formal_order.amazon_order_number_normalized,
      formal_order.amazon_order_date,
      formal_order.product_name_snapshot,
      formal_order.review_type,
      formal_order.confirmed_at,
      formal_order.confirmed_business_date,
      formal_order.status AS order_status,
      review_case.id AS review_case_id,
      review_case.status AS review_status,
      review_case.version AS review_version
    FROM formal_orders formal_order
    LEFT JOIN review_cases review_case
      ON review_case.formal_order_id=formal_order.id
      AND review_case.buyer_customer_id=formal_order.buyer_customer_id
    WHERE formal_order.buyer_customer_id=?
      AND formal_order.status='CONFIRMED'
      AND (
        review_case.id IS NULL
        OR review_case.status='CHANGES_REQUESTED'
      )
      ${cursorSql}
    ORDER BY formal_order.confirmed_at DESC, formal_order.id DESC
    LIMIT ?
  `).bind(...bindings).all<EligibleOrderRow>();

  const hasMore = result.results.length > options.limit;
  const visible = hasMore
    ? result.results.slice(0, options.limit)
    : result.results;
  const last = visible.at(-1) ?? null;
  return {
    items: Object.freeze(visible.map(toEligibleOrderDto)),
    next_cursor: hasMore && last
      ? encodeEligibleReviewOrderCursor({
          confirmedAt: safeNonNegativeInteger(last.confirmed_at),
          id: last.formal_order_id,
        })
      : null,
  };
}

export async function listBuyerReviews(
  database: SqlDatabase,
  buyer: BuyerPortalContext,
  options: {
    limit: number;
    cursor: BuyerReviewCursor | null;
  },
): Promise<BuyerReviewPageDto<BuyerReviewSummaryDto>> {
  assertBuyerReviewBusinessAccess(buyer);
  validateLimit(options.limit);

  const cursorSql = options.cursor
    ? `
      AND (
        review_case.updated_at<?
        OR (
          review_case.updated_at=?
          AND review_case.id<?
        )
      )
    `
    : '';
  const bindings: unknown[] = [buyer.buyerCustomerId];
  if (options.cursor) {
    bindings.push(
      options.cursor.updatedAt,
      options.cursor.updatedAt,
      options.cursor.id,
    );
  }
  bindings.push(options.limit + 1);

  const result = await database.prepare(`
    ${REVIEW_SELECT}
    WHERE review_case.buyer_customer_id=?
      ${cursorSql}
    ORDER BY review_case.updated_at DESC, review_case.id DESC
    LIMIT ?
  `).bind(...bindings).all<ReviewRow>();

  const hasMore = result.results.length > options.limit;
  const visible = hasMore
    ? result.results.slice(0, options.limit)
    : result.results;
  const last = visible.at(-1) ?? null;
  return {
    items: Object.freeze(visible.map(toReviewSummaryDto)),
    next_cursor: hasMore && last
      ? encodeBuyerReviewCursor({
          updatedAt: safeNonNegativeInteger(last.updated_at),
          id: last.review_case_id,
        })
      : null,
  };
}

export async function getBuyerReview(
  database: SqlDatabase,
  buyer: BuyerPortalContext,
  reviewCaseId: string,
  now = Date.now(),
): Promise<BuyerReviewDetailDto> {
  assertBuyerReviewBusinessAccess(buyer);
  validateIdentifier(reviewCaseId, true);
  validateNow(now);

  const row = await database.prepare(`
    ${REVIEW_SELECT}
    WHERE review_case.id=?
      AND review_case.buyer_customer_id=?
    LIMIT 1
  `).bind(
    reviewCaseId,
    buyer.buyerCustomerId,
  ).first<ReviewRow>();
  if (!row) notFound();

  return {
    ...toReviewSummaryDto(row),
    files: await listCurrentReviewFiles(
      database,
      buyer.buyerCustomerId,
      row.review_case_id,
      row.current_evidence_version_id,
      now,
    ),
  };
}

export async function requireBuyerReviewFormalOrderId(
  database: SqlDatabase,
  buyer: BuyerPortalContext,
  reviewCaseId: string,
): Promise<string> {
  assertBuyerReviewBusinessAccess(buyer);
  validateIdentifier(reviewCaseId, true);
  const row = await database.prepare(`
    SELECT formal_order_id
    FROM review_cases
    WHERE id=?
      AND buyer_customer_id=?
    LIMIT 1
  `).bind(
    reviewCaseId,
    buyer.buyerCustomerId,
  ).first<{ formal_order_id: string }>();
  if (!row) notFound();
  return row.formal_order_id;
}

export async function requireBuyerReviewFileLink(
  database: SqlDatabase,
  buyer: BuyerPortalContext,
  reviewCaseId: string,
  fileEntityLinkId: string,
  now = Date.now(),
): Promise<BuyerReviewFileLinkSource> {
  assertBuyerReviewBusinessAccess(buyer);
  validateIdentifier(reviewCaseId, true);
  validateIdentifier(fileEntityLinkId, true);
  validateNow(now);

  const row = await database.prepare(`
    SELECT
      object.id AS file_object_id,
      link.id AS file_entity_link_id,
      object.version AS file_version
    FROM review_cases review_case
    JOIN review_evidence_versions evidence
      ON evidence.review_case_id=review_case.id
      AND evidence.formal_order_id=review_case.formal_order_id
      AND evidence.version_no=review_case.current_evidence_version_no
      AND evidence.submitted_by_buyer_id=review_case.buyer_customer_id
    JOIN review_evidence_version_files version_file
      ON version_file.review_case_id=review_case.id
      AND version_file.evidence_version_id=evidence.id
      AND version_file.formal_order_id=review_case.formal_order_id
    JOIN file_objects object
      ON object.id=version_file.file_object_id
      AND object.status='VERIFIED'
      AND object.purpose='REVIEW_EVIDENCE'
    JOIN file_upload_intents intent
      ON intent.id=object.upload_intent_id
      AND intent.status='VERIFIED'
      AND intent.purpose='REVIEW_EVIDENCE'
      AND intent.owner_actor_type='BUYER_CUSTOMER'
      AND intent.owner_actor_id=review_case.buyer_customer_id
    JOIN file_entity_links link
      ON link.id=version_file.file_entity_link_id
      AND link.file_object_id=object.id
      AND link.entity_type='REVIEW'
      AND link.entity_id=evidence.id
      AND link.purpose='REVIEW_EVIDENCE'
      AND link.authorization_mode='EXPLICIT_AUDIENCES'
      AND link.revoked_at IS NULL
      AND (link.expires_at IS NULL OR link.expires_at>?)
    JOIN file_entity_audience_grants buyer_grant
      ON buyer_grant.file_entity_link_id=link.id
      AND buyer_grant.subject_type='BUYER'
      AND buyer_grant.buyer_customer_id=review_case.buyer_customer_id
      AND buyer_grant.revoked_at IS NULL
      AND (buyer_grant.expires_at IS NULL OR buyer_grant.expires_at>?)
    WHERE review_case.id=?
      AND review_case.buyer_customer_id=?
      AND link.id=?
    LIMIT 1
  `).bind(
    now,
    now,
    reviewCaseId,
    buyer.buyerCustomerId,
    fileEntityLinkId,
  ).first<{
    file_object_id: string;
    file_entity_link_id: string;
    file_version: number;
  }>();
  if (!row) notFound();
  return {
    fileObjectId: row.file_object_id,
    fileEntityLinkId: row.file_entity_link_id,
    fileVersion: safePositiveInteger(row.file_version),
  };
}

export function buyerReviewAllowedActions(
  status: ReviewCaseStatus | null,
): readonly BuyerReviewAction[] {
  if (status === null) return SUBMIT_ACTION;
  if (status === 'PENDING_REVIEW') return WITHDRAW_ACTION;
  if (status === 'CHANGES_REQUESTED') {
    return RESUBMIT_WITHDRAW_ACTIONS;
  }
  return NO_ACTIONS;
}

export function assertBuyerReviewBusinessAccess(
  buyer: BuyerPortalContext,
): void {
  if (buyer.accessStatus !== 'ACTIVE') {
    throw new BuyerReviewPortalError('CUSTOMER_NOT_ACTIVE', 409);
  }
  if (buyer.identityReviewStatus !== 'CLEAR') {
    throw new BuyerReviewPortalError('IDENTITY_REVIEW_REQUIRED', 409);
  }
}

async function listCurrentReviewFiles(
  database: SqlDatabase,
  buyerCustomerId: string,
  reviewCaseId: string,
  evidenceVersionId: string,
  now: number,
): Promise<readonly BuyerReviewFileDto[]> {
  const result = await database.prepare(`
    SELECT
      object.id AS file_object_id,
      link.id AS file_entity_link_id,
      object.client_file_name,
      COALESCE(object.detected_mime, object.declared_mime) AS mime,
      COALESCE(object.uploaded_byte_size, object.expected_byte_size)
        AS byte_size,
      object.status AS file_status,
      object.version AS file_version,
      object.verified_at
    FROM review_evidence_version_files version_file
    JOIN file_objects object
      ON object.id=version_file.file_object_id
      AND object.status='VERIFIED'
      AND object.purpose='REVIEW_EVIDENCE'
    JOIN file_upload_intents intent
      ON intent.id=object.upload_intent_id
      AND intent.status='VERIFIED'
      AND intent.purpose='REVIEW_EVIDENCE'
      AND intent.owner_actor_type='BUYER_CUSTOMER'
      AND intent.owner_actor_id=?
    JOIN file_entity_links link
      ON link.id=version_file.file_entity_link_id
      AND link.file_object_id=object.id
      AND link.entity_type='REVIEW'
      AND link.entity_id=?
      AND link.purpose='REVIEW_EVIDENCE'
      AND link.authorization_mode='EXPLICIT_AUDIENCES'
      AND link.revoked_at IS NULL
      AND (link.expires_at IS NULL OR link.expires_at>?)
    JOIN file_entity_audience_grants buyer_grant
      ON buyer_grant.file_entity_link_id=link.id
      AND buyer_grant.subject_type='BUYER'
      AND buyer_grant.buyer_customer_id=?
      AND buyer_grant.revoked_at IS NULL
      AND (buyer_grant.expires_at IS NULL OR buyer_grant.expires_at>?)
    WHERE version_file.review_case_id=?
      AND version_file.evidence_version_id=?
    ORDER BY version_file.created_at, version_file.id
  `).bind(
    buyerCustomerId,
    evidenceVersionId,
    now,
    buyerCustomerId,
    now,
    reviewCaseId,
    evidenceVersionId,
  ).all<ReviewFileRow>();

  return Object.freeze(result.results.map((row) => {
    if (row.file_status !== 'VERIFIED'
      || !isSupportedFileMime(row.mime)) {
      dependencyError();
    }
    return Object.freeze({
      file_object_id: row.file_object_id,
      file_entity_link_id: row.file_entity_link_id,
      client_file_name: row.client_file_name,
      mime: row.mime,
      byte_size: safeNonNegativeInteger(row.byte_size),
      status: 'VERIFIED' as const,
      version: safePositiveInteger(row.file_version),
      verified_at: safeNonNegativeInteger(row.verified_at),
      allowed_actions: READ_FILE_ACTION,
    });
  }));
}

function toEligibleOrderDto(
  row: EligibleOrderRow,
): BuyerReviewEligibleOrderDto {
  validateOrderRow(row);
  if (row.review_case_id === null) {
    if (row.review_status !== null || row.review_version !== null) {
      dependencyError();
    }
  } else if (!isReviewCaseStatus(row.review_status)
    || row.review_status !== 'CHANGES_REQUESTED') {
    dependencyError();
  }
  return {
    order: toOrderSummaryDto(row),
    current_review: row.review_case_id === null
      ? null
      : {
          review_case_id: row.review_case_id,
          status: row.review_status as 'CHANGES_REQUESTED',
          version: safePositiveInteger(row.review_version),
        },
    allowed_actions: buyerReviewAllowedActions(row.review_status),
  };
}

function toReviewSummaryDto(row: ReviewRow): BuyerReviewSummaryDto {
  validateOrderRow(row);
  if (!isReviewCaseStatus(row.review_status)
    || !isPricingReviewType(row.review_type)
    || row.review_type !== row.order_review_type) {
    dependencyError();
  }
  const dueAmount = nullableNonNegativeInteger(
    row.buyer_refund_due_amount_cny_fen,
  );
  const dueAt = nullableNonNegativeInteger(
    row.buyer_refund_became_due_at,
  );
  if ((dueAmount === null) !== (dueAt === null)) dependencyError();
  if (row.review_status === 'APPROVED'
    && (row.review_approved_at === null || dueAmount === null)) {
    dependencyError();
  }
  if (row.review_status !== 'APPROVED'
    && (row.review_approved_at !== null || dueAmount !== null)) {
    dependencyError();
  }
  return {
    review_case_id: row.review_case_id,
    order: toOrderSummaryDto(row),
    review_type: row.review_type,
    status: row.review_status,
    version: safePositiveInteger(row.review_version),
    current_evidence_version_no:
      safePositiveInteger(row.current_evidence_version_no),
    submitted_at: safeNonNegativeInteger(row.submitted_at),
    updated_at: safeNonNegativeInteger(row.updated_at),
    public_change_reason: row.public_change_reason,
    review_url: null,
    review_approved_at:
      nullableNonNegativeInteger(row.review_approved_at),
    buyer_refund_due: dueAmount === null || dueAt === null
      ? null
      : {
          amount_cny_fen: String(dueAmount),
        },
    file_count: safeNonNegativeInteger(row.file_count),
    allowed_actions: buyerReviewAllowedActions(row.review_status),
  };
}

function toOrderSummaryDto(
  row: Pick<
    EligibleOrderRow | ReviewRow,
    | 'formal_order_id'
    | 'marketplace_code'
    | 'amazon_order_number_normalized'
    | 'amazon_order_date'
    | 'product_name_snapshot'
    | 'confirmed_at'
    | 'confirmed_business_date'
    | 'order_status'
  > & { review_type?: PricingReviewType; order_review_type?: PricingReviewType },
): BuyerReviewOrderSummaryDto {
  const reviewType = row.review_type ?? row.order_review_type;
  if (!isPricingReviewType(reviewType)) dependencyError();
  return {
    formal_order_id: row.formal_order_id,
    marketplace: row.marketplace_code,
    amazon_order_number: row.amazon_order_number_normalized,
    amazon_order_date: row.amazon_order_date,
    product_name: row.product_name_snapshot,
    review_type: reviewType,
    confirmed_at: safeNonNegativeInteger(row.confirmed_at),
    confirmed_business_date: row.confirmed_business_date,
    status: 'CONFIRMED',
  };
}

function validateOrderRow(
  row: Pick<
    EligibleOrderRow | ReviewRow,
    'marketplace_code' | 'order_status'
  >,
): void {
  if (row.marketplace_code !== 'JP' || row.order_status !== 'CONFIRMED') {
    dependencyError();
  }
}

function validateLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new BuyerReviewPortalError('VALIDATION_ERROR', 400);
  }
}

function validateIdentifier(value: string, hidden: boolean): void {
  if (typeof value !== 'string'
    || value.length < 1
    || value.length > 120
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new BuyerReviewPortalError(
      hidden ? 'NOT_FOUND' : 'VALIDATION_ERROR',
      hidden ? 404 : 400,
    );
  }
}

function validateNow(now: number): void {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new BuyerReviewPortalError('VALIDATION_ERROR', 400);
  }
}

function safePositiveInteger(value: number | null): number {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 1) dependencyError();
  return numeric;
}

function safeNonNegativeInteger(value: number | null): number {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0) dependencyError();
  return numeric;
}

function nullableNonNegativeInteger(value: number | null): number | null {
  if (value === null) return null;
  return safeNonNegativeInteger(value);
}

function notFound(): never {
  throw new BuyerReviewPortalError('NOT_FOUND', 404);
}

function dependencyError(): never {
  throw new BuyerReviewPortalError('DEPENDENCY_UNAVAILABLE', 503);
}
