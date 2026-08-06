import { describe, expect, it } from 'vitest';
import { formatSignedJpyDifference, priceDifferenceDirection } from './format';

describe('signed Buyer price mismatch display', () => {
  it.each([
    [512, '+¥512 JPY', '实际支付高于参考金额'],
    [-512, '-¥512 JPY', '实际支付低于参考金额'],
    [0, '¥0 JPY', '实际支付与参考金额一致'],
  ] as const)('preserves direction for %i', (value, amount, direction) => {
    expect(formatSignedJpyDifference(value)).toBe(amount);
    expect(priceDifferenceDirection(value)).toBe(direction);
  });
});
