import type {
  MarketplaceCode,
  PricingReviewType,
  ResolvedSellerServiceFee,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import { DEMAND_TASK_TYPES, isPricingReviewType } from '@ygb/contracts';
import { hashCanonicalJson } from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  markIdempotencyFailed,
} from '../foundation/idempotency';
import {
  cleanEpochMilliseconds,
  cleanExpectedVersion,
  cleanFeeFen,
  cleanPricingIdentifier,
  normalizePricingError,
  PricingError,
  requireRateMaintainer,
  type PricingStaffActor,
} from './pricing-shared';

/**
 * Stage 6.6 (D-056) single-source service-fee model: `seller_service_fee_rule_versions`
 * is the only table, keyed by seller organization + marketplace + review type.
 * One save immediately forms a new effective, immutable version (no dual
 * approval). Owner and seller_ops have identical maintenance rights; formal
 * orders lock the resolved rule version into their immutable snapshot.
 */

const MARKETPLACE: MarketplaceCode = 'AMAZON_JP';

export interface SaveSellerServiceFeeRuleResult {
  rule_version_id: string;
  seller_organization_id: string;
  marketplace_code: MarketplaceCode;
  review_type: PricingReviewType;
  version_no: number;
  fee_cny_fen: string;
  effective_from: number;
  replayed: boolean;
}

export async function saveSellerServiceFeeRule(
  database: SqlDatabase,
  input: {
    sellerOrganizationId: string;
    reviewType: PricingReviewType;
    feeCnyFen: string;
    expectedVersion: number;
  },
  command: {
    actor: PricingStaffActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<SaveSellerServiceFeeRuleResult> {
  requireRateMaintainer(command.actor);
  assertReviewType(input.reviewType);
  const sellerOrganizationId = cleanPricingIdentifier(input.sellerOrganizationId);
  const fee = cleanFeeFen(input.feeCnyFen);
  const expectedVersion = cleanExpectedVersion(input.expectedVersion, { allowZero: true });
  const now = cleanEpochMilliseconds(command.now ?? Date.now());

  const requestHash = await hashCanonicalJson({
    action: 'SAVE_SELLER_SERVICE_FEE_RULE',
    seller_organization_id: sellerOrganizationId,
    marketplace_code: MARKETPLACE,
    review_type: input.reviewType,
    fee_cny_fen: fee.serialized,
    expected_version: expectedVersion,
  });
  const acquired = await acquireIdempotency<SaveSellerServiceFeeRuleResult>(
    database,
    {
      actorType: 'STAFF',
      actorId: command.actor.staffId,
      action: 'SAVE_SELLER_SERVICE_FEE_RULE',
      targetType: 'SELLER_SERVICE_FEE_RULE',
      targetId: `${sellerOrganizationId}:${MARKETPLACE}:${input.reviewType}`,
      idempotencyKey: command.idempotencyKey,
      requestHash,
    },
    { now },
  );
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }

  try {
    await requireActiveSellerOrganization(database, sellerOrganizationId);
    const latestVersion = await readLatestRuleVersion(
      database,
      sellerOrganizationId,
      input.reviewType,
    );
    if (latestVersion !== expectedVersion) {
      throw new PricingError('VERSION_CONFLICT', 409);
    }

    const ruleVersionId = crypto.randomUUID();
    const versionNo = expectedVersion + 1;
    const response: SaveSellerServiceFeeRuleResult = {
      rule_version_id: ruleVersionId,
      seller_organization_id: sellerOrganizationId,
      marketplace_code: MARKETPLACE,
      review_type: input.reviewType,
      version_no: versionNo,
      fee_cny_fen: fee.serialized,
      effective_from: now,
      replayed: false,
    };

    await database.batch([
      database
        .prepare(
          `
        INSERT INTO seller_service_fee_rule_versions (
          id, seller_organization_id, marketplace_code, review_type,
          version_no, fee_amount_minor, fee_currency_code,
          fee_currency_exponent, effective_from, created_by_staff_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'CNY', 2, ?, ?, ?)
      `,
        )
        .bind(
          ruleVersionId,
          sellerOrganizationId,
          MARKETPLACE,
          input.reviewType,
          versionNo,
          fee.databaseValue,
          now,
          command.actor.staffId,
          now,
        ),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'SELLER_SERVICE_FEE_RULE',
        aggregateId: ruleVersionId,
        eventType: 'SELLER_SERVICE_FEE_RULE_SAVED',
        actor: {
          type: 'STAFF',
          id: command.actor.staffId,
          roles: command.actor.roles,
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        nextState: response,
        createdAt: now,
      }),
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: { rule_version_id: ruleVersionId },
        now,
      }),
      assertRuleSaved(database, acquired.claim, response),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ]);
    return response;
  } catch (error) {
    const normalized = normalizePricingError(error);
    await markIdempotencyFailed(database, acquired.claim, normalized.code, now);
    throw normalized;
  }
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
  const at = cleanEpochMilliseconds(input.at);
  const row = await database
    .prepare(
      `
    SELECT id, version_no, fee_amount_minor, effective_from, created_at
    FROM seller_service_fee_rule_versions
    WHERE seller_organization_id=? AND marketplace_code=? AND review_type=?
      AND effective_from<=?
    ORDER BY effective_from DESC, version_no DESC
    LIMIT 1
  `,
    )
    .bind(input.sellerOrganizationId, MARKETPLACE, input.reviewType, at)
    .first<{
      id: string;
      version_no: number;
      fee_amount_minor: number;
      effective_from: number;
      created_at: number;
    }>();
  if (!row) {
    throw new PricingError('PRICING_RULE_NOT_FOUND', 404);
  }
  return {
    fee_version_id: row.id,
    seller_organization_id: input.sellerOrganizationId,
    review_type: input.reviewType,
    version_no: Number(row.version_no),
    fee_cny_fen: String(row.fee_amount_minor),
    effective_from: Number(row.effective_from),
    created_at: Number(row.created_at),
  };
}

