import type { SqlDatabase, SqlStatement } from '@ygb/contracts';
import {
  calculateBuyerSelfPayFacts,
  canonicalJson,
  parseJpyInteger,
  toD1SafeInteger,
} from '@ygb/domain';
import { expireInstructionIfDue } from './expiry';
import { OrderInstructionError } from './shared';

export interface EvidenceInstructionFacts {
  instructionId: string;
  instructionVersionId: string;
  instructionAggregateVersion: number;
  deadlineSnapshot: number;
  referenceOrderAmountJpy: number;
  buyerSelfPayBps: number;
  buyerSelfPayJpy: number;
  buyerRefundablePrincipalJpy: number;
  priceDifferenceJpy: number;
  priceMismatch: boolean;
  submittedBeforeDeadline: 1;
}

interface EvidenceContextRow {
  instruction_id: string;
  instruction_version: number;
  instruction_status: string;
  current_version_no: number;
  initial_deadline_at: number | null;
  resubmission_deadline_at: number | null;
  instruction_version_id: string;
  reference_order_amount_jpy: number;
  buyer_self_pay_bps: number;
  evidence_status: string | null;
  formal_order_id: string | null;
}

export async function requireCurrentInstructionForEvidence(
  database: SqlDatabase,
  input: {
    reservationId: string;
    buyerCustomerId: string;
    finalPaidJpy: number;
    now: number;
    resubmission: boolean;
  },
): Promise<EvidenceInstructionFacts> {
  let row = await read(database, input.reservationId, input.buyerCustomerId);
  if (!row) throw new OrderInstructionError('NOT_FOUND', 404);
  if (row.instruction_status === 'ACTIVE') {
    await expireInstructionIfDue(database, row.instruction_id, {
      actorType: 'SYSTEM',
      actorId: `buyer:${input.buyerCustomerId}`,
      now: input.now,
    });
    row = await read(database, input.reservationId, input.buyerCustomerId);
  }
  if (!row || row.instruction_status !== 'ACTIVE'
    || row.formal_order_id !== null) {
    throw new OrderInstructionError('INSTRUCTION_NOT_READABLE', 409);
  }
  const deadline = input.resubmission
    ? row.resubmission_deadline_at
    : row.initial_deadline_at;
  if (deadline === null || input.now >= deadline) {
    throw new OrderInstructionError('INSTRUCTION_EXPIRED', 409);
  }
  if (input.resubmission && row.evidence_status !== 'CHANGES_REQUESTED') {
    throw new OrderInstructionError('STATE_CONFLICT', 409);
  }
  if (!input.resubmission && row.evidence_status !== null) {
    throw new OrderInstructionError('STATE_CONFLICT', 409);
  }
  const facts = calculateBuyerSelfPayFacts(
    parseJpyInteger(String(input.finalPaidJpy)),
    Number(row.buyer_self_pay_bps),
  );
  const priceDifferenceJpy = input.finalPaidJpy
    - Number(row.reference_order_amount_jpy);
  return {
    instructionId: row.instruction_id,
    instructionVersionId: row.instruction_version_id,
    instructionAggregateVersion: Number(row.instruction_version),
    deadlineSnapshot: deadline,
    referenceOrderAmountJpy: Number(row.reference_order_amount_jpy),
    buyerSelfPayBps: Number(row.buyer_self_pay_bps),
    buyerSelfPayJpy: toD1SafeInteger(facts.buyerSelfPayJpy),
    buyerRefundablePrincipalJpy:
      toD1SafeInteger(facts.refundablePrincipalJpy),
    priceDifferenceJpy,
    priceMismatch: priceDifferenceJpy !== 0,
    submittedBeforeDeadline: 1,
  };
}

