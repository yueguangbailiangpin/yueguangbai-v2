import {
  FILE_OBJECT_STATUSES,
  isSupportedFileMime,
  type BuyerOrderEvidenceAction,
  type BuyerOrderEvidenceDto,
  type BuyerOrderEvidenceEligibleReservationDto,
  type BuyerOrderEvidenceFileDto,
  type BuyerOrderEvidencePageDto,
  type BuyerOrderEvidenceReservationDto,
  type DemandTaskType,
  type FileObjectStatus,
  type OrderEvidenceStatus,
  type SqlDatabase,
  type SupportedFileMime,
} from '@ygb/contracts';
import type { BuyerPortalContext } from '../buyer-portal/buyer-context';
import { BuyerOrderEvidencePortalError } from './errors';
import {
  encodeEligibleReservationCursor,
  encodeOrderEvidenceCursor,
  type EligibleReservationCursor,
  type OrderEvidenceCursor,
} from './pagination';

interface EligibleReservationRow {
  reservation_id: string;
  reservation_submitted_at: number;
  order_deadline_snapshot: number;
  demand_id: string;
  marketplace_code: 'JP';
  product_name: string;
  store_display_name: string;
  review_type: DemandTaskType;
  submission_status: OrderEvidenceStatus | null;
  submission_version: number | null;
}

interface OrderEvidenceRow {
  submission_id: string;
  reservation_id: string;
  demand_id: string;
  marketplace_code: 'JP';
  product_name: string;
  store_display_name: string;
  review_type: DemandTaskType;
  order_deadline_snapshot: number;
  status: OrderEvidenceStatus;
  aggregate_version: number;
  evidence_version_no: number;
  evidence_version_id: string;
  amazon_order_number_normalized: string;
  amazon_order_date: string | null;
  final_paid_jpy: number;
  buyer_self_pay_bps_snapshot: number;
  buyer_self_pay_jpy: number;
  buyer_refundable_principal_jpy: number;
  price_mismatch: number;
  price_difference_jpy: number;
  public_change_reason: string | null;
  submitted_at: number;
  updated_at: number;
  verified_at: number | null;
}

interface FileSummaryRow {
  file_object_id: string;
  file_entity_link_id: string | null;
  client_file_name: string;
  mime: SupportedFileMime;
  byte_size: number;
  status: FileObjectStatus;
  visibility: 'INTERNAL_ONLY' | 'BUYER_VISIBLE';
  verified_at: number | null;
  file_version: number;
  can_read: number;
}

export interface BuyerOrderEvidenceFileLinkSource {
  fileObjectId: string;
  fileEntityLinkId: string;
  fileVersion: number;
}


const RESERVATION_RELATION_JOINS = `
  JOIN demand_batches demand
    ON demand.id=reservation.demand_batch_id
    AND demand.organization_id=reservation.organization_id
    AND demand.store_id=reservation.store_id
    AND demand.product_id=reservation.product_id
    AND demand.product_version_no=reservation.product_version_no
    AND demand.marketplace_code=reservation.marketplace_code
  JOIN products product
    ON product.id=reservation.product_id
    AND product.organization_id=reservation.organization_id
    AND product.store_id=reservation.store_id
    AND product.marketplace_code=reservation.marketplace_code
  JOIN product_versions product_version
    ON product_version.product_id=reservation.product_id
    AND product_version.version_no=reservation.product_version_no
  JOIN seller_stores store
    ON store.id=reservation.store_id
    AND store.organization_id=reservation.organization_id
    AND store.marketplace_code=reservation.marketplace_code
  JOIN seller_organizations organization
    ON organization.id=reservation.organization_id
    AND organization.marketplace_code=reservation.marketplace_code
`;

