import type {
  SqlDatabase,
  SqlStatement,
  SubmitOrderEvidenceResult,
} from '@ygb/contracts';
import {
  canonicalJson,
  hashCanonicalJson,
} from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  markIdempotencyFailed,
} from '../foundation/idempotency';
import {
  createOutboxStatements,
  prepareOutboxEvent,
} from '../foundation/outbox';
import {
  batchWithAssignmentRetry,
  prepareDirectWorkItem,
} from '../staff-assignment';
import {
  findSubmissionForBuyerByReservation,
  listVerifiedEvidenceFiles,
  requireApprovedReservationForBuyer,
  type OrderEvidenceSubmissionRow,
  type VerifiedEvidenceFileRow,
} from './order-evidence-records';
import {
  cleanOptionalOrderEvidenceText,
  cleanOrderEvidenceIdentifier,
  insertOrderEvidenceEventStatement,
  normalizeAmazonOrderNumber,
  normalizeEvidenceFileIds,
  normalizeOrderEvidenceError,
  OrderEvidenceError,
  validateBuyerOrderEvidenceActor,
  validateCommandTime,
  validateExpectedVersion,
  validateFinalPaidJpy,
  type BuyerOrderEvidenceActor,
} from './order-evidence-shared';

interface PreparedEvidenceFile {
  object: VerifiedEvidenceFileRow;
  fileLinkId: string;
  versionFileId: string;
}

