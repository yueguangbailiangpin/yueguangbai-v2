import {
  MAX_D1_SAFE_INTEGER,
  toD1SafeInteger,
} from '../pricing/fixed-point';

export const BUYER_SELF_PAY_BPS_SCALE = 10_000n;
export const MAX_BUYER_SELF_PAY_BPS = 10_000;

export function validateBuyerSelfPayBps(value: number): number {
  if (!Number.isSafeInteger(value)
    || value < 0
    || value > MAX_BUYER_SELF_PAY_BPS) {
    throw new Error('invalid_buyer_self_pay_bps');
  }
  return value;
}

export function calculateBuyerSelfPayJpy(
  paidJpy: bigint,
  buyerSelfPayBps: number,
): bigint {
  validateBuyerSelfPayBps(buyerSelfPayBps);
  if (paidJpy < 0n || paidJpy > MAX_D1_SAFE_INTEGER) {
    throw new Error('invalid_jpy_amount');
  }
  const numerator = paidJpy * BigInt(buyerSelfPayBps);
  const quotient = numerator / BUYER_SELF_PAY_BPS_SCALE;
  const remainder = numerator % BUYER_SELF_PAY_BPS_SCALE;
  return remainder * 2n >= BUYER_SELF_PAY_BPS_SCALE
    ? quotient + 1n
    : quotient;
}

export function calculateBuyerSelfPayFacts(
  paidJpy: bigint,
  buyerSelfPayBps: number,
): {
  buyerSelfPayJpy: bigint;
  refundablePrincipalJpy: bigint;
} {
  const buyerSelfPayJpy = calculateBuyerSelfPayJpy(
    paidJpy,
    buyerSelfPayBps,
  );
  const refundablePrincipalJpy = paidJpy - buyerSelfPayJpy;
  if (refundablePrincipalJpy < 0n) {
    throw new Error('invalid_refundable_principal');
  }
  return { buyerSelfPayJpy, refundablePrincipalJpy };
}

export function toBuyerSelfPayD1Facts(
  paidJpy: bigint,
  buyerSelfPayBps: number,
): {
  buyerSelfPayJpy: number;
  refundablePrincipalJpy: number;
} {
  const facts = calculateBuyerSelfPayFacts(
    paidJpy,
    buyerSelfPayBps,
  );
  return {
    buyerSelfPayJpy: toD1SafeInteger(facts.buyerSelfPayJpy),
    refundablePrincipalJpy:
      toD1SafeInteger(facts.refundablePrincipalJpy),
  };
}
