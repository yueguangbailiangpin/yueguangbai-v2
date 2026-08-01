import type {
  FixedIntegerString,
  PricingReviewType,
  ReviewCaseStatus,
  SellerReviewEvidenceFileDto,
  SellerReviewPortalDto,
  SellerReviewPortalFilters,
  SellerReviewPortalPage,
  SqlDatabase,
  SupportedFileMime,
} from '@ygb/contracts';
import type { SellerPortalActor } from '../seller-portal/actor';
import {
  decodeSellerPortalCursor,
  encodeSellerPortalCursor,
  isRecord,
  type SellerPortalPagination,
} from '../seller-portal/pagination';
import { SellerReviewPortalError } from './errors';

interface SellerReviewRow {
  review_case_id: string;
  formal_order_id: string;
  amazon_order_number: string;
  store_id: string;
  store_display_name: string;
  marketplace_code: 'JP';
  asin: string;
  product_name: string;
  review_type: PricingReviewType;
  review_status: ReviewCaseStatus;
  review_version: number;
  submitted_at: number;
  updated_at: number;
  decided_at: number | null;
  evidence_version_id: string;
  evidence_version_no: number;
  evidence_submitted_at: number;
  service_fee_amount_cny_fen: number | string | null;
  service_fee_accrued_at: number | null;
}

interface SellerReviewFileRow {
  review_case_id: string;
  file_entity_link_id: string;
  file_version: number;
  detected_mime: SupportedFileMime | null;
  uploaded_byte_size: number | null;
  linked_at: number;
}

interface SellerReviewFileAccessRow {
  review_case_id: string;
  file_object_id: string;
  file_entity_link_id: string;
  file_version: number;
}

interface SellerReviewCursor {
  updated_at: number;
  review_case_id: string;
}

export interface SellerReviewFileAccess {
  reviewCaseId: string;
  fileObjectId: string;
  fileEntityLinkId: string;
  fileVersion: number;
}