export async function submitOrderEvidence(
  database: SqlDatabase,
  input: {
    reservationId: string;
    expectedVersion: number;
    marketplace: 'JP';
    amazonOrderNumber: string;
    finalPaidJpy: number;
    evidenceFileObjectIds: readonly string[];
    buyerNote?: string | null;
  },
  command: {
    actor: BuyerOrderEvidenceActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<SubmitOrderEvidenceResult> {
  validateBuyerOrderEvidenceActor(command.actor);
  const reservationId = cleanOrderEvidenceIdentifier(
    input.reservationId,
    120,
  );
  const expectedVersion = validateExpectedVersion(
    input.expectedVersion,
    { allowZero: true },
  );
  if (input.marketplace !== 'JP'
    || input.marketplace !== command.actor.marketplaceCode) {
    throw new OrderEvidenceError('VALIDATION_ERROR', 400);
  }
  const orderNumber = normalizeAmazonOrderNumber(
    input.amazonOrderNumber,
  );
  const finalPaidJpy = validateFinalPaidJpy(input.finalPaidJpy);
  const evidenceFileObjectIds = normalizeEvidenceFileIds(
    input.evidenceFileObjectIds,
  );
  const buyerNote = cleanOptionalOrderEvidenceText(
    input.buyerNote,
    2000,
  );
  const now = validateCommandTime(command.now ?? Date.now());

  const requestHash = await hashCanonicalJson({
    action: 'SUBMIT_ORDER_EVIDENCE',
    reservation_id: reservationId,
    expected_version: expectedVersion,
    marketplace: input.marketplace,
    amazon_order_number_raw: orderNumber.raw,
    amazon_order_number_normalized: orderNumber.normalized,
    final_paid_jpy: finalPaidJpy,
    evidence_file_object_ids: evidenceFileObjectIds,
    buyer_note: buyerNote,
  });
  const acquired = await acquireIdempotency<SubmitOrderEvidenceResult>(
    database,
    {
      actorType: 'BUYER_CUSTOMER',
      actorId: command.actor.buyerCustomerId,
      action: 'SUBMIT_ORDER_EVIDENCE',
      targetType: 'ORDER_EVIDENCE_RESERVATION',
      targetId: reservationId,
      idempotencyKey: command.idempotencyKey,
      requestHash,
    },
    { now },
  );
  if (acquired.kind === 'REPLAY') {
    return {
      ...acquired.response,
      replayed: true,
    };
  }

  try {
    const reservation = await requireApprovedReservationForBuyer(
      database,
      reservationId,
      command.actor.buyerCustomerId,
    );
    if (reservation.marketplace_code !== input.marketplace) {
      throw new OrderEvidenceError(
        'ORDER_EVIDENCE_STATE_CONFLICT',
        409,
      );
    }

    const source = await findSubmissionForBuyerByReservation(
      database,
      reservationId,
      command.actor.buyerCustomerId,
    );
    validateSubmissionTransition(source, expectedVersion);

    const submissionId = source?.submission_id
      ?? crypto.randomUUID();
    const evidenceVersionNo = source === null
      ? 1
      : source.current_version_no + 1;
    const aggregateVersion = source === null
      ? 1
      : source.aggregate_version + 1;
    const evidenceVersionId = crypto.randomUUID();

    const fileRows = await listVerifiedEvidenceFiles(
      database,
      evidenceFileObjectIds,
    );
    validateEvidenceFiles(
      fileRows,
      evidenceFileObjectIds,
      command.actor.buyerCustomerId,
    );
    await assertFilesNotOwnedByAnotherSubmission(
      database,
      evidenceFileObjectIds,
      submissionId,
    );
    const preparedFiles = fileRows.map((object) => ({
      object,
      fileLinkId: crypto.randomUUID(),
      versionFileId: crypto.randomUUID(),
    }));

    const response: SubmitOrderEvidenceResult = {
      submission_id: submissionId,
      reservation_id: reservationId,
      buyer_customer_id: command.actor.buyerCustomerId,
      marketplace: input.marketplace,
      status: 'PENDING_VERIFICATION',
      version: aggregateVersion,
      current_evidence_version_no: evidenceVersionNo,
      current_evidence_version_id: evidenceVersionId,
      amazon_order_number_normalized: orderNumber.normalized,
      final_paid_jpy: finalPaidJpy,
      evidence_file_count: preparedFiles.length,
      replayed: false,
    };
    const eventType = source === null
      ? 'ORDER_EVIDENCE_SUBMITTED'
      : 'ORDER_EVIDENCE_RESUBMITTED';
    const outbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey:
        `order-evidence-submitted:${submissionId}:${evidenceVersionNo}`,
      eventType,
      aggregateType: 'ORDER_EVIDENCE',
      aggregateId: submissionId,
      payload: {
        submission_id: submissionId,
        reservation_id: reservationId,
        buyer_customer_id: command.actor.buyerCustomerId,
        evidence_version_id: evidenceVersionId,
        evidence_version_no: evidenceVersionNo,
        file_count: preparedFiles.length,
      },
      createdAt: now,
    });

    const statements: SqlStatement[] = [];
    if (source === null) {
      statements.push(insertSubmissionStatement(database, {
        submissionId,
        reservationId,
        buyerCustomerId: command.actor.buyerCustomerId,
        marketplace: input.marketplace,
        now,
      }));
    }
    statements.push(insertEvidenceVersionStatement(database, {
      evidenceVersionId,
      submissionId,
      reservationId,
      buyerCustomerId: command.actor.buyerCustomerId,
      marketplace: input.marketplace,
      evidenceVersionNo,
      orderNumberRaw: orderNumber.raw,
      orderNumberNormalized: orderNumber.normalized,
      finalPaidJpy,
      buyerNote,
      now,
    }));
    if (source !== null) {
      statements.push(resubmitSubmissionStatement(database, {
        source,
        evidenceVersionNo,
        now,
      }));
    }
    for (const prepared of preparedFiles) {
      statements.push(
        insertPhase3cFileLinkStatement(database, prepared, {
          evidenceVersionId,
          buyerCustomerId: command.actor.buyerCustomerId,
          now,
        }),
        insertVersionFileStatement(database, prepared, {
          submissionId,
          evidenceVersionId,
          reservationId,
          buyerCustomerId: command.actor.buyerCustomerId,
          now,
        }),
        insertPhase3cFileEventStatement(database, prepared, {
          evidenceVersionId,
          buyerCustomerId: command.actor.buyerCustomerId,
          idempotencyKey: acquired.claim.idempotencyKey,
          now,
        }),
      );
    }
    statements.push(
      insertOrderEvidenceEventStatement(database, {
        submissionId,
        reservationId,
        buyerCustomerId: command.actor.buyerCustomerId,
        evidenceVersionId,
        eventType,
        actorType: 'BUYER_CUSTOMER',
        actorId: command.actor.buyerCustomerId,
        previousStatus: source?.status ?? null,
        nextStatus: 'PENDING_VERIFICATION',
        aggregateVersion,
        metadata: {
          evidence_version_no: evidenceVersionNo,
          file_count: preparedFiles.length,
          duplicate_detection: 'DATABASE_SIGNAL_ONLY',
        },
        idempotencyKey: acquired.claim.idempotencyKey,
        createdAt: now,
      }),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'ORDER_EVIDENCE',
        aggregateId: submissionId,
        eventType,
        actor: {
          type: 'BUYER_CUSTOMER',
          id: command.actor.buyerCustomerId,
          roles: [],
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: source === null ? null : {
          status: source.status,
          version: source.aggregate_version,
          evidence_version_no: source.current_version_no,
        },
        nextState: response,
        createdAt: now,
      }),
      ...createOutboxStatements(database, outbox),
      completeIdempotencyStatement(
        database,
        acquired.claim,
        response,
        {
          resultReferences: {
            submission_id: submissionId,
            evidence_version_id: evidenceVersionId,
          },
          now,
        },
      ),
      assertOrderEvidenceSubmittedStatement(database, {
        claim: acquired.claim,
        response,
        fileObjectIds: evidenceFileObjectIds,
      }),
      assertIdempotencyCompletionStatement(
        database,
        acquired.claim,
      ),
    );

    await batchWithAssignmentRetry(
      database,
      () => prepareDirectWorkItem(database, {
        workType: 'ORDER_EVIDENCE_REVIEW',
        sourceEntityType: 'ORDER_EVIDENCE',
        sourceEntityId: submissionId,
        marketplaceCode: input.marketplace,
        buyerCustomerId: command.actor.buyerCustomerId,
        actorType: 'SYSTEM',
        actorId: `buyer:${command.actor.buyerCustomerId}`,
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        reason: source === null ? 'order evidence submitted' : 'order evidence resubmitted',
        now,
      }),
      statements,
    );
    return response;
  } catch (error) {
    const normalized = normalizeOrderEvidenceError(error);
    await markIdempotencyFailed(
      database,
      acquired.claim,
      normalized.code,
      now,
    ).catch(() => false);
    throw normalized;
  }
}

