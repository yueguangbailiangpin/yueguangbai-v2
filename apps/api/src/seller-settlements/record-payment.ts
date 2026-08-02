import type {
  FileActor,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import { canonicalJson, hashCanonicalJson } from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  markIdempotencyFailed,
} from '../foundation/idempotency';
import { createOutboxStatements, prepareOutboxEvent } from '../foundation/outbox';
import { createExplicitAudienceFileLinkStatements } from '../files/explicit-audience-links';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import {
  assertSettlementProofUnused,
  requireSettlementProofFile,
} from './records';
import {
  authorizeSellerSettlement,
  cleanPositiveCnyFen,
  cleanSettlementIdentifier,
  cleanSettlementTimestamp,
  normalizeSettlementError,
  sellerSettlementFileAuthorization,
  SellerSettlementError,
} from './shared';

export interface SellerSettlementCommandResult {
  paymentId: string;
  replayed: boolean;
}

export async function recordSellerPayment(
  database: SqlDatabase,
  input: {
    sellerOrganizationId: string;
    amountCnyFen: string;
    paidAt: number;
    proofFile: {
      fileObjectId: string;
      expectedFileVersion: number;
    };
  },
  command: {
    actor: AssignmentStaffAuthorization;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<SellerSettlementCommandResult> {
  const sellerOrganizationId = cleanSettlementIdentifier(input.sellerOrganizationId);
  const amountCnyFen = cleanPositiveCnyFen(input.amountCnyFen);
  const paidAt = cleanSettlementTimestamp(input.paidAt);
  const fileObjectId = cleanSettlementIdentifier(input.proofFile.fileObjectId);
  const expectedFileVersion = cleanSettlementTimestamp(
    input.proofFile.expectedFileVersion,
  );
  if (expectedFileVersion < 1) {
    throw new SellerSettlementError('VALIDATION_ERROR', 400);
  }
  const now = cleanSettlementTimestamp(command.now ?? Date.now());
  if (paidAt > now) throw new SellerSettlementError('VALIDATION_ERROR', 400);
  await authorizeSellerSettlement(
    database,
    command.actor,
    sellerOrganizationId,
  );
  const requestHash = await hashCanonicalJson({
    action: 'RECORD_SELLER_PAYMENT',
    seller_organization_id: sellerOrganizationId,
    amount_cny_fen: String(amountCnyFen),
    paid_at: paidAt,
    proof_file: {
      file_object_id: fileObjectId,
      expected_file_version: expectedFileVersion,
    },
  });
  const acquired = await acquireIdempotency<SellerSettlementCommandResult>(
    database,
    {
      actorType: 'STAFF',
      actorId: command.actor.staffId,
      action: 'RECORD_SELLER_PAYMENT',
      targetType: 'SELLER_ORGANIZATION',
      targetId: sellerOrganizationId,
      idempotencyKey: command.idempotencyKey,
      requestHash,
    },
    { now },
  );
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }

  try {
    const file = await requireSettlementProofFile(database, fileObjectId);
    validateSellerSettlementProofFile(
      file,
      expectedFileVersion,
      command.actor.staffId,
    );
    await assertSettlementProofUnused(database, fileObjectId);
    const paymentId = crypto.randomUUID();
    const proofId = crypto.randomUUID();
    const eventId = crypto.randomUUID();
    const actor: FileActor = {
      type: 'STAFF',
      id: command.actor.staffId,
      roles: Object.freeze([...command.actor.roles]),
    };
    const link = await createExplicitAudienceFileLinkStatements(
      database,
      sellerSettlementFileAuthorization,
      {
        fileObjectId,
        expectedFileVersion,
        entityType: 'SELLER_SETTLEMENT',
        entityId: paymentId,
        grants: [{
          subjectType: 'STAFF_INTERNAL',
          permissionCode: 'SELLER_SETTLEMENT_VIEW',
          scope: { type: 'GLOBAL' },
        }],
      },
      {
        actor,
        idempotencyKey: acquired.claim.idempotencyKey,
        requestId: command.requestId ?? null,
        now,
      },
    );
    const response: SellerSettlementCommandResult = {
      paymentId,
      replayed: false,
    };
    const outbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey: `seller-payment-recorded:${paymentId}`,
      eventType: 'SELLER_PAYMENT_RECORDED',
      aggregateType: 'SELLER_PAYMENT',
      aggregateId: paymentId,
      payload: {
        seller_organization_id: sellerOrganizationId,
        payment_id: paymentId,
        amount_cny_fen: String(amountCnyFen),
        paid_at: paidAt,
        recorded_at: now,
      },
      createdAt: now,
    });
    const statements: SqlStatement[] = [
      database.prepare(`
        INSERT INTO seller_payments (
          id, seller_organization_id, amount_cny_fen, paid_at,
          recorded_at, recorded_by_staff_id, version,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).bind(
        paymentId,
        sellerOrganizationId,
        amountCnyFen,
        paidAt,
        now,
        command.actor.staffId,
        now,
        now,
      ),
      ...link.statements,
      database.prepare(`
        INSERT INTO seller_payment_proofs (
          id, payment_id, seller_organization_id,
          file_object_id, file_entity_link_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        proofId,
        paymentId,
        sellerOrganizationId,
        fileObjectId,
        link.result.linkId,
        now,
      ),
      database.prepare(`
        INSERT INTO seller_payment_events (
          id, payment_id, event_type, actor_staff_id,
          payment_version, amount_cny_fen, previous_paid_at,
          next_paid_at, reason, metadata_json,
          idempotency_key, created_at
        ) VALUES (
          ?, ?, 'PAYMENT_RECORDED', ?, 1, ?, NULL, ?, NULL, ?, ?, ?
        )
      `).bind(
        eventId,
        paymentId,
        command.actor.staffId,
        amountCnyFen,
        paidAt,
        canonicalJson({ proof_file_count: 1 }),
        acquired.claim.idempotencyKey,
        now,
      ),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'SELLER_PAYMENT',
        aggregateId: paymentId,
        eventType: 'SELLER_PAYMENT_RECORDED',
        actor: {
          type: 'STAFF',
          id: command.actor.staffId,
          roles: [...command.actor.roles],
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: null,
        nextState: {
          seller_organization_id: sellerOrganizationId,
          payment_id: paymentId,
          amount_cny_fen: String(amountCnyFen),
          paid_at: paidAt,
          recorded_at: now,
          version: 1,
        },
        metadata: {
          proof_file_count: 1,
          proof_file_object_id: fileObjectId,
          proof_file_entity_link_id: link.result.linkId,
          proof_owner_actor_type: file.owner_actor_type,
        },
        createdAt: now,
      }),
      ...createOutboxStatements(database, outbox),
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: { payment_id: paymentId },
        now,
      }),
      database.prepare(`
        INSERT INTO transaction_assertions (assertion_value)
        SELECT CASE WHEN
          EXISTS (
            SELECT 1 FROM seller_payments payment
            WHERE payment.id=?
              AND payment.seller_organization_id=?
              AND payment.amount_cny_fen=?
              AND payment.paid_at=?
              AND payment.recorded_at=?
              AND payment.recorded_by_staff_id=?
              AND payment.version=1
          )
          AND (
            SELECT COUNT(*) FROM seller_payment_proofs proof
            WHERE proof.payment_id=?
              AND proof.file_object_id=?
              AND proof.file_entity_link_id=?
          )=1
          AND EXISTS (
            SELECT 1 FROM seller_payment_events event
            WHERE event.id=? AND event.payment_id=?
              AND event.event_type='PAYMENT_RECORDED'
              AND event.payment_version=1
          )
        THEN 1 ELSE 0 END
      `).bind(
        paymentId,
        sellerOrganizationId,
        amountCnyFen,
        paidAt,
        now,
        command.actor.staffId,
        paymentId,
        fileObjectId,
        link.result.linkId,
        eventId,
        paymentId,
      ),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ];
    await database.batch(statements);
    return response;
  } catch (error) {
    const normalized = normalizeSettlementError(error);
    await markIdempotencyFailed(
      database,
      acquired.claim,
      normalized.code,
      now,
    ).catch(() => false);
    throw normalized;
  }
}

export function validateSellerSettlementProofFile(
  file: Awaited<ReturnType<typeof requireSettlementProofFile>>,
  expectedVersion: number,
  staffId: string,
): void {
  if (file.version !== expectedVersion) {
    throw new SellerSettlementError('VERSION_CONFLICT', 409);
  }
  if (file.status !== 'VERIFIED' || file.intent_status !== 'VERIFIED') {
    throw new SellerSettlementError('FILE_NOT_VERIFIED', 409);
  }
  const mime = file.detected_mime ?? file.declared_mime;
  const ownerAllowed = file.owner_actor_type === 'SYSTEM'
    || (file.owner_actor_type === 'STAFF'
      && file.owner_actor_id === staffId);
  if (file.purpose !== 'SELLER_SETTLEMENT_PROOF'
    || file.intent_purpose !== 'SELLER_SETTLEMENT_PROOF'
    || file.visibility !== 'INTERNAL_ONLY'
    || file.intent_visibility !== 'INTERNAL_ONLY'
    || !ownerAllowed
    || !['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
    throw new SellerSettlementError('SELLER_SETTLEMENT_CONFLICT', 409);
  }
}