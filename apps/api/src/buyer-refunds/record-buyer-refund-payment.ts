import type {
  BuyerRefundPaymentChannel,
  BuyerRefundProofFileInput,
  FileActor,
  RecordBuyerRefundPaymentResult,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import { hashCanonicalJson } from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  markIdempotencyFailed,
  type IdempotencyClaim,
} from '../foundation/idempotency';
import {
  prepareWorkItemCompletionStatements,
  requireAssignedWorkflowActor,
} from '../staff-assignment';
import type { FileAuthorizationService } from '../files/authorization';
import { createExplicitAudienceFileLinkStatements } from '../files/explicit-audience-links';
import { insertBuyerRefundEventStatement } from './buyer-refund-events';
import {
  assertBuyerRefundProofFilesUnused,
  listBuyerRefundProofFiles,
  requireBuyerRefundLedger,
  type BuyerRefundProofFileRow,
} from './buyer-refund-records';
import {
  BuyerRefundError,
  assertPreviousBuyerRefundStatementChangedOnce,
  buyerRefundStatusFromAmounts,
  cleanBuyerRefundAmount,
  cleanBuyerRefundBusinessDate,
  cleanBuyerRefundExpectedVersion,
  cleanBuyerRefundIdentifier,
  cleanBuyerRefundPaymentChannel,
  cleanBuyerRefundTimestamp,
  cleanOptionalBuyerRefundText,
  fixedIntegerString,
  normalizeBuyerRefundError,
  normalizeBuyerRefundProofFiles,
  requireBuyerRefundRecordPermission,
  type BuyerRefundStaffActor,
} from './buyer-refund-shared';

interface PreparedRefundProof {
  fileObjectId: string;
  fileEntityLinkId: string;
  paymentFileId: string;
  statements: readonly SqlStatement[];
}

