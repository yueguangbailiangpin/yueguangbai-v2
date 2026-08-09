import { describe, expect, it } from 'vitest';
import { formatCny, formatMinor } from './format';

describe('Staff exact-integer amount formatting', () => {
  it('formats positive, zero, and negative two-decimal minor units without signed fractions', () => {
    expect(formatMinor('12345', 'CNY', 2)).toBe('123.45 CNY');
    expect(formatMinor('0', 'CNY', 2)).toBe('0.00 CNY');
    expect(formatMinor('-5', 'CNY', 2)).toBe('-0.05 CNY');
    expect(formatMinor('-12345', 'CNY', 2)).toBe('-123.45 CNY');
  });

  it('keeps the sign before the CNY symbol', () => {
    expect(formatCny('12345')).toBe('¥123.45 CNY');
    expect(formatCny('-12345')).toBe('-¥123.45 CNY');
  });

  it('formats signed exponent-zero currencies exactly', () => {
    expect(formatMinor('-1234', 'JPY', 0)).toBe('-1,234 JPY');
  });
});
