import type { SqlDatabase, SqlStatement } from '@ygb/contracts';
import {
  convertJpyToCnyFen,
  parseCnyPerJpyE8,
  parseJpyInteger,
  toD1SafeInteger,
} from '@ygb/domain';
import { OrderInstructionError } from './shared';
import { completeInstructionWithFormalOrderStatements } from './workflow-integration';

export interface FormalInstructionSource {
  instruction_id: string;
  instruction_version_id: string;
  instruction_aggregate_version: number;
  instruction_status: string;
  buyer_self_pay_bps: number;
  buyer_self_pay_jpy: number;
  buyer_refundable_principal_jpy: number;
}

export async function requireFormalInstructionSource(
  database: SqlDatabase,
  input: {
    reservationId: string;
    evidenceVersionId: string;
  },
): Promise<FormalInstructionSource> {
  const row = await database.prepare(`
    SELECT instruction.id AS instruction_id,
      instruction.version AS instruction_aggregate_version,
      instruction.status AS instruction_status,
      evidence.order_instruction_version_id AS instruction_version_id,
      evidence.buyer_self_pay_bps_snapshot AS buyer_self_pay_bps,
      evidence.buyer_self_pay_jpy,
      evidence.buyer_refundable_principal_jpy
    FROM order_instructions instruction
    JOIN order_evidence_versions evidence
      ON evidence.order_instruction_id=instruction.id
      AND evidence.id=?
    WHERE instruction.reservation_id=?
      AND evidence.order_instruction_version_id IN (
        SELECT id FROM order_instruction_versions
        WHERE instruction_id=instruction.id
          AND version_no=instruction.current_version_no
      )
  `).bind(
    input.evidenceVersionId,
    input.reservationId,
  ).first<FormalInstructionSource>();
  if (!row || row.instruction_status !== 'ACTIVE') {
    throw new OrderInstructionError('STATE_CONFLICT', 409);
  }
  return row;
}

export async function assertOrderNumberAvailable(
  database: SqlDatabase,
  marketplaceCode: 'AMAZON_JP',
  amazonOrderNumberNormalized: string,
  evidenceSubmissionId?: string,
): Promise<void> {
  const conflict = await database.prepare(`
    SELECT 1 AS found FROM formal_order_number_conflicts
    WHERE marketplace_code=? AND amazon_order_number_normalized=?
      AND status='OPEN'
  `).bind(marketplaceCode, amazonOrderNumberNormalized).first();
  if (conflict) {
    throw new OrderInstructionError(
      'ORDER_NUMBER_CONFLICT_REQUIRES_REVIEW',
      409,
    );
  }
  const claim = await database.prepare(`
    SELECT evidence_submission_id FROM formal_order_number_claims
    WHERE marketplace_code=? AND amazon_order_number_normalized=?
      AND status IN ('PROVISIONAL','FINAL')
  `).bind(marketplaceCode, amazonOrderNumberNormalized).first<{
    evidence_submission_id: string;
  }>();
  if (claim && claim.evidence_submission_id !== evidenceSubmissionId) {
    throw new OrderInstructionError('ORDER_NUMBER_ALREADY_CLAIMED', 409);
  }
}

export function provisionalOrderNumberClaimStatements(
  database: SqlDatabase,
  input: {
    marketplaceCode: 'AMAZON_JP';
    amazonOrderNumberNormalized: string;
    evidenceSubmissionId: string;
    evidenceVersionId: string;
    claimedAt: number;
  },
): readonly SqlStatement[] {
  return [
    database.prepare(`
      UPDATE formal_order_number_claims
      SET status='RELEASED', version=version+1,
          updated_at=MAX(?, updated_at+1), released_at=?
      WHERE evidence_submission_id=? AND status='PROVISIONAL'
        AND (marketplace_code<>? OR amazon_order_number_normalized<>?)
    `).bind(
      input.claimedAt,
      input.claimedAt,
      input.evidenceSubmissionId,
      input.marketplaceCode,
      input.amazonOrderNumberNormalized,
    ),
    database.prepare(`
      UPDATE formal_order_number_claims
      SET current_evidence_version_id=?, version=version+1,
          updated_at=MAX(?, updated_at+1)
      WHERE evidence_submission_id=? AND marketplace_code=?
        AND amazon_order_number_normalized=? AND status='PROVISIONAL'
        AND current_evidence_version_id<>?
    `).bind(
      input.evidenceVersionId,
      input.claimedAt,
      input.evidenceSubmissionId,
      input.marketplaceCode,
      input.amazonOrderNumberNormalized,
      input.evidenceVersionId,
    ),
    database.prepare(`
    INSERT INTO formal_order_number_claims (
      id, marketplace_code, amazon_order_number_normalized,
      evidence_submission_id, current_evidence_version_id,
      formal_order_id, status, version, claimed_at, updated_at,
      finalized_at, released_at
    )
    SELECT ?, ?, ?, ?, ?, NULL, 'PROVISIONAL', 1, ?, ?, NULL, NULL
    WHERE NOT EXISTS (
      SELECT 1 FROM formal_order_number_claims
      WHERE evidence_submission_id=? AND marketplace_code=?
        AND amazon_order_number_normalized=?
        AND status='PROVISIONAL'
        AND current_evidence_version_id=?
    )
  `).bind(
      crypto.randomUUID(),
      input.marketplaceCode,
      input.amazonOrderNumberNormalized,
      input.evidenceSubmissionId,
      input.evidenceVersionId,
      input.claimedAt,
      input.claimedAt,
      input.evidenceSubmissionId,
      input.marketplaceCode,
      input.amazonOrderNumberNormalized,
      input.evidenceVersionId,
    ),
    assertActiveOrderNumberClaimStatement(database, input),
  ];
}

