import type {
  PricingReviewType,
  ResolvedSellerServiceFee,
  SqlDatabase,
} from '@ygb/contracts';
import { DEMAND_TASK_TYPES, isPricingReviewType } from '@ygb/contracts';
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

export interface SellerServiceFeeOverviewEntry {
  review_type: PricingReviewType;
  effective_fee: {
    fee_version_id: string;
    version_no: number;
    fee_cny_fen: string;
    effective_from: number;
    confirmed_at: number;
  } | null;
  pending_fee: {
    fee_version_id: string;
    version_no: number;
    decision_version: number;
    fee_cny_fen: string;
    effective_from: number;
  } | null;
  /** Earliest confirmed fee that becomes effective strictly after `at`. */
  upcoming_fee: {
    fee_version_id: string;
    version_no: number;
    fee_cny_fen: string;
    effective_from: number;
    confirmed_at: number;
  } | null;
  next_version: number;
}

/**
 * Per-review-type service fee state for the staff rate center: the currently
 * effective confirmed fee, any submitted-but-undecided fee, and the next
 * submit version.  Missing types are returned with null facts so the UI can
 * render the full four-type configuration matrix.
 */
export async function readSellerServiceFeeOverview(
  database: SqlDatabase,
  input: { sellerOrganizationId: string; at: number },
): Promise<SellerServiceFeeOverviewEntry[]> {
  const rows = await database
    .prepare(
      `
      SELECT id, review_type, version_no, status, fee_cny_fen,
             effective_from, decision_version, confirmed_at
      FROM seller_service_fee_versions
      WHERE organization_id=?
      ORDER BY review_type, version_no
    `,
    )
    .bind(input.sellerOrganizationId)
    .all<{
      id: string;
      review_type: string;
      version_no: number;
      status: string;
      fee_cny_fen: number;
      effective_from: number;
      decision_version: number;
      confirmed_at: number | null;
    }>();
  const entries = new Map<PricingReviewType, SellerServiceFeeOverviewEntry>(
    DEMAND_TASK_TYPES.map((reviewType) => [
      reviewType,
      {
        review_type: reviewType,
        effective_fee: null,
        pending_fee: null,
        upcoming_fee: null,
        next_version: 1,
      },
    ]),
  );
  for (const row of rows.results) {
    if (!isPricingReviewType(row.review_type)) continue;
    const entry = entries.get(row.review_type)!;
    entry.next_version = Number(row.version_no) + 1;
    if (row.status === 'SUBMITTED') {
      entry.pending_fee = {
        fee_version_id: row.id,
        version_no: Number(row.version_no),
        decision_version: Number(row.decision_version),
        fee_cny_fen: String(row.fee_cny_fen),
        effective_from: Number(row.effective_from),
      };
    } else if (row.status === 'CONFIRMED') {
      if (
        Number(row.effective_from) <= input.at
        && (entry.effective_fee === null
          || Number(row.effective_from) >= entry.effective_fee.effective_from)
      ) {
        entry.effective_fee = {
          fee_version_id: row.id,
          version_no: Number(row.version_no),
          fee_cny_fen: String(row.fee_cny_fen),
          effective_from: Number(row.effective_from),
          confirmed_at: Number(row.confirmed_at ?? 0),
        };
      } else if (
        Number(row.effective_from) > input.at
        && (entry.upcoming_fee === null
          || Number(row.effective_from) < entry.upcoming_fee.effective_from)
      ) {
        entry.upcoming_fee = {
          fee_version_id: row.id,
          version_no: Number(row.version_no),
          fee_cny_fen: String(row.fee_cny_fen),
          effective_from: Number(row.effective_from),
          confirmed_at: Number(row.confirmed_at ?? 0),
        };
      }
    }
  }
  return DEMAND_TASK_TYPES.map((reviewType) => entries.get(reviewType)!);
}