export async function recordBuyerRefundPayment(
  database: SqlDatabase,
  fileAuthorization: FileAuthorizationService,
  input: {
    obligationId: string;
    expectedVersion: number;
    amountCnyFen: number;
    paidAt: number;
    chinaBusinessDate: string;
    paymentChannel: BuyerRefundPaymentChannel;
    proofFiles: readonly BuyerRefundProofFileInput[];
    publicNote?: string | null;
    internalNote?: string | null;
  },
  command: {
    actor: BuyerRefundStaffActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<RecordBuyerRefundPaymentResult> {
  requireBuyerRefundRecordPermission(command.actor);
  const obligationId = cleanBuyerRefundIdentifier(input.obligationId);
  const expectedVersion = cleanBuyerRefundExpectedVersion(
    input.expectedVersion,
  );
  const amountCnyFen = cleanBuyerRefundAmount(input.amountCnyFen);
  const now = cleanBuyerRefundTimestamp(command.now ?? Date.now());
  const paidAt = cleanBuyerRefundTimestamp(input.paidAt);
  if (paidAt > now) throw new BuyerRefundError('VALIDATION_ERROR', 400);
  const chinaBusinessDate = cleanBuyerRefundBusinessDate(
    input.chinaBusinessDate,
  );
  const paymentChannel = cleanBuyerRefundPaymentChannel(
    input.paymentChannel,
  );
  const proofFiles = normalizeBuyerRefundProofFiles(input.proofFiles);
  const publicNote = cleanOptionalBuyerRefundText(input.publicNote, 2000);
  const internalNote = cleanOptionalBuyerRefundText(input.internalNote, 4000);
  const requestHash = await hashCanonicalJson({
    action: 'RECORD_BUYER_REFUND_PAYMENT',
    obligation_id: obligationId,
    expected_version: expectedVersion,
    amount_cny_fen: amountCnyFen,
    paid_at: paidAt,
    china_business_date: chinaBusinessDate,
    payment_channel: paymentChannel,
    proof_files: proofFiles.map((file) => ({
      file_object_id: file.fileObjectId,
      expected_file_version: file.expectedFileVersion,
    })),
    public_note: publicNote,
    internal_note: internalNote,
  });
  const acquired = await acquireIdempotency<
    RecordBuyerRefundPaymentResult
  >(
    database,
    {
      actorType: 'STAFF',
      actorId: command.actor.staffId,
      action: 'RECORD_BUYER_REFUND_PAYMENT',
      targetType: 'BUYER_REFUND_OBLIGATION',
      targetId: obligationId,
      idempotencyKey: command.idempotencyKey,
      requestHash,
    },
    { now },
  );
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }

  try {
    await requireAssignedWorkflowActor(database, {
      staffId: command.actor.staffId,
      workType: 'BUYER_REFUND_PROCESSING',
      sourceEntityType: 'BUYER_REFUND_OBLIGATION',
      sourceEntityId: obligationId,
      allowCompleted: true,
    });
    const ledger = await requireBuyerRefundLedger(database, obligationId);
    if (ledger.version !== expectedVersion) {
      throw new BuyerRefundError('VERSION_CONFLICT', 409);
    }
    if (ledger.net_paid_cny_fen + amountCnyFen > Number.MAX_SAFE_INTEGER) {
      throw new BuyerRefundError('VALIDATION_ERROR', 400);
    }

    const fileRows = await listBuyerRefundProofFiles(
      database,
      proofFiles.map((file) => file.fileObjectId),
    );
    validateRefundProofFiles(
      fileRows,
      proofFiles,
      command.actor.staffId,
    );
    await assertBuyerRefundProofFilesUnused(
      database,
      proofFiles.map((file) => file.fileObjectId),
    );

    const paymentEntryId = crypto.randomUUID();
    const fileActor: FileActor = {
      type: 'STAFF',
      id: command.actor.staffId,
      roles: command.actor.roles,
    };
    const preparedProofs: PreparedRefundProof[] = [];
    for (const proof of proofFiles) {
      const prepared = await createExplicitAudienceFileLinkStatements(
        database,
        fileAuthorization,
        {
          fileObjectId: proof.fileObjectId,
          expectedFileVersion: proof.expectedFileVersion,
          entityType: 'BUYER_REFUND',
          entityId: paymentEntryId,
          grants: [{
            subjectType: 'STAFF_INTERNAL',
            permissionCode: 'BUYER_REFUND_VIEW',
            scope: { type: 'GLOBAL' },
          }],
        },
        {
          actor: fileActor,
          idempotencyKey: acquired.claim.idempotencyKey,
          requestId: command.requestId ?? null,
          now,
        },
      );
      preparedProofs.push({
        fileObjectId: proof.fileObjectId,
        fileEntityLinkId: prepared.result.linkId,
        paymentFileId: crypto.randomUUID(),
        statements: prepared.statements,
      });
    }

    const nextVersion = ledger.version + 1;
    const nextGrossPaid = ledger.gross_paid_cny_fen + amountCnyFen;
    const nextNetPaid = ledger.net_paid_cny_fen + amountCnyFen;
    const nextStatus = buyerRefundStatusFromAmounts(
      ledger.due_amount_cny_fen,
      nextNetPaid,
    );
    const eventId = crypto.randomUUID();
    const auditId = crypto.randomUUID();
    const response: RecordBuyerRefundPaymentResult = {
      obligation: {
        obligation_id: ledger.obligation_id,
        source_review_event_id: ledger.source_review_event_id,
        review_case_id: ledger.review_case_id,
        formal_order_id: ledger.formal_order_id,
        buyer_customer_id: ledger.buyer_customer_id,
        due_amount_cny_fen: fixedIntegerString(ledger.due_amount_cny_fen),
        gross_paid_cny_fen: fixedIntegerString(nextGrossPaid),
        reversed_cny_fen: fixedIntegerString(ledger.reversed_cny_fen),
        net_paid_cny_fen: fixedIntegerString(nextNetPaid),
        status: nextStatus,
        version: nextVersion,
      },
      payment: {
        payment_entry_id: paymentEntryId,
        obligation_id: ledger.obligation_id,
        entry_type: 'PAYMENT',
        amount_cny_fen: fixedIntegerString(amountCnyFen),
        paid_at: paidAt,
        china_business_date: chinaBusinessDate,
        payment_channel: paymentChannel,
        public_note: publicNote,
        proof_files: preparedProofs.map((proof) => ({
          file_object_id: proof.fileObjectId,
          file_entity_link_id: proof.fileEntityLinkId,
        })),
      },
      replayed: false,
    };

    const statements: SqlStatement[] = [
      database.prepare(`
        UPDATE buyer_refund_obligations
        SET
          version=version+1,
          updated_at=MAX(?, updated_at+1)
        WHERE id=?
          AND version=?
      `).bind(now, obligationId, expectedVersion),
      assertPreviousBuyerRefundStatementChangedOnce(database),
      database.prepare(`
        INSERT INTO buyer_refund_payment_entries (
          id,
          obligation_id,
          entry_type,
          original_payment_entry_id,
          amount_cny_fen,
          paid_at,
          reversed_at,
          china_business_date,
          payment_channel,
          recorded_by_staff_id,
          public_note,
          internal_note,
          idempotency_key,
          request_hash,
          created_at
        ) VALUES (
          ?, ?, 'PAYMENT', NULL, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?
        )
      `).bind(
        paymentEntryId,
        obligationId,
        amountCnyFen,
        paidAt,
        chinaBusinessDate,
        paymentChannel,
        command.actor.staffId,
        publicNote,
        internalNote,
        acquired.claim.idempotencyKey,
        acquired.claim.requestHash,
        now,
      ),
    ];
    for (const proof of preparedProofs) {
      statements.push(
        ...proof.statements,
        database.prepare(`
          INSERT INTO buyer_refund_payment_entry_files (
            id,
            obligation_id,
            payment_entry_id,
            file_object_id,
            file_entity_link_id,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).bind(
          proof.paymentFileId,
          obligationId,
          paymentEntryId,
          proof.fileObjectId,
          proof.fileEntityLinkId,
          now,
        ),
      );
    }
    statements.push(
      insertBuyerRefundEventStatement(database, {
        eventId,
        obligationId,
        paymentEntryId,
        eventType: 'BUYER_REFUND_PAYMENT_RECORDED',
        actorType: 'STAFF',
        actorId: command.actor.staffId,
        obligationVersion: nextVersion,
        amountCnyFen,
        netPaidAfterCnyFen: nextNetPaid,
        metadata: {
          payment_channel: paymentChannel,
          china_business_date: chinaBusinessDate,
          proof_file_count: preparedProofs.length,
          public_note: publicNote,
          internal_note: internalNote,
        },
        idempotencyKey: acquired.claim.idempotencyKey,
        createdAt: now,
      }),
      createAuditEventStatement(database, {
        id: auditId,
        aggregateType: 'BUYER_REFUND_OBLIGATION',
        aggregateId: obligationId,
        eventType: 'BUYER_REFUND_PAYMENT_RECORDED',
        actor: {
          type: 'STAFF',
          id: command.actor.staffId,
          roles: command.actor.roles,
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: {
          net_paid_cny_fen: fixedIntegerString(ledger.net_paid_cny_fen),
          status: ledger.status,
          version: ledger.version,
        },
        nextState: response,
        reason: publicNote,
        metadata: {
          internal_note: internalNote,
          proof_file_count: preparedProofs.length,
        },
        createdAt: now,
      }),
      completeIdempotencyStatement(
        database,
        acquired.claim,
        response,
        {
          resultReferences: {
            obligation_id: obligationId,
            payment_entry_id: paymentEntryId,
            proof_file_ids: preparedProofs.map(
              (proof) => proof.fileObjectId,
            ),
          },
          now,
        },
      ),
      assertPaymentRecordedStatement(database, {
        obligationId,
        expectedNextVersion: nextVersion,
        paymentEntryId,
        amountCnyFen,
        nextNetPaid,
        nextStatus,
        expectedFileCount: preparedProofs.length,
        eventId,
        auditId,
        claim: acquired.claim,
      }),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    );

    const completion = nextStatus === 'PAID'
      ? await prepareWorkItemCompletionStatements(database, {
          workType: 'BUYER_REFUND_PROCESSING',
          sourceEntityType: 'BUYER_REFUND_OBLIGATION',
          sourceEntityId: obligationId,
          outcome: 'COMPLETED',
          actorType: 'STAFF',
          actorId: command.actor.staffId,
          requestId: command.requestId ?? null,
          idempotencyKey: acquired.claim.idempotencyKey,
          now,
        })
      : [];
    await database.batch([...statements, ...completion]);
    return response;
  } catch (error) {
    const normalized = normalizeBuyerRefundError(error);
    await markIdempotencyFailed(
      database,
      acquired.claim,
      normalized.code,
      now,
    ).catch(() => false);
    throw normalized;
  }
}

function validateRefundProofFiles(
  rows: readonly BuyerRefundProofFileRow[],
  expected: readonly BuyerRefundProofFileInput[],
  staffId: string,
): void {
  if (rows.length !== expected.length) {
    throw new BuyerRefundError('FILE_OBJECT_NOT_FOUND', 404);
  }
  const versions = new Map(
    expected.map((file) => [file.fileObjectId, file.expectedFileVersion]),
  );
  for (const row of rows) {
    if (row.status !== 'VERIFIED' || row.intent_status !== 'VERIFIED') {
      throw new BuyerRefundError('FILE_NOT_VERIFIED', 409);
    }
    if (row.purpose !== 'BUYER_REFUND_PROOF'
      || row.intent_purpose !== 'BUYER_REFUND_PROOF'
      || row.visibility !== 'INTERNAL_ONLY'
      || row.intent_visibility !== 'INTERNAL_ONLY'
      || row.owner_actor_type !== 'STAFF'
      || row.owner_actor_id !== staffId) {
      throw new BuyerRefundError('BUYER_REFUND_FILE_CONFLICT', 409);
    }
    if (row.version !== versions.get(row.id)) {
      throw new BuyerRefundError('VERSION_CONFLICT', 409);
    }
  }
}

function assertPaymentRecordedStatement(
  database: SqlDatabase,
  input: {
    obligationId: string;
    expectedNextVersion: number;
    paymentEntryId: string;
    amountCnyFen: number;
    nextNetPaid: number;
    nextStatus: string;
    expectedFileCount: number;
    eventId: string;
    auditId: string;
    claim: IdempotencyClaim;
  },
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (
        SELECT 1
        FROM buyer_refund_ledger_balances
        WHERE obligation_id=?
          AND version=?
          AND net_paid_cny_fen=?
          AND status=?
      )
      AND EXISTS (
        SELECT 1
        FROM buyer_refund_payment_entries
        WHERE id=?
          AND obligation_id=?
          AND entry_type='PAYMENT'
          AND amount_cny_fen=?
      )
      AND (
        SELECT COUNT(*)
        FROM buyer_refund_payment_entry_files
        WHERE payment_entry_id=?
      )=?
      AND EXISTS (
        SELECT 1
        FROM buyer_refund_events
        WHERE id=?
          AND payment_entry_id=?
          AND event_type='BUYER_REFUND_PAYMENT_RECORDED'
          AND net_paid_after_cny_fen=?
      )
      AND EXISTS (
        SELECT 1
        FROM audit_events
        WHERE id=?
          AND aggregate_id=?
      )
      AND EXISTS (
        SELECT 1
        FROM command_idempotency_records
        WHERE actor_type=?
          AND actor_id=?
          AND idempotency_key=?
          AND action=?
          AND target_type=?
          AND target_id=?
          AND request_hash=?
          AND lease_token=?
          AND status='COMMITTED'
      )
    THEN 1 ELSE 0 END
  `).bind(
    input.obligationId,
    input.expectedNextVersion,
    input.nextNetPaid,
    input.nextStatus,
    input.paymentEntryId,
    input.obligationId,
    input.amountCnyFen,
    input.paymentEntryId,
    input.expectedFileCount,
    input.eventId,
    input.paymentEntryId,
    input.nextNetPaid,
    input.auditId,
    input.obligationId,
    input.claim.actorType,
    input.claim.actorId,
    input.claim.idempotencyKey,
    input.claim.action,
    input.claim.targetType,
    input.claim.targetId,
    input.claim.requestHash,
    input.claim.leaseToken,
  );
}
