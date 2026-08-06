import type {
  CanonicalMarketplaceCode,
  CurrencyCode,
  CurrencyRateSnapshot,
  FormalOrderMarketplaceMoneySnapshot,
  Money,
  PricingReviewType,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import {
  convertMoney,
  hashCanonicalJson,
  money,
  normalizePlatformIdentifiers,
  parseChinaBusinessDate,
} from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  markIdempotencyFailed,
} from '../foundation/idempotency';
import {
  cleanEpochMilliseconds,
  cleanPricingIdentifier,
  normalizePricingError,
  PricingError,
  requireSellerOpsSubmitter,
  type PricingStaffActor,
} from '../pricing/pricing-shared';
import { resolveMarketplace } from './registry';

interface RateRow {
  id: string;
  version_no: number;
  source_currency_code: CurrencyCode;
  quote_currency_code: CurrencyCode;
  rate_value: number;
  rate_scale: number;
  rounding_rule: 'HALF_UP';
  effective_from: number | null;
  confirmed_at: number;
}

interface FeeRow {
  id: string;
  version_no: number;
  fee_amount_minor: number;
  effective_from: number;
  confirmed_at: number;
}

export async function lockFormalOrderMarketplaceMoneySnapshot(
  database: SqlDatabase,
  input: {
    formalOrderId: string;
    buyerCustomerId: string;
    sellerOrganizationId: string;
    storeId: string;
    marketplaceCode: CanonicalMarketplaceCode;
    reviewType: PricingReviewType;
    platformOrderIdentifier: string;
    platformProductIdentifier: string;
    platformOrderDate: string | null;
    payment: Money;
    buyerRateVersionId: string;
    sellerRateVersionId: string;
    serviceFeeRuleVersionId: string;
  },
  command: {
    actor: PricingStaffActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<FormalOrderMarketplaceMoneySnapshot> {
  requireSellerOpsSubmitter(command.actor);
  const now = cleanEpochMilliseconds(command.now ?? Date.now());
  const formalOrderId = cleanPricingIdentifier(input.formalOrderId);
  const buyerId = cleanPricingIdentifier(input.buyerCustomerId);
  const sellerId = cleanPricingIdentifier(input.sellerOrganizationId);
  const storeId = cleanPricingIdentifier(input.storeId);
  const buyerRateId = cleanPricingIdentifier(input.buyerRateVersionId);
  const sellerRateId = cleanPricingIdentifier(input.sellerRateVersionId);
  const feeId = cleanPricingIdentifier(input.serviceFeeRuleVersionId);
  const marketplace = await resolveMarketplace(database, input.marketplaceCode, {
    requireActive: true, requireAdapter: true,
  });
  if (marketplace.code !== input.marketplaceCode
    || marketplace.transaction_currency_code !== input.payment.currency_code
    || marketplace.currency_exponent !== input.payment.currency_exponent) {
    throw new PricingError('VALIDATION_ERROR', 400);
  }
  const payment = money(input.payment.amount_minor, input.payment.currency_code);
  const identifiers = normalizePlatformIdentifiers(marketplace.code, {
    orderIdentifier: input.platformOrderIdentifier,
    productIdentifier: input.platformProductIdentifier,
  });
  const orderDate = cleanOptionalDate(input.platformOrderDate);
  await requireSnapshotScope(database, {
    buyerId, sellerId, storeId, marketplaceCode: marketplace.code,
  });
  const [buyerRate, sellerRate, fee] = await Promise.all([
    requireBuyerRate(database, buyerRateId, payment.currency_code, now),
    requireSellerRate(database, sellerRateId, sellerId,
      payment.currency_code, now),
    requireFee(database, feeId, sellerId, marketplace.code,
      input.reviewType, now),
  ]);
  const buyerRateSnapshot = rateSnapshot(buyerRate, payment);
  const sellerRateSnapshot = rateSnapshot(sellerRate, payment);
  const buyerPrincipal = convertMoney(payment, buyerRateSnapshot);
  const sellerPrincipal = convertMoney(payment, sellerRateSnapshot);
  const response: FormalOrderMarketplaceMoneySnapshot = {
    formal_order_id: formalOrderId,
    buyer_customer_id: buyerId,
    seller_organization_id: sellerId,
    store_id: storeId,
    marketplace_code: marketplace.code,
    review_type: input.reviewType,
    platform_order_identifier: identifiers.platform_order_identifier,
    platform_product_identifier: identifiers.platform_product_identifier,
    platform_order_date: orderDate,
    payment,
    buyer_rate: buyerRateSnapshot,
    seller_rate: sellerRateSnapshot,
    service_fee: {
      fee_rule_version_id: fee.id,
      seller_organization_id: sellerId,
      marketplace_code: marketplace.code,
      review_type: input.reviewType,
      fee: money(String(fee.fee_amount_minor), 'CNY') as Money & {
        currency_code: 'CNY'; currency_exponent: 2;
      },
    },
    buyer_expected_principal: buyerPrincipal as Money & {
      currency_code: 'CNY'; currency_exponent: 2;
    },
    seller_expected_principal: sellerPrincipal as Money & {
      currency_code: 'CNY'; currency_exponent: 2;
    },
    created_at: now,
    replayed: false,
  };
  const requestHash = await hashCanonicalJson({
    action: 'LOCK_FORMAL_ORDER_MARKETPLACE_MONEY_SNAPSHOT',
    formal_order_id: formalOrderId,
    buyer_customer_id: buyerId,
    seller_organization_id: sellerId,
    store_id: storeId,
    marketplace_code: marketplace.code,
    review_type: input.reviewType,
    platform_order_identifier: response.platform_order_identifier,
    platform_product_identifier: response.platform_product_identifier,
    platform_order_date: orderDate,
    payment,
    buyer_rate_version_id: buyerRateId,
    seller_rate_version_id: sellerRateId,
    service_fee_rule_version_id: feeId,
  });
  const acquired = await acquireIdempotency<
    FormalOrderMarketplaceMoneySnapshot
  >(database, {
    actorType: 'STAFF', actorId: command.actor.staffId,
    action: 'LOCK_FORMAL_ORDER_MARKETPLACE_MONEY_SNAPSHOT',
    targetType: 'FORMAL_ORDER', targetId: formalOrderId,
    idempotencyKey: command.idempotencyKey, requestHash,
  }, { now });
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }
  try {
    const statements: SqlStatement[] = [
      database.prepare(`
        INSERT INTO formal_order_marketplace_money_snapshots (
          formal_order_id, buyer_customer_id, seller_organization_id,
          store_id, marketplace_code, review_type,
          platform_order_identifier, platform_product_identifier,
          platform_order_date, payment_amount_minor,
          payment_currency_code, payment_currency_exponent,
          buyer_rate_version_id, buyer_rate_version_no,
          buyer_rate_confirmed_at, buyer_rate_value, buyer_rate_scale,
          seller_rate_version_id, seller_rate_version_no,
          seller_rate_effective_from, seller_rate_confirmed_at,
          seller_rate_value, seller_rate_scale, source_currency_code,
          quote_currency_code, source_currency_exponent,
          quote_currency_exponent, rounding_rule,
          service_fee_rule_version_id, service_fee_rule_version_no,
          service_fee_effective_from, service_fee_confirmed_at,
          service_fee_amount_minor, service_fee_currency_code,
          buyer_expected_principal_amount_minor,
          seller_expected_principal_amount_minor, created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,
          ?,?,?,?,?,?,?,?,?)
      `).bind(
        formalOrderId, buyerId, sellerId, storeId, marketplace.code,
        input.reviewType, response.platform_order_identifier,
        response.platform_product_identifier, orderDate,
        Number(payment.amount_minor), payment.currency_code,
        payment.currency_exponent,
        buyerRate.id, buyerRate.version_no, buyerRate.confirmed_at,
        buyerRate.rate_value, buyerRate.rate_scale,
        sellerRate.id, sellerRate.version_no, sellerRate.effective_from,
        sellerRate.confirmed_at, sellerRate.rate_value, sellerRate.rate_scale,
        payment.currency_code, 'CNY', payment.currency_exponent, 2, 'HALF_UP',
        fee.id, fee.version_no, fee.effective_from, fee.confirmed_at,
        fee.fee_amount_minor, 'CNY', Number(buyerPrincipal.amount_minor),
        Number(sellerPrincipal.amount_minor), now,
      ),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(), aggregateType: 'FORMAL_ORDER',
        aggregateId: formalOrderId,
        eventType: 'FORMAL_ORDER_MARKETPLACE_MONEY_SNAPSHOT_LOCKED',
        actor: { type: 'STAFF', id: command.actor.staffId,
          roles: command.actor.roles },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        nextState: response, createdAt: now,
      }),
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: { formal_order_id: formalOrderId }, now,
      }),
      database.prepare(`
        INSERT INTO transaction_assertions (assertion_value)
        SELECT CASE WHEN
          EXISTS (SELECT 1 FROM formal_order_marketplace_money_snapshots
            WHERE formal_order_id=? AND marketplace_code=?
              AND payment_currency_code=?
              AND buyer_rate_version_id=? AND seller_rate_version_id=?
              AND service_fee_rule_version_id=?)
        THEN 1 ELSE 0 END
      `).bind(formalOrderId, marketplace.code, payment.currency_code,
        buyerRate.id, sellerRate.id, fee.id),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ];
    await database.batch(statements);
    return response;
  } catch (error) {
    const normalized = normalizePricingError(error);
    await markIdempotencyFailed(database, acquired.claim, normalized.code, now);
    throw normalized;
  }
}

