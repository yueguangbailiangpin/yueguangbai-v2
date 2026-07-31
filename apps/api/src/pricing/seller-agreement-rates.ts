import type {
  ResolvedSellerAgreementRate,
  SqlDatabase,
} from '@ygb/contracts';
import {
  decideSellerRuleVersion,
  resolveSellerRuleVersion,
  submitSellerRuleVersion,
  type SellerRuleConfiguration,
} from './seller-rule-engine';
import type { PricingStaffActor } from './pricing-shared';

const CONFIG: SellerRuleConfiguration = {
  kind: 'SELLER_AGREEMENT_RATE',
  table: 'seller_agreement_rate_versions',
  eventTable: 'seller_agreement_rate_events',
  valueColumn: 'cny_per_jpy_e8',
  submittedEvent: 'SELLER_AGREEMENT_RATE_SUBMITTED',
  confirmedEvent: 'SELLER_AGREEMENT_RATE_CONFIRMED',
  rejectedEvent: 'SELLER_AGREEMENT_RATE_REJECTED',
  usesReviewType: false,
};

export async function submitSellerAgreementRate(
  database: SqlDatabase,
  input: {
    sellerOrganizationId: string;
    cnyPerJpyE8: string;
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
  const result = await submitSellerRuleVersion(
    database,
    CONFIG,
    {
      sellerOrganizationId: input.sellerOrganizationId,
      reviewType: null,
      rawValue: input.cnyPerJpyE8,
      effectiveFrom: input.effectiveFrom,
      expectedVersion: input.expectedVersion,
    },
    command,
  );
  return {
    rate_version_id: result.version_id,
    seller_organization_id: result.seller_organization_id,
    version_no: result.version_no,
    decision_version: result.decision_version,
    status: result.status,
    cny_per_jpy_e8: result.value,
    effective_from: result.effective_from,
    rejection_reason: result.rejection_reason,
    confirmed_at: result.confirmed_at,
    replayed: result.replayed,
  };
}

export async function confirmSellerAgreementRate(
  database: SqlDatabase,
  input: { rateVersionId: string; expectedVersion: number },
  command: {
    actor: PricingStaffActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
) {
  return mapAgreement(await decideSellerRuleVersion(
    database,
    CONFIG,
    {
      versionId: input.rateVersionId,
      expectedVersion: input.expectedVersion,
      decision: 'CONFIRM',
    },
    command,
  ));
}

export async function rejectSellerAgreementRate(
  database: SqlDatabase,
  input: {
    rateVersionId: string;
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
  return mapAgreement(await decideSellerRuleVersion(
    database,
    CONFIG,
    {
      versionId: input.rateVersionId,
      expectedVersion: input.expectedVersion,
      decision: 'REJECT',
      rejectionReason: input.rejectionReason,
    },
    command,
  ));
}

export async function resolveSellerAgreementRate(
  database: SqlDatabase,
  input: { sellerOrganizationId: string; at: number },
): Promise<ResolvedSellerAgreementRate> {
  const result = await resolveSellerRuleVersion(
    database,
    CONFIG,
    {
      sellerOrganizationId: input.sellerOrganizationId,
      reviewType: null,
      at: input.at,
    },
  );
  return {
    rate_version_id: result.version_id,
    seller_organization_id: result.seller_organization_id,
    version_no: result.version_no,
    cny_per_jpy_e8: result.value,
    effective_from: result.effective_from,
    confirmed_at: result.confirmed_at!,
  };
}

function mapAgreement(result: Awaited<
  ReturnType<typeof decideSellerRuleVersion>
>) {
  return {
    rate_version_id: result.version_id,
    seller_organization_id: result.seller_organization_id,
    version_no: result.version_no,
    decision_version: result.decision_version,
    status: result.status,
    cny_per_jpy_e8: result.value,
    effective_from: result.effective_from,
    rejection_reason: result.rejection_reason,
    confirmed_at: result.confirmed_at,
    replayed: result.replayed,
  };
}
