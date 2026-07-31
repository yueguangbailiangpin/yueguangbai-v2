import { describe, expect, it } from 'vitest';
import {
  formatFixedDecimal,
  parseFixedDecimal,
} from './fixed-decimal';

describe('fixed decimal', () => {
  it('parses currency text without floating-point arithmetic', () => {
    expect(parseFixedDecimal('￥1,234.50元', 2)).toBe(123_450);
    expect(parseFixedDecimal('-0.01', 2)).toBe(-1);
    expect(parseFixedDecimal('1e-2', 4)).toBe(100);
  });

  it('formats scaled integers', () => {
    expect(formatFixedDecimal(123_450, 2)).toBe('1234.50');
    expect(formatFixedDecimal(-1, 2)).toBe('-0.01');
    expect(formatFixedDecimal(25, 0)).toBe('25');
  });

  it('rejects precision loss and unsafe values', () => {
    expect(() => parseFixedDecimal('1.234', 2))
      .toThrow('decimal_precision_exceeded');
    expect(() => parseFixedDecimal('999999999999999999999', 2))
      .toThrow('decimal_out_of_range');
  });
});