function validateSubmissionTransition(
  source: OrderEvidenceSubmissionRow | null,
  expectedVersion: number,
): void {
  if (source === null) {
    if (expectedVersion !== 0) {
      throw new OrderEvidenceError('ORDER_EVIDENCE_NOT_FOUND', 404);
    }
    return;
  }
  if (expectedVersion === 0) {
    throw new OrderEvidenceError(
      'ORDER_EVIDENCE_ALREADY_EXISTS',
      409,
    );
  }
  if (source.aggregate_version !== expectedVersion) {
    throw new OrderEvidenceError('VERSION_CONFLICT', 409);
  }
  if (source.status !== 'CHANGES_REQUESTED') {
    throw new OrderEvidenceError(
      'ORDER_EVIDENCE_STATE_CONFLICT',
      409,
    );
  }
}

function validateEvidenceFiles(
  rows: readonly VerifiedEvidenceFileRow[],
  expectedIds: readonly string[],
  buyerCustomerId: string,
): void {
  if (rows.length !== expectedIds.length) {
    throw new OrderEvidenceError('FILE_OBJECT_NOT_FOUND', 404);
  }
  for (const row of rows) {
    if (row.status !== 'VERIFIED'
      || row.intent_status !== 'VERIFIED') {
      throw new OrderEvidenceError('FILE_NOT_VERIFIED', 409);
    }
    if (row.purpose !== 'ORDER_EVIDENCE'
      || row.visibility === 'SELLER_VISIBLE'
      || row.owner_actor_type !== 'BUYER_CUSTOMER'
      || row.owner_actor_id !== buyerCustomerId) {
      throw new OrderEvidenceError(
        'ORDER_EVIDENCE_FILE_CONFLICT',
        409,
      );
    }
  }
}