const ORDER_EVIDENCE_SELECT = `
  SELECT
    submission.id AS submission_id,
    reservation.id AS reservation_id,
    demand.id AS demand_id,
    submission.marketplace_code,
    product_version.product_name,
    store.display_name AS store_display_name,
    demand.task_type AS review_type,
    reservation.order_deadline_snapshot,
    submission.status,
    submission.version AS aggregate_version,
    submission.current_version_no AS evidence_version_no,
    evidence.id AS evidence_version_id,
    evidence.amazon_order_number_normalized,
    evidence.amazon_order_date,
    evidence.final_paid_jpy,
    evidence.buyer_self_pay_bps_snapshot,
    evidence.buyer_self_pay_jpy,
    evidence.buyer_refundable_principal_jpy,
    evidence.price_mismatch,
    evidence.price_difference_jpy,
    submission.public_change_reason,
    submission.submitted_at,
    submission.updated_at,
    submission.verified_at
  FROM order_evidence_submissions submission
  JOIN product_reservations reservation
    ON reservation.id=submission.reservation_id
    AND reservation.buyer_customer_id=submission.buyer_customer_id
    AND reservation.marketplace_code=submission.marketplace_code
  ${RESERVATION_RELATION_JOINS}
  JOIN order_evidence_versions evidence
    ON evidence.submission_id=submission.id
    AND evidence.version_no=submission.current_version_no
    AND evidence.reservation_id=reservation.id
    AND evidence.buyer_customer_id=submission.buyer_customer_id
    AND evidence.marketplace_code=submission.marketplace_code
`;

const NO_ACTIONS = Object.freeze(
  [] as BuyerOrderEvidenceAction[],
);
const SUBMIT_ACTION = Object.freeze(
  ['SUBMIT'] as BuyerOrderEvidenceAction[],
);
const WITHDRAW_ACTION = Object.freeze(
  ['WITHDRAW'] as BuyerOrderEvidenceAction[],
);
const RESUBMIT_WITHDRAW_ACTIONS = Object.freeze(
  ['RESUBMIT', 'WITHDRAW'] as BuyerOrderEvidenceAction[],
);

export async function listEligibleOrderEvidenceReservations(
  database: SqlDatabase,
  buyer: BuyerPortalContext,
  options: {
    limit: number;
    cursor: EligibleReservationCursor | null;
  },
): Promise<
  BuyerOrderEvidencePageDto<BuyerOrderEvidenceEligibleReservationDto>
> {
  assertBuyerBusinessAccess(buyer);
  validateLimit(options.limit);

  const cursorSql = options.cursor
    ? `
      AND (
        reservation.order_deadline_snapshot>?
        OR (
          reservation.order_deadline_snapshot=?
          AND reservation.submitted_at>?
        )
        OR (
          reservation.order_deadline_snapshot=?
          AND reservation.submitted_at=?
          AND reservation.id>?
        )
      )
    `
    : '';
  const bindings: unknown[] = [buyer.buyerCustomerId];
  if (options.cursor) {
    bindings.push(
      options.cursor.orderDeadline,
      options.cursor.orderDeadline,
      options.cursor.submittedAt,
      options.cursor.orderDeadline,
      options.cursor.submittedAt,
      options.cursor.id,
    );
  }
  bindings.push(options.limit + 1);

  const result = await database.prepare(`
    SELECT
      reservation.id AS reservation_id,
      reservation.submitted_at AS reservation_submitted_at,
      reservation.order_deadline_snapshot,
      demand.id AS demand_id,
      reservation.marketplace_code,
      product_version.product_name,
      store.display_name AS store_display_name,
      demand.task_type AS review_type,
      submission.status AS submission_status,
      submission.version AS submission_version
    FROM product_reservations reservation
    ${RESERVATION_RELATION_JOINS}
    JOIN order_instructions instruction
      ON instruction.reservation_id=reservation.id
      AND instruction.buyer_customer_id=reservation.buyer_customer_id
      AND instruction.marketplace_code=reservation.marketplace_code
      AND instruction.status='ACTIVE'
    LEFT JOIN order_evidence_submissions submission
      ON submission.reservation_id=reservation.id
      AND submission.buyer_customer_id=reservation.buyer_customer_id
      AND submission.marketplace_code=reservation.marketplace_code
    WHERE reservation.buyer_customer_id=?
      AND reservation.status='APPROVED'
      AND (
        submission.id IS NULL
        OR submission.status='CHANGES_REQUESTED'
      )
      ${cursorSql}
    ORDER BY
      reservation.order_deadline_snapshot,
      reservation.submitted_at,
      reservation.id
    LIMIT ?
  `).bind(...bindings).all<EligibleReservationRow>();

  const hasMore = result.results.length > options.limit;
  const visibleRows = hasMore
    ? result.results.slice(0, options.limit)
    : result.results;
  const last = visibleRows.at(-1) ?? null;
  return {
    items: Object.freeze(visibleRows.map(toEligibleReservationDto)),
    next_cursor: hasMore && last
      ? encodeEligibleReservationCursor({
          orderDeadline: Number(last.order_deadline_snapshot),
          submittedAt: Number(last.reservation_submitted_at),
          id: last.reservation_id,
        })
      : null,
  };
}

