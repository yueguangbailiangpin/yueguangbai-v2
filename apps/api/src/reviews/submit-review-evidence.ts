import {
  isPricingReviewType,
  type FileActor,
  type PricingReviewType,
  type ReviewEvidenceFileInput,
  type SqlDatabase,
  type SqlStatement,
  type SubmitReviewEvidenceResult,
} from '@ygb/contracts';
import { hashCanonicalJson } from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  markIdempotencyFailed,
} from '../foundation/idempotency';
import { batchWithAssignmentRetry, prepareDirectWorkItem } from '../staff-assignment';
import type { FileAuthorizationService } from '../files/authorization';
import { createExplicitAudienceFileLinkStatements } from '../files/explicit-audience-links';
import {
  listReviewEvidenceFiles,
  requireFormalOrderForBuyerReview,
  type FormalOrderReviewSourceRow,
  type ReviewEvidenceFileRow,
} from './review-records';
import { insertReviewEventStatement } from './review-events';
import {
  cleanExpectedVersion,
  cleanOptionalReviewText,
  cleanReviewIdentifier,
  cleanReviewTimestamp,
  cleanReviewUrl,
  normalizeReviewError,
  normalizeReviewFileInputs,
  ReviewError,
  validateBuyerReviewActor,
  type BuyerReviewActor,
} from './review-shared';

interface PreparedReviewFile {
  fileObjectId: string;
  linkId: string;
  versionFileId: string;
  statements: readonly SqlStatement[];
}

