import type { SqlDatabase, SqlStatement } from '@ygb/contracts';
import { estimateBuyerSelfPay, validateBuyerSelfPayBps } from './demand-self-pay';
import { OrderInstructionError } from './shared';
import { createInstructionForApprovedReservationStatement } from './workflow-integration';

export interface ReservationAcceptanceSource {
  demand_version: number;
  buyer_self_pay_bps_snapshot: number;
  ordering_guide_expected_amount_jpy: number;
}

export interface ReservationAcceptanceFacts {
  buyerSelfPayBps: number;
  referenceOrderAmountJpy: number;
  estimatedSelfPayJpy: number;
  estimatedRefundablePrincipalJpy: number;
  acceptedDemandVersion: number;
}

export function validateReservationSelfPayAcceptance(
  source: ReservationAcceptanceSource,
  input: {
    expectedDemandVersion: number;
    acceptedBuyerSelfPayBps: number;
  },
): ReservationAcceptanceFacts {
  if (!Number.isSafeInteger(input.expectedDemandVersion)
    || input.expectedDemandVersion < 1
    || source.demand_version !== input.expectedDemandVersion) {
    throw new OrderInstructionError('VERSION_CONFLICT', 409);
  }
  const frozenBps = validateBuyerSelfPayBps(
    source.buyer_self_pay_bps_snapshot,
  );
  if (validateBuyerSelfPayBps(input.acceptedBuyerSelfPayBps) !== frozenBps) {
    throw new OrderInstructionError('SELF_PAY_ACCEPTANCE_MISMATCH', 409);
  }
  const reference = Number(source.ordering_guide_expected_amount_jpy);
  if (!Number.isSafeInteger(reference) || reference < 0) {
    throw new OrderInstructionError('ORDERING_PROFILE_REQUIRED', 409);
  }
  const estimate = estimateBuyerSelfPay(reference, frozenBps);
  return {
    buyerSelfPayBps: frozenBps,
    referenceOrderAmountJpy: reference,
    estimatedSelfPayJpy: estimate.estimatedBuyerSelfPayJpy,
    estimatedRefundablePrincipalJpy:
      estimate.estimatedRefundablePrincipalJpy,
    acceptedDemandVersion: source.demand_version,
  };
}

export function createApprovedInstructionStatements(
  database: SqlDatabase,
  input: {
    reservationId: string;
    buyerCustomerId: string;
    marketplaceCode: 'JP';
    now: number;
    instructionId?: string;
    idempotencyKey: string;
    actorStaffId: string;
  },
): { instructionId: string; statements: readonly SqlStatement[] } {
  const instructionId = input.instructionId ?? crypto.randomUUID();
  return {
    instructionId,
    statements: [
      createInstructionForApprovedReservationStatement(database, {
      instructionId,
      reservationId: input.reservationId,
      buyerCustomerId: input.buyerCustomerId,
      marketplaceCode: input.marketplaceCode,
        now: input.now,
      }),
      database.prepare(`
        INSERT INTO order_instruction_events (
          id, instruction_id, reservation_id, instruction_version_id,
          event_type, actor_type, actor_id, previous_status, next_status,
          aggregate_version, reason, metadata_json, idempotency_key, created_at
        ) VALUES (?, ?, ?, NULL, 'INSTRUCTION_CREATED', 'STAFF', ?,
          NULL, 'UNPUBLISHED', 1, NULL, '{}', ?, ?)
      `).bind(
        crypto.randomUUID(),
        instructionId,
        input.reservationId,
        input.actorStaffId,
        input.idempotencyKey,
        input.now,
      ),
    ],
  };
}
