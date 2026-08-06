import type {
  CanonicalMarketplaceCode,
  PricingReviewType,
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
} from '../foundation/idempotency';
import { resolveMarketplace } from '../marketplaces/registry';
import {
  cleanEpochMilliseconds,
  cleanExpectedVersion,
  cleanFeeFen,
  cleanPricingIdentifier,
  normalizePricingError,
  PricingError,
  requireOwnerConfirmer,
  requireSellerOpsSubmitter,
  type PricingStaffActor,
} from './pricing-shared';

export interface MarketplaceServiceFeeResult {
  fee_rule_version_id: string;
  seller_organization_id: string;
  marketplace_code: CanonicalMarketplaceCode;
  review_type: PricingReviewType;
  version_no: number;
  decision_version: number;
  status: 'SUBMITTED' | 'CONFIRMED';
  fee_amount_minor: string;
  fee_currency_code: 'CNY';
  fee_currency_exponent: 2;
  effective_from: number;
  confirmed_at: number | null;
  replayed: boolean;
}

interface FeeCommand {
  actor: PricingStaffActor;
  idempotencyKey: string;
  requestId?: string | null;
  now?: number;
}

export async function submitMarketplaceServiceFee(
  database: SqlDatabase,
  input: {
    sellerOrganizationId: string;
    marketplaceCode: CanonicalMarketplaceCode;
    reviewType: PricingReviewType;
    feeAmountMinor: string;
    effectiveFrom: number;
    expectedVersion: number;
  },
  command: FeeCommand,
): Promise<MarketplaceServiceFeeResult> {
  requireSellerOpsSubmitter(command.actor);
  const sellerId = cleanPricingIdentifier(input.sellerOrganizationId);
  const fee = cleanFeeFen(input.feeAmountMinor);
  const effectiveFrom = cleanEpochMilliseconds(input.effectiveFrom);
  const expectedVersion = cleanExpectedVersion(input.expectedVersion, {
    allowZero: true,
  });
  const now = cleanEpochMilliseconds(command.now ?? Date.now());
  const marketplace = await resolveMarketplace(database, input.marketplaceCode, {
    requireActive: true, requireAdapter: true,
  });
  await requireActiveSeller(database, sellerId);
  const targetId = `${sellerId}:${marketplace.code}:${input.reviewType}`;
  const action = 'SUBMIT_MARKETPLACE_SERVICE_FEE';
  const requestHash = await hashCanonicalJson({
    action, seller_organization_id: sellerId,
    marketplace_code: marketplace.code, review_type: input.reviewType,
    fee_amount_minor: fee.serialized, fee_currency_code: 'CNY',
    fee_currency_exponent: 2, effective_from: effectiveFrom,
    expected_version: expectedVersion,
  });
  const acquired = await acquireIdempotency<MarketplaceServiceFeeResult>(
    database, {
      actorType: 'STAFF', actorId: command.actor.staffId, action,
      targetType: 'MARKETPLACE_SERVICE_FEE', targetId,
      idempotencyKey: command.idempotencyKey, requestHash,
    }, { now },
  );
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }
  try {
    const latest = await database.prepare(`
      SELECT COALESCE(MAX(version_no),0) AS latest_version,
        COALESCE(SUM(status='SUBMITTED'),0) AS pending_count
      FROM seller_service_fee_rule_versions
      WHERE seller_organization_id=? AND marketplace_code=? AND review_type=?
    `).bind(sellerId, marketplace.code, input.reviewType).first<{
      latest_version: number; pending_count: number;
    }>();
    if (Number(latest?.latest_version ?? 0) !== expectedVersion) {
      throw new PricingError('VERSION_CONFLICT', 409);
    }
    if (Number(latest?.pending_count ?? 0) > 0) {
      throw new PricingError('PRICING_RULE_PENDING_CONFLICT', 409);
    }
    const id = crypto.randomUUID();
    const response: MarketplaceServiceFeeResult = {
      fee_rule_version_id: id, seller_organization_id: sellerId,
      marketplace_code: marketplace.code, review_type: input.reviewType,
      version_no: expectedVersion + 1, decision_version: 1,
      status: 'SUBMITTED', fee_amount_minor: fee.serialized,
      fee_currency_code: 'CNY', fee_currency_exponent: 2,
      effective_from: effectiveFrom, confirmed_at: null, replayed: false,
    };
    await database.batch([
      database.prepare(`
        INSERT INTO seller_service_fee_rule_versions (
          id, legacy_fee_id, seller_organization_id, marketplace_code,
          review_type, version_no, status, fee_amount_minor,
          fee_currency_code, fee_currency_exponent, effective_from,
          submitted_by_staff_id, submitted_at, decision_version,
          confirmed_by_staff_id, confirmed_at, rejected_by_staff_id,
          rejected_at, rejection_reason
        ) VALUES (?,NULL,?,?,?,?,'SUBMITTED',?,'CNY',2,?,?,?,1,
          NULL,NULL,NULL,NULL,NULL)
      `).bind(id, sellerId, marketplace.code, input.reviewType,
        response.version_no, fee.databaseValue, effectiveFrom,
        command.actor.staffId, now),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(), aggregateType: 'MARKETPLACE_SERVICE_FEE',
        aggregateId: id, eventType: 'MARKETPLACE_SERVICE_FEE_SUBMITTED',
        actor: { type: 'STAFF', id: command.actor.staffId,
          roles: command.actor.roles },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        nextState: response, createdAt: now,
      }),
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: { fee_rule_version_id: id }, now,
      }),
      assertFeeState(database, acquired.claim, response),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ]);
    return response;
  } catch (error) {
    const normalized = normalizePricingError(error);
    await markIdempotencyFailed(database, acquired.claim, normalized.code, now);
    throw normalized;
  }
}