export async function submitReviewEvidence(
  database: SqlDatabase,
  fileAuthorization: FileAuthorizationService,
  input: {
    formalOrderId: string;
    expectedVersion: number;
    reviewType: PricingReviewType;
    reviewUrl?: string | null;
    evidenceFiles: readonly ReviewEvidenceFileInput[];
    buyerNote?: string | null;
  },
  command: {
    actor: BuyerReviewActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<SubmitReviewEvidenceResult> {
  validateBuyerReviewActor(command.actor);
  const formalOrderId = cleanReviewIdentifier(input.formalOrderId);
  const expectedVersion = cleanExpectedVersion(input.expectedVersion, { allowZero: true });
  if (!isPricingReviewType(input.reviewType)) {
    throw new ReviewError('VALIDATION_ERROR', 400);
  }
  const reviewUrl = cleanReviewUrl(input.reviewType, input.reviewUrl);
  const evidenceFiles = normalizeReviewFileInputs(input.evidenceFiles);
  const buyerNote = cleanOptionalReviewText(input.buyerNote, 2000);
  const now = cleanReviewTimestamp(command.now ?? Date.now());
  const requestHash = await hashCanonicalJson({
    action: 'SUBMIT_REVIEW_EVIDENCE',
    formal_order_id: formalOrderId,
    expected_version: expectedVersion,
    review_type: input.reviewType,
    review_url: reviewUrl,
    evidence_files: evidenceFiles.map((file) => ({
      file_object_id: file.fileObjectId,
      expected_file_version: file.expectedFileVersion,
    })),
    buyer_note: buyerNote,
  });
  const acquired = await acquireIdempotency<SubmitReviewEvidenceResult>(database, {
    actorType: 'BUYER_CUSTOMER',
    actorId: command.actor.buyerCustomerId,
    action: 'SUBMIT_REVIEW_EVIDENCE',
    targetType: 'FORMAL_ORDER',
    targetId: formalOrderId,
    idempotencyKey: command.idempotencyKey,
    requestHash,
  }, { now });
  if (acquired.kind === 'REPLAY') return { ...acquired.response, replayed: true };

  try {
    const source = await requireFormalOrderForBuyerReview(
      database,
      formalOrderId,
      command.actor.buyerCustomerId,
    );
    validateReviewSource(source, expectedVersion, input.reviewType);
    const reviewCaseId = source.review_case_id ?? crypto.randomUUID();
    const evidenceVersionNo = source.review_case_id === null
      ? 1
      : Number(source.current_evidence_version_no) + 1;
    const aggregateVersion = source.review_case_id === null
      ? 1
      : Number(source.review_case_version) + 1;
    const evidenceVersionId = crypto.randomUUID();

    const fileRows = await listReviewEvidenceFiles(
      database,
      evidenceFiles.map((file) => file.fileObjectId),
    );
    validateReviewEvidenceFiles(fileRows, evidenceFiles, command.actor.buyerCustomerId);
    await assertFilesUnused(database, evidenceFiles);

    const fileActor: FileActor = {
      type: 'BUYER_CUSTOMER',
      id: command.actor.buyerCustomerId,
      roles: [],
    };
    const preparedFiles: PreparedReviewFile[] = [];
    for (const evidenceFile of evidenceFiles) {
      const prepared = await createExplicitAudienceFileLinkStatements(
        database,
        fileAuthorization,
        {
          fileObjectId: evidenceFile.fileObjectId,
          expectedFileVersion: evidenceFile.expectedFileVersion,
          entityType: 'REVIEW',
          entityId: evidenceVersionId,
          grants: [
            { subjectType: 'BUYER', buyerCustomerId: source.buyer_customer_id },
            {
              subjectType: 'SELLER_ORGANIZATION',
              sellerOrganizationId: source.seller_organization_id,
            },
            {
              subjectType: 'STAFF_INTERNAL',
              permissionCode: 'REVIEW_VIEW',
              scope: { type: 'GLOBAL' },
            },
          ],
        },
        {
          actor: fileActor,
          idempotencyKey: acquired.claim.idempotencyKey,
          requestId: command.requestId ?? null,
          now,
        },
      );
      preparedFiles.push({
        fileObjectId: evidenceFile.fileObjectId,
        linkId: prepared.result.linkId,
        versionFileId: crypto.randomUUID(),
        statements: prepared.statements,
      });
    }

    const eventType = source.review_case_id === null
      ? 'REVIEW_EVIDENCE_SUBMITTED'
      : 'REVIEW_EVIDENCE_RESUBMITTED';
    const response: SubmitReviewEvidenceResult = {
      review_case_id: reviewCaseId,
      formal_order_id: source.formal_order_id,
      buyer_customer_id: source.buyer_customer_id,
      review_type: input.reviewType,
      review_url: reviewUrl,
      status: 'PENDING_REVIEW',
      version: aggregateVersion,
      current_evidence_version_no: evidenceVersionNo,
      current_evidence_version_id: evidenceVersionId,
      submitted_at: now,
      evidence_files: preparedFiles.map((file) => ({
        file_object_id: file.fileObjectId,
        file_entity_link_id: file.linkId,
      })),
      replayed: false,
    };

    const statements: SqlStatement[] = [];
    if (source.review_case_id === null) {
      statements.push(insertReviewCaseStatement(database, reviewCaseId, source, now));
    }
    statements.push(insertEvidenceStatement(database, {
      evidenceVersionId,
      reviewCaseId,
      formalOrderId: source.formal_order_id,
      versionNo: evidenceVersionNo,
      reviewType: input.reviewType,
      reviewUrl,
      buyerCustomerId: source.buyer_customer_id,
      buyerNote,
      now,
    }));
    if (source.review_case_id !== null) {
      statements.push(resubmitCaseStatement(
        database,
        reviewCaseId,
        expectedVersion,
        evidenceVersionNo,
        now,
      ));
    }
    for (const file of preparedFiles) {
      statements.push(
        ...file.statements,
        database.prepare(`
          INSERT INTO review_evidence_version_files (
            id, review_case_id, evidence_version_id, formal_order_id,
            file_object_id, file_entity_link_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(
          file.versionFileId,
          reviewCaseId,
          evidenceVersionId,
          source.formal_order_id,
          file.fileObjectId,
          file.linkId,
          now,
        ),
      );
    }
    statements.push(
      insertReviewEventStatement(database, {
        reviewCaseId,
        formalOrderId: source.formal_order_id,
        evidenceVersionId,
        eventType,
        actorType: 'BUYER_CUSTOMER',
        actorId: source.buyer_customer_id,
        previousStatus: source.review_status,
        nextStatus: 'PENDING_REVIEW',
        caseVersion: aggregateVersion,
        metadata: {
          evidence_version_no: evidenceVersionNo,
          review_url: reviewUrl,
          file_count: preparedFiles.length,
          authorization_mode: 'EXPLICIT_AUDIENCES',
        },
        idempotencyKey: acquired.claim.idempotencyKey,
        createdAt: now,
      }),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'REVIEW_CASE',
        aggregateId: reviewCaseId,
        eventType,
        actor: { type: 'BUYER_CUSTOMER', id: source.buyer_customer_id, roles: [] },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: source.review_case_id === null ? null : {
          status: source.review_status,
          version: source.review_case_version,
          evidence_version_no: source.current_evidence_version_no,
        },
        nextState: response,
        metadata: {
          seller_organization_id: source.seller_organization_id,
          evidence_version_id: evidenceVersionId,
          file_authorization_mode: 'EXPLICIT_AUDIENCES',
        },
        createdAt: now,
      }),
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: {
          review_case_id: reviewCaseId,
          evidence_version_id: evidenceVersionId,
          formal_order_id: source.formal_order_id,
        },
        now,
      }),
      assertSubmitted(database, {
        reviewCaseId,
        formalOrderId: source.formal_order_id,
        buyerCustomerId: source.buyer_customer_id,
        sellerOrganizationId: source.seller_organization_id,
        evidenceVersionId,
        evidenceVersionNo,
        aggregateVersion,
        reviewUrl,
        submittedAt: now,
        preparedFiles,
        claim: acquired.claim,
      }),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    );

    await batchWithAssignmentRetry(database, () => prepareDirectWorkItem(database, {
      workType: 'REVIEW_DECISION',
      sourceEntityType: 'REVIEW_CASE',
      sourceEntityId: reviewCaseId,
      marketplaceCode: 'AMAZON_JP',
      buyerCustomerId: source.buyer_customer_id,
      sellerOrganizationId: source.seller_organization_id,
      actorType: 'SYSTEM',
      actorId: source.buyer_customer_id,
      requestId: command.requestId ?? null,
      idempotencyKey: acquired.claim.idempotencyKey,
      reason: source.review_case_id === null
        ? 'review evidence submitted'
        : 'review evidence resubmitted',
      now,
    }), statements);
    return response;
  } catch (error) {
    const normalized = normalizeReviewError(error);
    await markIdempotencyFailed(
      database,
      acquired.claim,
      normalized.code,
      now,
    ).catch(() => false);
    throw normalized;
  }
}

function validateReviewSource(
  source: FormalOrderReviewSourceRow,
  expectedVersion: number,
  reviewType: PricingReviewType,
): void {
  if (source.order_status !== 'CONFIRMED' || source.review_type !== reviewType) {
    throw new ReviewError('FORMAL_ORDER_STATE_CONFLICT', 409);
  }
  if (source.review_case_id === null) {
    if (expectedVersion !== 0) throw new ReviewError('REVIEW_CASE_NOT_FOUND', 404);
    return;
  }
  if (expectedVersion === 0) throw new ReviewError('REVIEW_ALREADY_EXISTS', 409);
  if (source.review_case_version !== expectedVersion) {
    throw new ReviewError('VERSION_CONFLICT', 409);
  }
  if (source.review_status !== 'CHANGES_REQUESTED') {
    throw new ReviewError('REVIEW_STATE_CONFLICT', 409);
  }
}

function validateReviewEvidenceFiles(
  rows: readonly ReviewEvidenceFileRow[],
  expected: readonly { fileObjectId: string; expectedFileVersion: number }[],
  buyerCustomerId: string,
): void {
  if (rows.length !== expected.length) throw new ReviewError('FILE_OBJECT_NOT_FOUND', 404);
  const versions = new Map(expected.map((file) => [file.fileObjectId, file.expectedFileVersion]));
  for (const row of rows) {
    if (row.status !== 'VERIFIED' || row.intent_status !== 'VERIFIED') {
      throw new ReviewError('FILE_NOT_VERIFIED', 409);
    }
    if (row.purpose !== 'REVIEW_EVIDENCE'
      || row.intent_purpose !== 'REVIEW_EVIDENCE'
      || row.owner_actor_type !== 'BUYER_CUSTOMER'
      || row.owner_actor_id !== buyerCustomerId) {
      throw new ReviewError('REVIEW_FILE_CONFLICT', 409);
    }
    if (row.version !== versions.get(row.id)) throw new ReviewError('VERSION_CONFLICT', 409);
  }
}

async function assertFilesUnused(
  database: SqlDatabase,
  files: readonly { fileObjectId: string }[],
): Promise<void> {
  const row = await database.prepare(`
    SELECT 1 AS conflict FROM review_evidence_version_files
    WHERE file_object_id IN (${files.map(() => '?').join(', ')}) LIMIT 1
  `).bind(...files.map((file) => file.fileObjectId)).first<{ conflict: number }>();
  if (row) throw new ReviewError('REVIEW_FILE_CONFLICT', 409);
}

function insertReviewCaseStatement(
  database: SqlDatabase,
  reviewCaseId: string,
  source: FormalOrderReviewSourceRow,
  now: number,
): SqlStatement {
  return database.prepare(`
    INSERT INTO review_cases (
      id, formal_order_id, buyer_customer_id, seller_organization_id,
      review_type, status, current_evidence_version_no, version,
      public_change_reason, internal_review_note, submitted_at, updated_at,
      decided_by_staff_id, decided_at, withdrawn_at, created_at
    ) VALUES (
      ?, ?, ?, ?, ?, 'PENDING_REVIEW', 1, 1,
      NULL, NULL, ?, ?, NULL, NULL, NULL, ?
    )
  `).bind(
    reviewCaseId,
    source.formal_order_id,
    source.buyer_customer_id,
    source.seller_organization_id,
    source.review_type,
    now,
    now,
    now,
  );
}

function insertEvidenceStatement(
  database: SqlDatabase,
  input: {
    evidenceVersionId: string;
    reviewCaseId: string;
    formalOrderId: string;
    versionNo: number;
    reviewType: PricingReviewType;
    reviewUrl: string | null;
    buyerCustomerId: string;
    buyerNote: string | null;
    now: number;
  },
): SqlStatement {
  return database.prepare(`
    INSERT INTO review_evidence_versions (
      id, review_case_id, formal_order_id, version_no, review_type,
      submitted_by_buyer_id, buyer_note, created_at, review_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    input.evidenceVersionId,
    input.reviewCaseId,
    input.formalOrderId,
    input.versionNo,
    input.reviewType,
    input.buyerCustomerId,
    input.buyerNote,
    input.now,
    input.reviewUrl,
  );
}

function resubmitCaseStatement(
  database: SqlDatabase,
  reviewCaseId: string,
  expectedVersion: number,
  evidenceVersionNo: number,
  now: number,
): SqlStatement {
  return database.prepare(`
    UPDATE review_cases SET
      status='PENDING_REVIEW',
      current_evidence_version_no=?,
      version=version+1,
      public_change_reason=NULL,
      internal_review_note=NULL,
      updated_at=MAX(?, updated_at+1),
      decided_by_staff_id=NULL,
      decided_at=NULL,
      withdrawn_at=NULL
    WHERE id=? AND status='CHANGES_REQUESTED' AND version=?
      AND current_evidence_version_no=?
  `).bind(evidenceVersionNo, now, reviewCaseId, expectedVersion, evidenceVersionNo - 1);
}

function assertSubmitted(
  database: SqlDatabase,
  input: {
    reviewCaseId: string;
    formalOrderId: string;
    buyerCustomerId: string;
    sellerOrganizationId: string;
    evidenceVersionId: string;
    evidenceVersionNo: number;
    aggregateVersion: number;
    reviewUrl: string | null;
    submittedAt: number;
    preparedFiles: readonly PreparedReviewFile[];
    claim: {
      actorType: string;
      actorId: string;
      idempotencyKey: string;
      leaseToken: string;
    };
  },
): SqlStatement {
  const placeholders = input.preparedFiles.map(() => '?').join(', ');
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (
        SELECT 1 FROM review_cases review_case
        WHERE review_case.id=? AND review_case.formal_order_id=?
          AND review_case.buyer_customer_id=?
          AND review_case.seller_organization_id=?
          AND review_case.status='PENDING_REVIEW'
          AND review_case.version=?
          AND review_case.current_evidence_version_no=?
      )
      AND EXISTS (
        SELECT 1 FROM review_evidence_versions evidence
        WHERE evidence.id=? AND evidence.review_case_id=?
          AND evidence.formal_order_id=? AND evidence.version_no=?
          AND evidence.review_url IS ? AND evidence.created_at=?
      )
      AND (
        SELECT COUNT(*)
        FROM review_evidence_version_files version_file
        JOIN file_entity_links link ON link.id=version_file.file_entity_link_id
        WHERE version_file.evidence_version_id=?
          AND version_file.file_object_id IN (${placeholders})
          AND link.authorization_mode='EXPLICIT_AUDIENCES'
      )=?
      AND ? BETWEEN 1 AND 3
      AND (
        SELECT COUNT(*) FROM review_events
        WHERE review_case_id=? AND case_version=?
          AND event_type IN ('REVIEW_EVIDENCE_SUBMITTED','REVIEW_EVIDENCE_RESUBMITTED')
      )=1
      AND EXISTS (
        SELECT 1 FROM command_idempotency_records
        WHERE actor_type=? AND actor_id=? AND idempotency_key=?
          AND status='COMMITTED' AND lease_token=?
      )
    THEN 1 ELSE 0 END
  `).bind(
    input.reviewCaseId,
    input.formalOrderId,
    input.buyerCustomerId,
    input.sellerOrganizationId,
    input.aggregateVersion,
    input.evidenceVersionNo,
    input.evidenceVersionId,
    input.reviewCaseId,
    input.formalOrderId,
    input.evidenceVersionNo,
    input.reviewUrl,
    input.submittedAt,
    input.evidenceVersionId,
    ...input.preparedFiles.map((file) => file.fileObjectId),
    input.preparedFiles.length,
    input.preparedFiles.length,
    input.reviewCaseId,
    input.aggregateVersion,
    input.claim.actorType,
    input.claim.actorId,
    input.claim.idempotencyKey,
    input.claim.leaseToken,
  );
}