async function assertFilesNotOwnedByAnotherSubmission(
  database: SqlDatabase,
  fileObjectIds: readonly string[],
  submissionId: string,
): Promise<void> {
  const placeholders = fileObjectIds.map(() => '?').join(', ');
  const row = await database.prepare(`
    SELECT 1 AS conflict
    FROM order_evidence_version_files
    WHERE file_object_id IN (${placeholders})
      AND submission_id<>?
    LIMIT 1
  `).bind(
    ...fileObjectIds,
    submissionId,
  ).first<{ conflict: number }>();
  if (row) {
    throw new OrderEvidenceError(
      'ORDER_EVIDENCE_FILE_CONFLICT',
      409,
    );
  }
}

function insertSubmissionStatement(
  database: SqlDatabase,
  input: {
    submissionId: string;
    reservationId: string;
    buyerCustomerId: string;
    marketplace: 'JP';
    now: number;
  },
): SqlStatement {
  return database.prepare(`
    INSERT INTO order_evidence_submissions (
      id,
      reservation_id,
      buyer_customer_id,
      marketplace_code,
      status,
      current_version_no,
      version,
      public_change_reason,
      internal_review_note,
      submitted_at,
      updated_at,
      verified_by_staff_id,
      verified_at,
      withdrawn_at,
      consumed_at,
      created_at
    ) VALUES (
      ?, ?, ?, ?, 'PENDING_VERIFICATION',
      1, 1, NULL, NULL, ?, ?, NULL, NULL, NULL, NULL, ?
    )
  `).bind(
    input.submissionId,
    input.reservationId,
    input.buyerCustomerId,
    input.marketplace,
    input.now,
    input.now,
    input.now,
  );
}