async function requireSnapshotScope(
  database: SqlDatabase,
  input: { buyerId: string; sellerId: string; storeId: string;
    marketplaceCode: CanonicalMarketplaceCode },
): Promise<void> {
  const row = await database.prepare(`
    SELECT
      EXISTS (SELECT 1 FROM buyer_marketplace_assignments
        WHERE buyer_customer_id=? AND marketplace_code=?) AS buyer_ok,
      EXISTS (SELECT 1 FROM seller_store_marketplaces
        WHERE store_id=? AND seller_organization_id=?
          AND marketplace_code=?) AS store_ok
  `).bind(input.buyerId, input.marketplaceCode, input.storeId,
    input.sellerId, input.marketplaceCode)
    .first<{ buyer_ok: number; store_ok: number }>();
  if (!row || row.buyer_ok !== 1 || row.store_ok !== 1) {
    throw new PricingError('NOT_FOUND', 404);
  }
}

async function requireBuyerRate(
  database: SqlDatabase, id: string, currency: CurrencyCode, now: number,
): Promise<RateRow> {
  const row = await database.prepare(`
    SELECT id, version_no, source_currency_code, quote_currency_code,
      rate_value, rate_scale, rounding_rule, NULL AS effective_from,
      confirmed_at
    FROM buyer_daily_currency_rate_versions
    WHERE id=? AND status='CONFIRMED' AND source_currency_code=?
      AND quote_currency_code='CNY' AND confirmed_at<=?
  `).bind(id, currency, now).first<RateRow>();
  if (!row) throw new PricingError('PRICING_RULE_NOT_FOUND', 404);
  return numericRate(row);
}