export async function listBuyerOrderEvidence(
  database: SqlDatabase,
  buyer: BuyerPortalContext,
  options: {
    limit: number;
    cursor: OrderEvidenceCursor | null;
    status?: readonly OrderEvidenceStatus[];
  },
): Promise<BuyerOrderEvidencePageDto<BuyerOrderEvidenceDto>> {
  assertBuyerBusinessAccess(buyer);
  validateLimit(options.limit);

  const statusSql = options.status && options.status.length > 0
    ? `AND submission.status IN (${options.status.map(() => '?').join(',')})`
    : '';
  const cursorSql = options.cursor
    ? `
      AND (
        submission.updated_at<?
        OR (
          submission.updated_at=?
          AND submission.id<?
        )
      )
    `
    : '';
  const bindings: unknown[] = [buyer.buyerCustomerId];
  if (options.status && options.status.length > 0) {
    bindings.push(...options.status);
  }
  if (options.cursor) {
    bindings.push(
      options.cursor.updatedAt,
      options.cursor.updatedAt,
      options.cursor.id,
    );
  }
  bindings.push(options.limit + 1);

  const result = await database.prepare(`
    ${ORDER_EVIDENCE_SELECT}
    WHERE submission.buyer_customer_id=?
      ${statusSql}
      ${cursorSql}
    ORDER BY submission.updated_at DESC, submission.id DESC
    LIMIT ?
  `).bind(...bindings).all<OrderEvidenceRow>();

  const hasMore = result.results.length > options.limit;
  const visibleRows = hasMore
    ? result.results.slice(0, options.limit)
    : result.results;
  const items = await Promise.all(visibleRows.map(async (row) =>
    toOrderEvidenceDto(
      row,
      await listOrderEvidenceFiles(
        database,
        buyer.buyerCustomerId,
        row.evidence_version_id,
      ),
    )));
  const last = visibleRows.at(-1) ?? null;
  return {
    items: Object.freeze(items),
    next_cursor: hasMore && last
      ? encodeOrderEvidenceCursor({
          updatedAt: Number(last.updated_at),
          id: last.submission_id,
        })
      : null,
  };
}

export async function getBuyerOrderEvidence(
  database: SqlDatabase,
  buyer: BuyerPortalContext,
  submissionId: string,
): Promise<BuyerOrderEvidenceDto> {
  assertBuyerBusinessAccess(buyer);
  validateIdentifier(submissionId);

  const row = await database.prepare(`
    ${ORDER_EVIDENCE_SELECT}
    WHERE submission.id=?
      AND submission.buyer_customer_id=?
    LIMIT 1
  `).bind(
    submissionId,
    buyer.buyerCustomerId,
  ).first<OrderEvidenceRow>();
  if (!row) {
    throw new BuyerOrderEvidencePortalError('NOT_FOUND', 404);
  }

  return toOrderEvidenceDto(
    row,
    await listOrderEvidenceFiles(
      database,
      buyer.buyerCustomerId,
      row.evidence_version_id,
    ),
  );
}