export interface SellerServiceFeeOverviewEntry {
  review_type: PricingReviewType;
  effective_fee: {
    rule_version_id: string;
    version_no: number;
    fee_cny_fen: string;
    effective_from: number;
    created_at: number;
  } | null;
  next_version: number;
}

/**
 * Per-review-type service-fee state for the staff rate center: the currently
 * effective rule version and the next save version. Missing types return null
 * facts so the UI can render the full four-type configuration matrix.
 */
export async function readSellerServiceFeeOverview(
  database: SqlDatabase,
  input: { sellerOrganizationId: string; at: number },
): Promise<SellerServiceFeeOverviewEntry[]> {
  const at = cleanEpochMilliseconds(input.at);
  const rows = await database
    .prepare(
      `
      SELECT id, review_type, version_no, fee_amount_minor,
             effective_from, created_at
      FROM seller_service_fee_rule_versions
      WHERE seller_organization_id=? AND marketplace_code=?
      ORDER BY review_type, version_no
    `,
    )
    .bind(input.sellerOrganizationId, MARKETPLACE)
    .all<{
      id: string;
      review_type: string;
      version_no: number;
      fee_amount_minor: number;
      effective_from: number;
      created_at: number;
    }>();
  const entries = new Map<PricingReviewType, SellerServiceFeeOverviewEntry>(
    DEMAND_TASK_TYPES.map((reviewType) => [
      reviewType,
      {
        review_type: reviewType,
        effective_fee: null,
        next_version: 1,
      },
    ]),
  );
  for (const row of rows.results) {
    if (!isPricingReviewType(row.review_type)) continue;
    const entry = entries.get(row.review_type)!;
    entry.next_version = Number(row.version_no) + 1;
    if (
      Number(row.effective_from) <= at
      && (entry.effective_fee === null
        || Number(row.effective_from) >= entry.effective_fee.effective_from)
    ) {
      entry.effective_fee = {
        rule_version_id: row.id,
        version_no: Number(row.version_no),
        fee_cny_fen: String(row.fee_amount_minor),
        effective_from: Number(row.effective_from),
        created_at: Number(row.created_at),
      };
    }
  }
  return DEMAND_TASK_TYPES.map((reviewType) => entries.get(reviewType)!);
}

function assertReviewType(value: unknown): asserts value is PricingReviewType {
  if (!isPricingReviewType(value)) {
    throw new PricingError('VALIDATION_ERROR', 400);
  }
}

async function readLatestRuleVersion(
  database: SqlDatabase,
  sellerOrganizationId: string,
  reviewType: PricingReviewType,
): Promise<number> {
  const row = await database
    .prepare(
      `
    SELECT COALESCE(MAX(version_no), 0) AS latest_version
    FROM seller_service_fee_rule_versions
    WHERE seller_organization_id=? AND marketplace_code=? AND review_type=?
  `,
    )
    .bind(sellerOrganizationId, MARKETPLACE, reviewType)
    .first<{ latest_version: number }>();
  return Number(row?.latest_version ?? 0);
}

async function requireActiveSellerOrganization(
  database: SqlDatabase,
  id: string,
): Promise<void> {
  const row = await database.prepare(
    `SELECT 1 AS ok FROM seller_organizations WHERE id=? AND status='ACTIVE'`,
  ).bind(id).first<{ ok: number }>();
  if (!row) throw new PricingError('NOT_FOUND', 404);
}

function assertRuleSaved(
  database: SqlDatabase,
  claim: {
    actorType: string;
    actorId: string;
    idempotencyKey: string;
    leaseToken: string;
  },
  response: SaveSellerServiceFeeRuleResult,
): SqlStatement {
  return database
    .prepare(
      `
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (
        SELECT 1 FROM seller_service_fee_rule_versions
        WHERE id=? AND seller_organization_id=? AND version_no=?
      )
      AND EXISTS (
        SELECT 1 FROM command_idempotency_records
        WHERE actor_type=? AND actor_id=? AND idempotency_key=?
          AND status='COMMITTED' AND lease_token=?
      )
    THEN 1 ELSE 0 END
  `,
    )
    .bind(
      response.rule_version_id,
      response.seller_organization_id,
      response.version_no,
      claim.actorType,
      claim.actorId,
      claim.idempotencyKey,
      claim.leaseToken,
    );
}
