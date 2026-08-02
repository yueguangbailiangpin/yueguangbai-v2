import type { BuyerSelfPaySource, SqlDatabase } from '@ygb/contracts';
import { calculateBuyerSelfPayFacts, parseJpyInteger, toD1SafeInteger } from '@ygb/domain';
import { OrderInstructionError } from './shared';

export interface DemandSelfPayPublishFacts {
  buyerSelfPayBps: number;
  source: BuyerSelfPaySource;
  overrideReason: string | null;
}

export async function resolveDemandSelfPayForPublish(
  database: SqlDatabase,
  input: {
    productId: string;
    productVersionNo: number;
    overrideBps?: number | null;
    overrideReason?: string | null;
  },
): Promise<DemandSelfPayPublishFacts> {
  const row = await database.prepare(`
    SELECT default_buyer_self_pay_bps
    FROM product_versions
    WHERE product_id=? AND version_no=?
  `).bind(input.productId, input.productVersionNo).first<{
    default_buyer_self_pay_bps: number;
  }>();
  if (!row) throw new OrderInstructionError('ORDERING_PROFILE_REQUIRED', 409);
  const defaultBps = validateBuyerSelfPayBps(row.default_buyer_self_pay_bps);
  if (input.overrideBps == null) {
    if (normalizeReason(input.overrideReason) !== null) {
      throw new OrderInstructionError('VALIDATION_ERROR', 400);
    }
    return {
      buyerSelfPayBps: defaultBps,
      source: 'PRODUCT_DEFAULT',
      overrideReason: null,
    };
  }
  const overrideBps = validateBuyerSelfPayBps(input.overrideBps);
  const reason = normalizeReason(input.overrideReason);
  if (reason === null) throw new OrderInstructionError('VALIDATION_ERROR', 400);
  return {
    buyerSelfPayBps: overrideBps,
    source: 'STAFF_OVERRIDE',
    overrideReason: reason,
  };
}

export function validateBuyerSelfPayBps(value: unknown): number {
  if (typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value < 0
    || value > 10_000) {
    throw new OrderInstructionError('VALIDATION_ERROR', 400);
  }
  return value;
}

export function estimateBuyerSelfPay(
  referenceOrderAmountJpy: number,
  buyerSelfPayBps: number,
): {
  estimatedBuyerSelfPayJpy: number;
  estimatedRefundablePrincipalJpy: number;
} {
  const facts = calculateBuyerSelfPayFacts(
    parseJpyInteger(String(referenceOrderAmountJpy)),
    validateBuyerSelfPayBps(buyerSelfPayBps),
  );
  return {
    estimatedBuyerSelfPayJpy: toD1SafeInteger(facts.buyerSelfPayJpy),
    estimatedRefundablePrincipalJpy:
      toD1SafeInteger(facts.refundablePrincipalJpy),
  };
}

function normalizeReason(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length === 0) return null;
  if (normalized.length > 1000 || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new OrderInstructionError('VALIDATION_ERROR', 400);
  }
  return normalized;
}
