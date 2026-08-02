import { describe, expect, it } from 'vitest';
import {
  calculateBuyerSelfPayFacts,
  calculateBuyerSelfPayJpy,
  toBuyerSelfPayD1Facts,
  validateBuyerSelfPayBps,
} from './self-pay';

describe('buyer self-pay fixed-point facts', () => {
  it('accepts the default zero bps', () => {
    expect(validateBuyerSelfPayBps(0)).toBe(0);
  });

  it('accepts 10 percent as 1000 bps', () => {
    expect(validateBuyerSelfPayBps(1000)).toBe(1000);
  });

  it('accepts the maximum supported 10000 bps', () => {
    expect(validateBuyerSelfPayBps(10_000)).toBe(10_000);
  });

  it.each([-1, 10_001, 0.1, Number.NaN])(
    'rejects invalid bps %s',
    (value) => expect(() => validateBuyerSelfPayBps(value)).toThrow(),
  );

  it('keeps the full principal for zero bps', () => {
    expect(calculateBuyerSelfPayFacts(10_000n, 0)).toEqual({
      buyerSelfPayJpy: 0n,
      refundablePrincipalJpy: 10_000n,
    });
  });

  it('calculates 10 percent estimates', () => {
    expect(calculateBuyerSelfPayFacts(10_000n, 1000)).toEqual({
      buyerSelfPayJpy: 1_000n,
      refundablePrincipalJpy: 9_000n,
    });
  });

  it('uses HALF_UP for 9,999 at 10 percent', () => {
    expect(calculateBuyerSelfPayJpy(9_999n, 1000)).toBe(1_000n);
  });

  it('allows 100 percent with zero refundable principal', () => {
    expect(calculateBuyerSelfPayFacts(9_999n, 10_000)).toEqual({
      buyerSelfPayJpy: 9_999n,
      refundablePrincipalJpy: 0n,
    });
  });

  it('rounds down below the half threshold', () => {
    expect(calculateBuyerSelfPayJpy(4n, 1000)).toBe(0n);
  });

  it('rounds up at the exact half threshold', () => {
    expect(calculateBuyerSelfPayJpy(5n, 1000)).toBe(1n);
  });

  it('returns only D1-safe integers', () => {
    expect(toBuyerSelfPayD1Facts(9_999n, 1000)).toEqual({
      buyerSelfPayJpy: 1_000,
      refundablePrincipalJpy: 8_999,
    });
  });
});