export async function confirmMarketplaceServiceFee(
  database: SqlDatabase,
  input: { feeRuleVersionId: string; expectedVersion: number },
  command: FeeCommand,
): Promise<MarketplaceServiceFeeResult> {
  requireOwnerConfirmer(command.actor);
  const id = cleanPricingIdentifier(input.feeRuleVersionId);
  const expectedVersion = cleanExpectedVersion(input.expectedVersion);
  const now = cleanEpochMilliseconds(command.now ?? Date.now());
  const action = 'CONFIRM_MARKETPLACE_SERVICE_FEE';
  const requestHash = await hashCanonicalJson({
    action, fee_rule_version_id: id, expected_version: expectedVersion,
  });
  const acquired = await acquireIdempotency<MarketplaceServiceFeeResult>(
    database, {
      actorType: 'STAFF', actorId: command.actor.staffId, action,
      targetType: 'MARKETPLACE_SERVICE_FEE', targetId: id,
      idempotencyKey: command.idempotencyKey, requestHash,
    }, { now },
  );
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }
  try {
    const source = await database.prepare(`
      SELECT id, seller_organization_id, marketplace_code, review_type,
        version_no, status, fee_amount_minor, effective_from,
        decision_version
      FROM seller_service_fee_rule_versions WHERE id=?
    `).bind(id).first<{
      id: string; seller_organization_id: string;
      marketplace_code: CanonicalMarketplaceCode;
      review_type: PricingReviewType; version_no: number; status: string;
      fee_amount_minor: number; effective_from: number;
      decision_version: number;
    }>();
    if (!source) throw new PricingError('PRICING_RULE_NOT_FOUND', 404);
    if (Number(source.decision_version) !== expectedVersion) {
      throw new PricingError('VERSION_CONFLICT', 409);
    }
    if (source.status !== 'SUBMITTED') {
      throw new PricingError('PRICING_RULE_ALREADY_DECIDED', 409);
    }
    if (Number(source.effective_from) <= now) {
      throw new PricingError('PRICING_RULE_EFFECTIVE_TIME_CONFLICT', 409);
    }
    const response: MarketplaceServiceFeeResult = {
      fee_rule_version_id: id,
      seller_organization_id: source.seller_organization_id,
      marketplace_code: source.marketplace_code,
      review_type: source.review_type,
      version_no: Number(source.version_no),
      decision_version: expectedVersion + 1, status: 'CONFIRMED',
      fee_amount_minor: String(source.fee_amount_minor),
      fee_currency_code: 'CNY', fee_currency_exponent: 2,
      effective_from: Number(source.effective_from), confirmed_at: now,
      replayed: false,
    };
    await database.batch([
      database.prepare(`
        UPDATE seller_service_fee_rule_versions
        SET status='CONFIRMED', decision_version=decision_version+1,
          confirmed_by_staff_id=?, confirmed_at=?
        WHERE id=? AND status='SUBMITTED' AND decision_version=?
      `).bind(command.actor.staffId, now, id, expectedVersion),
      database.prepare(`
        INSERT INTO transaction_assertions (assertion_value)
        SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END
      `),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(), aggregateType: 'MARKETPLACE_SERVICE_FEE',
        aggregateId: id, eventType: 'MARKETPLACE_SERVICE_FEE_CONFIRMED',
        actor: { type: 'STAFF', id: command.actor.staffId,
          roles: command.actor.roles },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: { status: 'SUBMITTED', decision_version: expectedVersion },
        nextState: response, createdAt: now,
      }),
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: { fee_rule_version_id: id }, now,
      }),
      assertFeeState(database, acquired.claim, response),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ]);
    return response;
  } catch (error) {
    const normalized = normalizePricingError(error);
    await markIdempotencyFailed(database, acquired.claim, normalized.code, now);
    throw normalized;
  }
}

function assertFeeState(
  database: SqlDatabase,
  claim: { actorType: string; actorId: string; idempotencyKey: string;
    leaseToken: string },
  response: MarketplaceServiceFeeResult,
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (SELECT 1 FROM seller_service_fee_rule_versions
        WHERE id=? AND status=? AND decision_version=?)
      AND EXISTS (SELECT 1 FROM command_idempotency_records
        WHERE actor_type=? AND actor_id=? AND idempotency_key=?
          AND status='COMMITTED' AND lease_token=?)
    THEN 1 ELSE 0 END
  `).bind(response.fee_rule_version_id, response.status,
    response.decision_version, claim.actorType, claim.actorId,
    claim.idempotencyKey, claim.leaseToken);
}

async function requireActiveSeller(
  database: SqlDatabase, sellerId: string,
): Promise<void> {
  const row = await database.prepare(`
    SELECT status FROM seller_organizations WHERE id=?
  `).bind(sellerId).first<{ status: string }>();
  if (!row) throw new PricingError('NOT_FOUND', 404);
  if (row.status !== 'ACTIVE') throw new PricingError('VALIDATION_ERROR', 400);
}