export async function requireBuyerOrderEvidenceReservationId(
  database: SqlDatabase,
  buyer: BuyerPortalContext,
  submissionId: string,
): Promise<string> {
  assertBuyerBusinessAccess(buyer);
  validateIdentifier(submissionId);
  const row = await database.prepare(`
    SELECT reservation_id
    FROM order_evidence_submissions
    WHERE id=?
      AND buyer_customer_id=?
    LIMIT 1
  `).bind(
    submissionId,
    buyer.buyerCustomerId,
  ).first<{ reservation_id: string }>();
  if (!row) {
    throw new BuyerOrderEvidencePortalError('NOT_FOUND', 404);
  }
  return row.reservation_id;
}

export async function requireBuyerOrderEvidenceFileLink(
  database: SqlDatabase,
  buyer: BuyerPortalContext,
  submissionId: string,
  fileEntityLinkId: string,
  now = Date.now(),
): Promise<BuyerOrderEvidenceFileLinkSource> {
  assertBuyerBusinessAccess(buyer);
  validateIdentifier(submissionId);
  validateIdentifier(fileEntityLinkId);
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new BuyerOrderEvidencePortalError('NOT_FOUND', 404);
  }

  const row = await database.prepare(`
    SELECT
      object.id AS file_object_id,
      link.id AS file_entity_link_id,
      object.version AS file_version
    FROM order_evidence_submissions submission
    JOIN order_evidence_versions evidence
      ON evidence.submission_id=submission.id
      AND evidence.version_no=submission.current_version_no
    JOIN order_evidence_version_files version_file
      ON version_file.submission_id=submission.id
      AND version_file.version_id=evidence.id
      AND version_file.buyer_customer_id=submission.buyer_customer_id
      AND version_file.visibility='BUYER_VISIBLE'
    JOIN file_objects object
      ON object.id=version_file.file_object_id
      AND object.status='VERIFIED'
      AND object.purpose='ORDER_EVIDENCE'
      AND object.visibility='BUYER_VISIBLE'
    JOIN file_upload_intents intent
      ON intent.id=object.upload_intent_id
      AND intent.status='VERIFIED'
      AND intent.purpose='ORDER_EVIDENCE'
      AND intent.visibility='BUYER_VISIBLE'
      AND intent.owner_actor_type='BUYER_CUSTOMER'
      AND intent.owner_actor_id=submission.buyer_customer_id
    JOIN file_entity_links link
      ON link.id=version_file.file_entity_link_id
      AND link.file_object_id=object.id
      AND link.entity_type='ORDER'
      AND link.entity_id=evidence.id
      AND link.purpose='ORDER_EVIDENCE'
      AND link.visibility='BUYER_VISIBLE'
      AND link.revoked_at IS NULL
      AND (link.expires_at IS NULL OR link.expires_at>?)
    WHERE submission.id=?
      AND submission.buyer_customer_id=?
      AND link.id=?
      AND (
        link.authorization_mode='LEGACY_VISIBILITY'
        OR EXISTS (
          SELECT 1 FROM file_entity_audience_grants buyer_grant
          WHERE buyer_grant.file_entity_link_id=link.id
            AND buyer_grant.subject_type='BUYER'
            AND buyer_grant.buyer_customer_id=submission.buyer_customer_id
            AND buyer_grant.revoked_at IS NULL
            AND (buyer_grant.expires_at IS NULL OR buyer_grant.expires_at>?)
        )
      )
    LIMIT 1
  `).bind(
    now,
    submissionId,
    buyer.buyerCustomerId,
    fileEntityLinkId,
    now,
  ).first<{
    file_object_id: string;
    file_entity_link_id: string;
    file_version: number;
  }>();
  if (!row) throw new BuyerOrderEvidencePortalError('NOT_FOUND', 404);
  const fileVersion = Number(row.file_version);
  if (!Number.isSafeInteger(fileVersion) || fileVersion < 1) {
    throw new BuyerOrderEvidencePortalError('NOT_FOUND', 404);
  }
  return {
    fileObjectId: row.file_object_id,
    fileEntityLinkId: row.file_entity_link_id,
    fileVersion,
  };
}

