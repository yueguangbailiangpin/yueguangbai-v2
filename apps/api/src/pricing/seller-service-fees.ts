import type {
  PricingReviewType,
  ResolvedSellerServiceFee,
  SqlDatabase,
} from '@ygb/contracts';
import { isPricingReviewType } from '@ygb/contracts';
import {
  decideSellerRuleVersion,
  resolveSellerRuleVersion,
  submitSellerRuleVersion,
  type SellerRuleConfiguration,
} from './seller-rule-engine';
import {
  PricingError,
  type PricingStaffActor,
} from './pricing-shared';

const CONFIG: SellerRuleConfiguration = {
  kind: 'SELLER_SERVICE_FEE',
  table: 'seller_service_fee_versions',
  eventTable: 'seller_service_fee_events',
  valueColumn: 'fee_cny_fen',
  submittedEvent: 'SELLER_SERVICE_FEE_SUBMITTED',
  confirmedEvent: 'SELLER_SERVICE_FEE_CONFIRMED',
  rejectedEvent: 'SELLER_SERVICE_FEE_REJECTED',
  usesReviewType: true,
};

export async function submitSellerServiceFee(
  database: SqlDatabase,
  input: {
    sellerOrganizationId: string;
    reviewType: PricingReviewType;
    feeCnyFen: string;
    effectiveFrom: number;
    expectedVersion: number;
  },
  command: {
    actor: PricingStaffActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
) {
  assertReviewType(input.reviewType);
  return mapFee(await submitSellerRuleVersion(
    database,
    CONFIG,
    {
      sellerOrganizationId: input.sellerOrganizationId,
      reviewType: input.reviewType,
      rawValue: input.feeCnyFen,
      effectiveFrom: input.effectiveFrom,
      expectedVersion: input.expectedVersion,
    },
    command,
  ));
}

export async function confirmSellerServiceFee(
  database: SqlDatabase,
  input: { feeVersionId: string; expectedVersion: number },
  command: {
    actor: PricingStaffActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
) {
  return mapFee(await decideSellerRuleVersion(
    database,
    CONFIG,
    {
      versionId: input.feeVersionId,
      expectedVersion: input.expectedVersion,
      decision: 'CONFIRM',
    },
    command,
  ));
}

export async function rejectSellerServiceFee(
  database: SqlDatabase,
  input: {
    feeVersionId: string;
    expectedVersion: number;
    rejectionReason: string;
  },
  command: {
    actor: PricingStaffActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
) {
  return mapFee(await decideSellerRuleVersion(
    database,
    CONFIG,
    {
      versionId: input.feeVersionId,
      expectedVersion: input.expectedVersion,
      decision: 'REJECT',
      rejectionReason: input.rejectionReason,
    },
    command,
  ));
}

export async function resolveSellerServiceFee(
  database: SqlDatabase,
  input: {
    sellerOrganizationId: string;
    reviewType: PricingReviewType;
    at: number;
  },
): Promise<ResolvedSellerServiceFee> {
  assertReviewType(input.reviewType);
  const result = await resolveSellerRuleVersion(
    database,
    CONFIG,
    {
      sellerOrganizationId: input.sellerOrganizationId,
      reviewType: input.reviewType,
      at: input.at,
    },
  );
  return {
    fee_version_id: result.version_id,
    seller_organization_id: result.seller_organization_id,
    review_type: result.review_type!,
    version_no: result.version_no,
    fee_cny_fen: result.value,
    effective_from: result.effective_from,
    confirmed_at: result.confirmed_at!,
  };
}

function assertReviewType(value: unknown): asserts value is PricingReviewType {
  if (!isPricingReviewType(value)) {
    throw new PricingError('VALIDATION_ERROR', 400);
  }
}

function mapFee(result: Awaited<
  ReturnType<typeof submitSellerRuleVersion>
>) {
  return {
    fee_version_id: result.version_id,
    seller_organization_id: result.seller_organization_id,
    review_type: result.review_type!,
    version_no: result.version_no,
    decision_version: result.decision_version,
    status: result.status,
    fee_cny_fen: result.value,
    effective_from: result.effective_from,
    rejection_reason: result.rejection_reason,
    confirmed_at: result.confirmed_at,
    replayed: result.replayed,
  };
}