function insertEvidenceVersionStatement(
  database: SqlDatabase,
  input: {
    evidenceVersionId: string;
    submissionId: string;
    reservationId: string;
    buyerCustomerId: string;
    marketplace: 'JP';
    evidenceVersionNo: number;
    orderNumberRaw: string;
    orderNumberNormalized: string;
    finalPaidJpy: number;
    buyerNote: string | null;
    now: number;
  },
): SqlStatement {
  return database.prepare(`
    INSERT INTO order_evidence_versions (
      id,
      submission_id,
      reservation_id,
      buyer_customer_id,
      marketplace_code,
      version_no,
      amazon_order_number_raw,
      amazon_order_number_normalized,
      final_paid_jpy,
      submitted_by_buyer_id,
      buyer_note,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    input.evidenceVersionId,
    input.submissionId,
    input.reservationId,
    input.buyerCustomerId,
    input.marketplace,
    input.evidenceVersionNo,
    input.orderNumberRaw,
    input.orderNumberNormalized,
    input.finalPaidJpy,
    input.buyerCustomerId,
    input.buyerNote,
    input.now,
  );
}

function resubmitSubmissionStatement(
  database: SqlDatabase,
  input: {
    source: OrderEvidenceSubmissionRow;
    evidenceVersionNo: number;
    now: number;
  },
): SqlStatement {
  return database.prepare(`
    UPDATE order_evidence_submissions
    SET
      status='PENDING_VERIFICATION',
      current_version_no=?,
      version=version+1,
      public_change_reason=NULL,
      internal_review_note=NULL,
      updated_at=MAX(?, updated_at+1),
      verified_by_staff_id=NULL,
      verified_at=NULL,
      withdrawn_at=NULL,
      consumed_at=NULL
    WHERE id=?
      AND buyer_customer_id=?
      AND status='CHANGES_REQUESTED'
      AND version=?
      AND current_version_no=?
  `).bind(
    input.evidenceVersionNo,
    input.now,
    input.source.submission_id,
    input.source.buyer_customer_id,
    input.source.aggregate_version,
    input.source.current_version_no,
  );
}

function insertPhase3cFileLinkStatement(
  database: SqlDatabase,
  file: PreparedEvidenceFile,
  input: {
    evidenceVersionId: string;
    buyerCustomerId: string;
    now: number;
  },
): SqlStatement {
  return database.prepare(`
    INSERT INTO file_entity_links (
      id,
      file_object_id,
      entity_type,
      entity_id,
      purpose,
      visibility,
      linked_by_actor_type,
      linked_by_actor_id,
      created_at
    ) VALUES (?, ?, 'ORDER', ?, 'ORDER_EVIDENCE', ?,
      'BUYER_CUSTOMER', ?, ?)
  `).bind(
    file.fileLinkId,
    file.object.id,
    input.evidenceVersionId,
    file.object.visibility,
    input.buyerCustomerId,
    input.now,
  );
}

function insertVersionFileStatement(
  database: SqlDatabase,
  file: PreparedEvidenceFile,
  input: {
    submissionId: string;
    evidenceVersionId: string;
    reservationId: string;
    buyerCustomerId: string;
    now: number;
  },
): SqlStatement {
  return database.prepare(`
    INSERT INTO order_evidence_version_files (
      id,
      version_id,
      submission_id,
      reservation_id,
      buyer_customer_id,
      file_object_id,
      file_entity_link_id,
      visibility,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    file.versionFileId,
    input.evidenceVersionId,
    input.submissionId,
    input.reservationId,
    input.buyerCustomerId,
    file.object.id,
    file.fileLinkId,
    file.object.visibility,
    input.now,
  );
}

function insertPhase3cFileEventStatement(
  database: SqlDatabase,
  file: PreparedEvidenceFile,
  input: {
    evidenceVersionId: string;
    buyerCustomerId: string;
    idempotencyKey: string;
    now: number;
  },
): SqlStatement {
  return database.prepare(`
    INSERT INTO file_events (
      id,
      upload_intent_id,
      file_object_id,
      event_type,
      actor_type,
      actor_id,
      previous_status,
      next_status,
      metadata_json,
      idempotency_key,
      created_at
    ) VALUES (?, ?, ?, 'FILE_OBJECT_LINKED',
      'BUYER_CUSTOMER', ?, 'VERIFIED', 'VERIFIED', ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    file.object.upload_intent_id,
    file.object.id,
    input.buyerCustomerId,
    canonicalJson({
      entity_type: 'ORDER',
      entity_id: input.evidenceVersionId,
      phase3d_business_entity: 'ORDER_EVIDENCE_VERSION',
      file_entity_link_id: file.fileLinkId,
    }),
    input.idempotencyKey,
    input.now,
  );
}

function assertOrderEvidenceSubmittedStatement(
  database: SqlDatabase,
  input: {
    claim: {
      actorType: string;
      actorId: string;
      idempotencyKey: string;
      leaseToken: string;
    };
    response: SubmitOrderEvidenceResult;
    fileObjectIds: readonly string[];
  },
): SqlStatement {
  const placeholders = input.fileObjectIds.map(() => '?').join(', ');
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (
        SELECT 1
        FROM order_evidence_submissions submission
        WHERE submission.id=?
          AND submission.reservation_id=?
          AND submission.buyer_customer_id=?
          AND submission.status='PENDING_VERIFICATION'
          AND submission.version=?
          AND submission.current_version_no=?
      )
      AND EXISTS (
        SELECT 1
        FROM order_evidence_versions evidence
        WHERE evidence.id=?
          AND evidence.submission_id=?
          AND evidence.version_no=?
          AND evidence.final_paid_jpy=?
      )
      AND (
        SELECT COUNT(*)
        FROM order_evidence_version_files version_file
        JOIN file_entity_links link
          ON link.id=version_file.file_entity_link_id
        WHERE version_file.version_id=?
          AND version_file.file_object_id IN (${placeholders})
          AND link.entity_type='ORDER'
          AND link.entity_id=?
          AND link.purpose='ORDER_EVIDENCE'
          AND link.visibility<>'SELLER_VISIBLE'
      )=?
      AND EXISTS (
        SELECT 1
        FROM command_idempotency_records
        WHERE actor_type=?
          AND actor_id=?
          AND idempotency_key=?
          AND status='COMMITTED'
          AND lease_token=?
      )
    THEN 1 ELSE 0 END
  `).bind(
    input.response.submission_id,
    input.response.reservation_id,
    input.response.buyer_customer_id,
    input.response.version,
    input.response.current_evidence_version_no,
    input.response.current_evidence_version_id,
    input.response.submission_id,
    input.response.current_evidence_version_no,
    input.response.final_paid_jpy,
    input.response.current_evidence_version_id,
    ...input.fileObjectIds,
    input.response.current_evidence_version_id,
    input.fileObjectIds.length,
    input.claim.actorType,
    input.claim.actorId,
    input.claim.idempotencyKey,
    input.claim.leaseToken,
  );
}