function toEligibleReservationDto(
  row: EligibleReservationRow,
): BuyerOrderEvidenceEligibleReservationDto {
  return {
    ...toReservationDto(row),
    current_order_evidence_status: row.submission_status,
    current_order_evidence_version:
      nullableNumber(row.submission_version),
    allowed_actions: allowedActionsForStatus(row.submission_status),
  };
}

function toReservationDto(
  row: Pick<
    EligibleReservationRow | OrderEvidenceRow,
    | 'reservation_id'
    | 'demand_id'
    | 'marketplace_code'
    | 'product_name'
    | 'store_display_name'
    | 'review_type'
    | 'order_deadline_snapshot'
  >,
): BuyerOrderEvidenceReservationDto {
  return {
    reservation_id: row.reservation_id,
    demand_id: row.demand_id,
    marketplace_code: row.marketplace_code,
    product_name: row.product_name,
    store_display_name: row.store_display_name,
    review_type: row.review_type,
    order_deadline: Number(row.order_deadline_snapshot),
  };
}

function toOrderEvidenceDto(
  row: OrderEvidenceRow,
  files: readonly BuyerOrderEvidenceFileDto[],
): BuyerOrderEvidenceDto {
  return {
    submission_id: row.submission_id,
    reservation: toReservationDto(row),
    marketplace: row.marketplace_code,
    amazon_order_number_display:
      row.amazon_order_number_normalized,
    amazon_order_date: row.amazon_order_date,
    final_paid_jpy: Number(row.final_paid_jpy),
    buyer_self_pay_bps: Number(row.buyer_self_pay_bps_snapshot),
    buyer_self_pay_jpy: Number(row.buyer_self_pay_jpy),
    buyer_refundable_principal_jpy:
      Number(row.buyer_refundable_principal_jpy),
    price_mismatch: Number(row.price_mismatch) === 1,
    price_difference_jpy: Number(row.price_difference_jpy),
    status: row.status,
    version: Number(row.aggregate_version),
    evidence_version_no: Number(row.evidence_version_no),
    submitted_at: Number(row.submitted_at),
    updated_at: Number(row.updated_at),
    verified_at: nullableNumber(row.verified_at),
    public_change_reason: row.public_change_reason,
    files,
    allowed_actions: allowedActionsForStatus(row.status),
  };
}