export async function requireProvisionalOrderNumberClaim(
  database: SqlDatabase,
  input: {
    marketplaceCode: 'AMAZON_JP';
    amazonOrderNumberNormalized: string;
    evidenceSubmissionId: string;
    evidenceVersionId: string;
  },
): Promise<void> {
  const claim = await database.prepare(`
    SELECT 1 AS found FROM formal_order_number_claims
    WHERE marketplace_code=? AND amazon_order_number_normalized=?
      AND evidence_submission_id=? AND current_evidence_version_id=?
      AND status='PROVISIONAL' AND formal_order_id IS NULL
  `).bind(
    input.marketplaceCode,
    input.amazonOrderNumberNormalized,
    input.evidenceSubmissionId,
    input.evidenceVersionId,
  ).first();
  if (!claim) {
    throw new OrderInstructionError('ORDER_NUMBER_ALREADY_CLAIMED', 409);
  }
}

export function finalizeOrderNumberClaimStatement(
  database: SqlDatabase,
  input: {
    marketplaceCode: 'AMAZON_JP';
    amazonOrderNumberNormalized: string;
    evidenceSubmissionId: string;
    evidenceVersionId: string;
    formalOrderId: string;
    now: number;
  },
): SqlStatement {
  return database.prepare(`
    UPDATE formal_order_number_claims
    SET status='FINAL', formal_order_id=?, version=version+1,
        updated_at=MAX(?, updated_at+1), finalized_at=?
    WHERE marketplace_code=? AND amazon_order_number_normalized=?
      AND evidence_submission_id=? AND current_evidence_version_id=?
      AND status='PROVISIONAL' AND formal_order_id IS NULL
  `).bind(
    input.formalOrderId,
    input.now,
    input.now,
    input.marketplaceCode,
    input.amazonOrderNumberNormalized,
    input.evidenceSubmissionId,
    input.evidenceVersionId,
  );
}

function assertActiveOrderNumberClaimStatement(
  database: SqlDatabase,
  input: {
    marketplaceCode: 'AMAZON_JP';
    amazonOrderNumberNormalized: string;
    evidenceSubmissionId: string;
    evidenceVersionId: string;
  },
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM formal_order_number_claims
      WHERE marketplace_code=? AND amazon_order_number_normalized=?
        AND evidence_submission_id=? AND current_evidence_version_id=?
        AND status='PROVISIONAL' AND formal_order_id IS NULL
    ) THEN 1 ELSE 0 END
  `).bind(
    input.marketplaceCode,
    input.amazonOrderNumberNormalized,
    input.evidenceSubmissionId,
    input.evidenceVersionId,
  );
}

export function calculateBuyerFormalFinancials(
  input: {
    finalPaidJpy: number;
    buyerRefundablePrincipalJpy: number;
    buyerCnyPerJpyE8: string;
  },
): {
  buyerGrossPrincipalCnyFen: number;
  buyerExpectedPrincipalCnyFen: number;
  buyerSelfPayContributionCnyFen: number;
} {
  const rate = parseCnyPerJpyE8(input.buyerCnyPerJpyE8);
  const gross = convertJpyToCnyFen(
    parseJpyInteger(String(input.finalPaidJpy)),
    rate,
    'HALF_UP',
  );
  const expected = convertJpyToCnyFen(
    parseJpyInteger(String(input.buyerRefundablePrincipalJpy)),
    rate,
    'HALF_UP',
  );
  return {
    buyerGrossPrincipalCnyFen: toD1SafeInteger(gross),
    buyerExpectedPrincipalCnyFen: toD1SafeInteger(expected),
    buyerSelfPayContributionCnyFen: toD1SafeInteger(gross - expected),
  };
}

export function completeFormalInstructionStatements(
  database: SqlDatabase,
  input: {
    source: FormalInstructionSource;
    reservationId: string;
    formalOrderId: string;
    now: number;
  },
): readonly SqlStatement[] {
  return completeInstructionWithFormalOrderStatements(database, {
    instructionId: input.source.instruction_id,
    reservationId: input.reservationId,
    expectedVersion: Number(input.source.instruction_aggregate_version),
    formalOrderId: input.formalOrderId,
    now: input.now,
  });
}