export async function listSellerReviews(
  database: SqlDatabase,
  actor: SellerPortalActor,
  pagination: SellerPortalPagination,
  filters: SellerReviewPortalFilters,
  now = Date.now(),
): Promise<SellerReviewPortalPage> {
  requireTimestamp(now);
  const cursor = decodeSellerPortalCursor(
    pagination.cursor,
    isSellerReviewCursor,
  );
  const scope = storeScope(actor, 'formal_order.store_id');
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (filters.store_id !== null) {
    conditions.push('formal_order.store_id=?');
    values.push(filters.store_id);
  }
  if (filters.status !== null) {
    conditions.push('review_case.status=?');
    values.push(filters.status);
  }
  if (filters.asin !== null) {
    conditions.push('formal_order.asin_normalized=?');
    values.push(filters.asin);
  }
  if (filters.review_type !== null) {
    conditions.push('review_case.review_type=?');
    values.push(filters.review_type);
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
      review_case.updated_at < ?
      OR (
        review_case.updated_at=?
        AND review_case.id < ?
      )
    )`);
    values.push(
      cursor.updated_at,
      cursor.updated_at,
      cursor.review_case_id,
    );
  }

  const extra = conditions.length > 0
    ? `AND ${conditions.join(' AND ')}`
    : '';
  const result = await database.prepare(`
    ${selectReviewProjection()}
    WHERE review_case.seller_organization_id=?
      ${scope.sql}
      ${extra}
    ORDER BY review_case.updated_at DESC, review_case.id DESC
    LIMIT ?
  `).bind(
    actor.sellerOrganizationId,
    ...scope.values,
    ...values,
    pagination.limit + 1,
  ).all<SellerReviewRow>();

  const rows = result.results;
  const visible = rows.slice(0, pagination.limit);
  const files = await listVisibleEvidenceFiles(
    database,
    actor,
    visible.map((row) => row.review_case_id),
    now,
  );
  const last = visible.at(-1);
  return Object.freeze({
    items: Object.freeze(visible.map(
      (row) => mapReview(row, files.get(row.review_case_id) ?? []),
    )),
    page: Object.freeze({
      limit: pagination.limit,
      next_cursor: rows.length > pagination.limit && last
        ? encodeSellerPortalCursor({
            updated_at: Number(last.updated_at),
            review_case_id: last.review_case_id,
          })
        : null,
    }),
  });
}

export async function getSellerReview(
  database: SqlDatabase,
  actor: SellerPortalActor,
  reviewCaseId: string,
  now = Date.now(),
): Promise<SellerReviewPortalDto> {
  requireTimestamp(now);
  const scope = storeScope(actor, 'formal_order.store_id');
  const row = await database.prepare(`
    ${selectReviewProjection()}
    WHERE review_case.id=?
      AND review_case.seller_organization_id=?
      ${scope.sql}
  `).bind(
    reviewCaseId,
    actor.sellerOrganizationId,
    ...scope.values,
  ).first<SellerReviewRow>();

  if (!row) {
    throw new SellerReviewPortalError(
      'SELLER_REVIEW_NOT_FOUND',
      404,
    );
  }
  const files = await listVisibleEvidenceFiles(
    database,
    actor,
    [row.review_case_id],
    now,
  );
  return mapReview(row, files.get(row.review_case_id) ?? []);
}

export async function requireSellerReviewEvidenceFile(
  database: SqlDatabase,
  actor: SellerPortalActor,
  reviewCaseId: string,
  fileEntityLinkId: string,
  now = Date.now(),
): Promise<SellerReviewFileAccess> {
  requireTimestamp(now);
  const scope = storeScope(actor, 'formal_order.store_id');
  const row = await database.prepare(`
    SELECT
      review_case.id AS review_case_id,
      object.id AS file_object_id,
      link.id AS file_entity_link_id,
      object.version AS file_version
    FROM review_cases review_case
    JOIN formal_orders formal_order
      ON formal_order.id=review_case.formal_order_id
      AND formal_order.seller_organization_id=
        review_case.seller_organization_id
    JOIN review_evidence_versions evidence
      ON evidence.review_case_id=review_case.id
      AND evidence.formal_order_id=formal_order.id
      AND evidence.version_no=review_case.current_evidence_version_no
    JOIN review_evidence_version_files evidence_file
      ON evidence_file.review_case_id=review_case.id
      AND evidence_file.evidence_version_id=evidence.id
      AND evidence_file.formal_order_id=formal_order.id
    JOIN file_entity_links link
      ON link.id=evidence_file.file_entity_link_id
      AND link.file_object_id=evidence_file.file_object_id
      AND link.entity_type='REVIEW'
      AND link.entity_id=evidence.id
      AND link.purpose='REVIEW_EVIDENCE'
      AND link.authorization_mode='EXPLICIT_AUDIENCES'
    JOIN file_objects object
      ON object.id=evidence_file.file_object_id
      AND object.status='VERIFIED'
      AND object.purpose='REVIEW_EVIDENCE'
    JOIN file_upload_intents intent
      ON intent.id=object.upload_intent_id
      AND intent.status='VERIFIED'
      AND intent.purpose='REVIEW_EVIDENCE'
    WHERE review_case.id=?
      AND review_case.seller_organization_id=?
      ${scope.sql}
      AND link.id=?
      AND link.revoked_at IS NULL
      AND (link.expires_at IS NULL OR link.expires_at>?)
      AND EXISTS (
        SELECT 1
        FROM file_entity_audience_grants seller_grant
        WHERE seller_grant.file_entity_link_id=link.id
          AND seller_grant.subject_type='SELLER_ORGANIZATION'
          AND seller_grant.seller_organization_id=?
          AND seller_grant.revoked_at IS NULL
          AND (
            seller_grant.expires_at IS NULL
            OR seller_grant.expires_at>?
          )
      )
    LIMIT 1
  `).bind(
    reviewCaseId,
    actor.sellerOrganizationId,
    ...scope.values,
    fileEntityLinkId,
    now,
    actor.sellerOrganizationId,
    now,
  ).first<SellerReviewFileAccessRow>();

  if (!row) {
    throw new SellerReviewPortalError(
      'SELLER_REVIEW_FILE_NOT_FOUND',
      404,
    );
  }
  return Object.freeze({
    reviewCaseId: row.review_case_id,
    fileObjectId: row.file_object_id,
    fileEntityLinkId: row.file_entity_link_id,
    fileVersion: Number(row.file_version),
  });
}

function selectReviewProjection(): string {
  return `
    SELECT
      review_case.id AS review_case_id,
      formal_order.id AS formal_order_id,
      formal_order.amazon_order_number_normalized AS amazon_order_number,
      formal_order.store_id,
      store.display_name AS store_display_name,
      formal_order.marketplace_code,
      formal_order.asin_normalized AS asin,
      formal_order.product_name_snapshot AS product_name,
      review_case.review_type,
      review_case.status AS review_status,
      review_case.version AS review_version,
      review_case.submitted_at,
      review_case.updated_at,
      review_case.decided_at,
      evidence.id AS evidence_version_id,
      evidence.version_no AS evidence_version_no,
      evidence.created_at AS evidence_submitted_at,
      service_fee.amount_cny_fen AS service_fee_amount_cny_fen,
      service_fee.created_at AS service_fee_accrued_at
    FROM review_cases review_case
    JOIN formal_orders formal_order
      ON formal_order.id=review_case.formal_order_id
      AND formal_order.seller_organization_id=
        review_case.seller_organization_id
    JOIN seller_stores store
      ON store.id=formal_order.store_id
      AND store.organization_id=review_case.seller_organization_id
    JOIN review_evidence_versions evidence
      ON evidence.review_case_id=review_case.id
      AND evidence.formal_order_id=formal_order.id
      AND evidence.version_no=review_case.current_evidence_version_no
    LEFT JOIN review_events service_fee
      ON service_fee.review_case_id=review_case.id
      AND service_fee.formal_order_id=formal_order.id
      AND service_fee.event_type='SELLER_SERVICE_FEE_ACCRUED'
  `;
}

async function listVisibleEvidenceFiles(
  database: SqlDatabase,
  actor: SellerPortalActor,
  reviewCaseIds: readonly string[],
  now: number,
): Promise<ReadonlyMap<string, readonly SellerReviewEvidenceFileDto[]>> {
  if (reviewCaseIds.length === 0) return new Map();
  const placeholders = reviewCaseIds.map(() => '?').join(', ');
  const result = await database.prepare(`
    SELECT
      review_case.id AS review_case_id,
      link.id AS file_entity_link_id,
      object.version AS file_version,
      object.detected_mime,
      object.uploaded_byte_size,
      evidence_file.created_at AS linked_at
    FROM review_cases review_case
    JOIN review_evidence_versions evidence
      ON evidence.review_case_id=review_case.id
      AND evidence.formal_order_id=review_case.formal_order_id
      AND evidence.version_no=review_case.current_evidence_version_no
    JOIN review_evidence_version_files evidence_file
      ON evidence_file.review_case_id=review_case.id
      AND evidence_file.evidence_version_id=evidence.id
      AND evidence_file.formal_order_id=review_case.formal_order_id
    JOIN file_entity_links link
      ON link.id=evidence_file.file_entity_link_id
      AND link.file_object_id=evidence_file.file_object_id
      AND link.entity_type='REVIEW'
      AND link.entity_id=evidence.id
      AND link.purpose='REVIEW_EVIDENCE'
      AND link.authorization_mode='EXPLICIT_AUDIENCES'
    JOIN file_objects object
      ON object.id=evidence_file.file_object_id
      AND object.status='VERIFIED'
      AND object.purpose='REVIEW_EVIDENCE'
    JOIN file_upload_intents intent
      ON intent.id=object.upload_intent_id
      AND intent.status='VERIFIED'
      AND intent.purpose='REVIEW_EVIDENCE'
    WHERE review_case.id IN (${placeholders})
      AND review_case.seller_organization_id=?
      AND link.revoked_at IS NULL
      AND (link.expires_at IS NULL OR link.expires_at>?)
      AND EXISTS (
        SELECT 1
        FROM file_entity_audience_grants seller_grant
        WHERE seller_grant.file_entity_link_id=link.id
          AND seller_grant.subject_type='SELLER_ORGANIZATION'
          AND seller_grant.seller_organization_id=?
          AND seller_grant.revoked_at IS NULL
          AND (
            seller_grant.expires_at IS NULL
            OR seller_grant.expires_at>?
          )
      )
    ORDER BY review_case.id, evidence_file.created_at, evidence_file.id
  `).bind(
    ...reviewCaseIds,
    actor.sellerOrganizationId,
    now,
    actor.sellerOrganizationId,
    now,
  ).all<SellerReviewFileRow>();

  const grouped = new Map<string, SellerReviewEvidenceFileDto[]>();
  for (const row of result.results) {
    if (row.detected_mime === null
      || row.uploaded_byte_size === null
      || !Number.isSafeInteger(Number(row.file_version))
      || Number(row.file_version) < 1
      || !Number.isSafeInteger(Number(row.uploaded_byte_size))
      || Number(row.uploaded_byte_size) < 0) {
      throw new SellerReviewPortalError(
        'DEPENDENCY_UNAVAILABLE',
        503,
      );
    }
    const values = grouped.get(row.review_case_id) ?? [];
    values.push(Object.freeze({
      file_entity_link_id: row.file_entity_link_id,
      file_version: Number(row.file_version),
      content_type: row.detected_mime,
      byte_size: Number(row.uploaded_byte_size),
      created_at: Number(row.linked_at),
    }));
    grouped.set(row.review_case_id, values);
  }
  return new Map(
    [...grouped.entries()].map(([key, values]) => [
      key,
      Object.freeze(values),
    ]),
  );
}

function mapReview(
  row: SellerReviewRow,
  evidenceFiles: readonly SellerReviewEvidenceFileDto[],
): SellerReviewPortalDto {
  const serviceFee = row.service_fee_amount_cny_fen === null
    || row.service_fee_accrued_at === null
    ? null
    : Object.freeze({
        amount_cny_fen: integerString(row.service_fee_amount_cny_fen),
        accrued_at: Number(row.service_fee_accrued_at),
      });
  const allowedActions = evidenceFiles.length > 0
    ? Object.freeze(['VIEW', 'READ_EVIDENCE'] as const)
    : Object.freeze(['VIEW'] as const);
  return Object.freeze({
    review_case_id: row.review_case_id,
    formal_order: Object.freeze({
      id: row.formal_order_id,
      amazon_order_number: row.amazon_order_number,
    }),
    store: Object.freeze({
      id: row.store_id,
      display_name: row.store_display_name,
    }),
    marketplace_code: row.marketplace_code,
    asin: row.asin,
    product_name: row.product_name,
    review_type: row.review_type,
    status: row.review_status,
    version: Number(row.review_version),
    // Phase 5A has no authoritative review URL column. Never infer one
    // from buyer notes, file metadata, or internal review metadata.
    review_url: null,
    submitted_at: Number(row.submitted_at),
    approved_at: row.review_status === 'APPROVED'
      && row.decided_at !== null
      ? Number(row.decided_at)
      : null,
    evidence: Object.freeze({
      version_id: row.evidence_version_id,
      version_no: Number(row.evidence_version_no),
      submitted_at: Number(row.evidence_submitted_at),
      files: Object.freeze([...evidenceFiles]),
    }),
    service_fee_accrued: serviceFee,
    allowed_actions: allowedActions,
  });
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

function integerString(value: number | string): FixedIntegerString {
  const serialized = String(value);
  if (!/^(0|[1-9][0-9]*)$/u.test(serialized)) {
    throw new SellerReviewPortalError(
      'DEPENDENCY_UNAVAILABLE',
      503,
    );
  }
  return serialized;
}

function requireTimestamp(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new SellerReviewPortalError('VALIDATION_ERROR', 400);
  }
}

function isSellerReviewCursor(
  value: unknown,
): value is SellerReviewCursor {
  return isRecord(value)
    && Number.isSafeInteger(value['updated_at'])
    && Number(value['updated_at']) >= 0
    && typeof value['review_case_id'] === 'string'
    && value['review_case_id'].length >= 1
    && value['review_case_id'].length <= 120;
}