async function listOrderEvidenceFiles(
  database: SqlDatabase,
  buyerCustomerId: string,
  evidenceVersionId: string,
): Promise<readonly BuyerOrderEvidenceFileDto[]> {
  const result = await database.prepare(`
    SELECT
      version_file.file_object_id,
      link.id AS file_entity_link_id,
      object.client_file_name,
      COALESCE(object.detected_mime, object.declared_mime) AS mime,
      COALESCE(
        object.uploaded_byte_size,
        object.expected_byte_size
      ) AS byte_size,
      object.status,
      version_file.visibility,
      object.verified_at
      , object.version AS file_version
      , CASE WHEN
          object.status='VERIFIED'
          AND version_file.visibility='BUYER_VISIBLE'
          AND link.file_object_id=object.id
          AND link.entity_type='ORDER'
          AND link.entity_id=?
          AND link.purpose='ORDER_EVIDENCE'
          AND link.visibility='BUYER_VISIBLE'
          AND link.revoked_at IS NULL
          AND (link.expires_at IS NULL OR link.expires_at>?)
          AND (
            link.authorization_mode='LEGACY_VISIBILITY'
            OR EXISTS (
              SELECT 1 FROM file_entity_audience_grants grant_row
              WHERE grant_row.file_entity_link_id=link.id
                AND grant_row.subject_type='BUYER'
                AND grant_row.buyer_customer_id=?
                AND grant_row.revoked_at IS NULL
                AND (grant_row.expires_at IS NULL OR grant_row.expires_at>?)
            )
          )
        THEN 1 ELSE 0 END AS can_read
    FROM order_evidence_version_files version_file
    JOIN file_objects object
      ON object.id=version_file.file_object_id
    JOIN file_upload_intents intent
      ON intent.id=object.upload_intent_id
    LEFT JOIN file_entity_links link
      ON link.id=version_file.file_entity_link_id
    WHERE version_file.version_id=?
      AND version_file.buyer_customer_id=?
      AND intent.owner_actor_type='BUYER_CUSTOMER'
      AND intent.owner_actor_id=?
    ORDER BY version_file.created_at, version_file.id
  `).bind(
    evidenceVersionId,
    Date.now(),
    buyerCustomerId,
    Date.now(),
    evidenceVersionId,
    buyerCustomerId,
    buyerCustomerId,
  ).all<FileSummaryRow>();

  return Object.freeze(result.results.map((row) => {
    if (!isSupportedFileMime(row.mime)
      || !(FILE_OBJECT_STATUSES as readonly string[])
        .includes(row.status)
      || !Number.isSafeInteger(Number(row.byte_size))
      || Number(row.byte_size) < 0
      || (row.visibility !== 'INTERNAL_ONLY'
        && row.visibility !== 'BUYER_VISIBLE')) {
      throw new BuyerOrderEvidencePortalError(
        'DEPENDENCY_UNAVAILABLE',
        503,
      );
    }
    const readable = Number(row.can_read) === 1
      && typeof row.file_entity_link_id === 'string'
      && row.file_entity_link_id.length > 0
      && Number.isSafeInteger(Number(row.file_version))
      && Number(row.file_version) > 0;
    const base = {
      file_object_id: row.file_object_id,
      client_file_name: row.client_file_name,
      mime: row.mime,
      byte_size: Number(row.byte_size),
      status: row.status,
      visibility: row.visibility,
      verified_at: nullableNumber(row.verified_at),
    };
    return readable
      ? Object.freeze({
          ...base,
          file_entity_link_id: row.file_entity_link_id!,
          version: Number(row.file_version),
          allowed_actions: Object.freeze(['CREATE_READ_INTENT'] as const),
        })
      : Object.freeze({
          ...base,
          file_entity_link_id: null,
          version: null,
          allowed_actions: Object.freeze([] as const),
        });
  }));
}

function allowedActionsForStatus(
  status: OrderEvidenceStatus | null,
): readonly BuyerOrderEvidenceAction[] {
  if (status === null) return SUBMIT_ACTION;
  if (status === 'PENDING_VERIFICATION') return WITHDRAW_ACTION;
  if (status === 'CHANGES_REQUESTED') {
    return RESUBMIT_WITHDRAW_ACTIONS;
  }
  return NO_ACTIONS;
}

function assertBuyerBusinessAccess(
  buyer: BuyerPortalContext,
): void {
  if (buyer.accessStatus !== 'ACTIVE') {
    throw new BuyerOrderEvidencePortalError(
      'CUSTOMER_NOT_ACTIVE',
      409,
    );
  }
  if (buyer.identityReviewStatus !== 'CLEAR') {
    throw new BuyerOrderEvidencePortalError(
      'IDENTITY_REVIEW_REQUIRED',
      409,
    );
  }
}

function validateLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new BuyerOrderEvidencePortalError(
      'VALIDATION_ERROR',
      400,
    );
  }
}

function validateIdentifier(value: string): void {
  if (typeof value !== 'string'
    || value.length < 1
    || value.length > 120
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new BuyerOrderEvidencePortalError('NOT_FOUND', 404);
  }
}

function nullableNumber(value: number | null): number | null {
  return value === null ? null : Number(value);
}