async function requireSellerRate(
  database: SqlDatabase, id: string, sellerId: string,
  currency: CurrencyCode, now: number,
): Promise<RateRow> {
  const row = await database.prepare(`
    SELECT id, version_no, source_currency_code, quote_currency_code,
      rate_value, rate_scale, rounding_rule, effective_from, confirmed_at
    FROM seller_agreement_currency_rate_versions
    WHERE id=? AND seller_organization_id=? AND status='CONFIRMED'
      AND source_currency_code=? AND quote_currency_code='CNY'
      AND effective_from<=? AND confirmed_at<=?
  `).bind(id, sellerId, currency, now, now).first<RateRow>();
  if (!row) throw new PricingError('PRICING_RULE_NOT_FOUND', 404);
  return numericRate(row);
}

async function requireFee(
  database: SqlDatabase, id: string, sellerId: string,
  marketplaceCode: CanonicalMarketplaceCode,
  reviewType: PricingReviewType, now: number,
): Promise<FeeRow> {
  const row = await database.prepare(`
    SELECT id, version_no, fee_amount_minor, effective_from, confirmed_at
    FROM seller_service_fee_rule_versions
    WHERE id=? AND seller_organization_id=? AND marketplace_code=?
      AND review_type=? AND status='CONFIRMED'
      AND fee_currency_code='CNY' AND fee_currency_exponent=2
      AND effective_from<=? AND confirmed_at<=?
  `).bind(id, sellerId, marketplaceCode, reviewType, now, now)
    .first<FeeRow>();
  if (!row) throw new PricingError('PRICING_RULE_NOT_FOUND', 404);
  return { ...row, version_no: Number(row.version_no),
    fee_amount_minor: Number(row.fee_amount_minor),
    effective_from: Number(row.effective_from),
    confirmed_at: Number(row.confirmed_at) };
}

function numericRate(row: RateRow): RateRow {
  return { ...row, version_no: Number(row.version_no),
    rate_value: Number(row.rate_value), rate_scale: Number(row.rate_scale),
    effective_from: row.effective_from === null
      ? null : Number(row.effective_from),
    confirmed_at: Number(row.confirmed_at) };
}

function rateSnapshot(row: RateRow, payment: Money): CurrencyRateSnapshot {
  return {
    rate_version_id: row.id,
    source_currency_code: row.source_currency_code,
    quote_currency_code: row.quote_currency_code,
    source_currency_exponent: payment.currency_exponent,
    quote_currency_exponent: 2,
    rate_value: String(row.rate_value),
    rate_scale: String(row.rate_scale),
    rounding_rule: row.rounding_rule,
  };
}

function cleanOptionalDate(value: string | null): string | null {
  if (value === null) return null;
  try {
    return parseChinaBusinessDate(value);
  } catch {
    throw new PricingError('VALIDATION_ERROR', 400);
  }
}