export function clearResubmissionDeadlineStatements(
  database: SqlDatabase,
  input: {
    instructionId: string;
    instructionAggregateVersion: number;
    submissionId: string;
    reservationId: string;
    buyerCustomerId: string;
    deadlineSnapshot: number;
    idempotencyKey: string;
    now: number;
  },
): readonly SqlStatement[] {
  return [
    database.prepare(`
      UPDATE order_instructions
      SET resubmission_deadline_at=NULL, version=version+1,
          updated_at=MAX(?, updated_at+1)
      WHERE id=? AND status='ACTIVE' AND version=?
    `).bind(input.now, input.instructionId, input.instructionAggregateVersion),
    database.prepare(`
      UPDATE order_evidence_submissions
      SET resubmission_deadline_at=NULL
      WHERE id=?
    `).bind(input.submissionId),
    database.prepare(`
      INSERT INTO order_instruction_events (
        id, instruction_id, reservation_id, instruction_version_id,
        event_type, actor_type, actor_id, previous_status, next_status,
        aggregate_version, reason, metadata_json, idempotency_key, created_at
      ) VALUES (?, ?, ?, NULL, 'EVIDENCE_RESUBMITTED',
        'BUYER_CUSTOMER', ?, 'ACTIVE', 'ACTIVE', ?, NULL, ?, ?, ?)
    `).bind(
      crypto.randomUUID(), input.instructionId, input.reservationId,
      input.buyerCustomerId, input.instructionAggregateVersion + 1,
      canonicalJson({
        submission_id: input.submissionId,
        previous_resubmission_deadline_at: input.deadlineSnapshot,
      }),
      input.idempotencyKey, input.now,
    ),
  ];
}

export function setChangesRequestedDeadlineStatements(
  database: SqlDatabase,
  input: {
    instructionId: string;
    instructionAggregateVersion: number;
    submissionId: string;
    reservationId: string;
    actorStaffId: string;
    idempotencyKey: string;
    now: number;
  },
): readonly SqlStatement[] {
  const deadline = input.now + 2 * 60 * 60 * 1000;
  return [
    database.prepare(`
      UPDATE order_instructions
      SET resubmission_deadline_at=?, version=version+1,
          updated_at=MAX(?, updated_at+1)
      WHERE id=? AND status='ACTIVE' AND version=?
    `).bind(
      deadline,
      input.now,
      input.instructionId,
      input.instructionAggregateVersion,
    ),
    database.prepare(`
      UPDATE order_evidence_submissions
      SET resubmission_deadline_at=?
      WHERE id=? AND status='CHANGES_REQUESTED'
    `).bind(deadline, input.submissionId),
    database.prepare(`
      INSERT INTO order_instruction_events (
        id, instruction_id, reservation_id, instruction_version_id,
        event_type, actor_type, actor_id, previous_status, next_status,
        aggregate_version, reason, metadata_json, idempotency_key, created_at
      ) VALUES (?, ?, ?, NULL, 'EVIDENCE_CHANGES_REQUESTED',
        'STAFF', ?, 'ACTIVE', 'ACTIVE', ?, NULL, ?, ?, ?)
    `).bind(
      crypto.randomUUID(), input.instructionId, input.reservationId,
      input.actorStaffId, input.instructionAggregateVersion + 1,
      canonicalJson({
        submission_id: input.submissionId,
        resubmission_deadline_at: deadline,
      }),
      input.idempotencyKey, input.now,
    ),
  ];
}

async function read(
  database: SqlDatabase,
  reservationId: string,
  buyerCustomerId: string,
): Promise<EvidenceContextRow | null> {
  return database.prepare(`
    SELECT instruction.id AS instruction_id,
      instruction.version AS instruction_version,
      instruction.status AS instruction_status,
      instruction.current_version_no,
      instruction.initial_deadline_at,
      instruction.resubmission_deadline_at,
      version.id AS instruction_version_id,
      version.reference_order_amount_jpy,
      version.buyer_self_pay_bps,
      evidence.status AS evidence_status,
      formal_order.id AS formal_order_id
    FROM order_instructions instruction
    JOIN order_instruction_versions version
      ON version.instruction_id=instruction.id
      AND version.version_no=instruction.current_version_no
    LEFT JOIN order_evidence_submissions evidence
      ON evidence.reservation_id=instruction.reservation_id
    LEFT JOIN formal_orders formal_order
      ON formal_order.reservation_id=instruction.reservation_id
    WHERE instruction.reservation_id=?
      AND instruction.buyer_customer_id=?
  `).bind(reservationId, buyerCustomerId).first<EvidenceContextRow>();
}
