import { describe, expect, it } from 'vitest';
import { formatCnyPerJpyE8, formatSignedJpyDifference, priceDifferenceDirection } from './format';

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

describe('Buyer exchange-rate display', () => {
  it.each([
    ['5500000', '1 JPY = ¥0.055 CNY'],
    ['12340000', '1 JPY = ¥0.1234 CNY'],
    ['100000000', '1 JPY = ¥1 CNY'],
  ] as const)('formats e8 integer %s without floating point', (value, expected) => {
    expect(formatCnyPerJpyE8(value)).toBe(expected);
  });
});
