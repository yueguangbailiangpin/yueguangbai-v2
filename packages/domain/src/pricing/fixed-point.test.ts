import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  convertJpyToCnyFen,
  fixedIntegerString,
  formatCnyPerJpyDecimal,
  parseCnyFen,
  parseCnyPerJpyDecimal,
  parseCnyPerJpyE8,
  parseCnyPerJpyMarkupDecimal,
  parseJpyInteger,
  toD1SafeInteger,
} from './fixed-point';

describe('pricing fixed-point arithmetic', () => {
  it('parses the display direction 1 JPY = X CNY into e8', () => {
    expect(parseCnyPerJpyDecimal('0.05000000')).toBe(5_000_000n);
    expect(parseCnyPerJpyDecimal(' ０.０５ ')).toBe(5_000_000n);
    expect(formatCnyPerJpyDecimal(5_000_000n)).toBe('0.05');
    expect(formatCnyPerJpyDecimal(100_000_000n)).toBe('1');
  });

  it('parses a decimal absolute markup including explicit zero and plus sign', () => {
    expect(parseCnyPerJpyMarkupDecimal('0.004')).toBe(400_000n);
    expect(parseCnyPerJpyMarkupDecimal('0')).toBe(0n);
    expect(parseCnyPerJpyMarkupDecimal('+0.004')).toBe(400_000n);
    expect(parseCnyPerJpyMarkupDecimal(' ＋０.００４ ')).toBe(400_000n);
    expect(() => parseCnyPerJpyMarkupDecimal('-0.004'))
      .toThrow('invalid_rate_decimal');
    expect(() => parseCnyPerJpyMarkupDecimal('0.000000001'))
      .toThrow('invalid_rate_decimal');
  });

  it('converts JPY to CNY fen with non-floating half-up rounding', () => {
    const rate = parseCnyPerJpyE8('5000000');
    expect(convertJpyToCnyFen(1n, rate)).toBe(5n);
    expect(convertJpyToCnyFen(101n, rate)).toBe(505n);

    expect(convertJpyToCnyFen(1n, 4_999n)).toBe(0n);
    expect(convertJpyToCnyFen(1n, 500_000n)).toBe(1n);
    expect(convertJpyToCnyFen(3n, 500_000n)).toBe(2n);
  });

  it('keeps integer facts as BigInt until the explicit D1 boundary', () => {
    const fee = parseCnyFen('9007199254740991');
    expect(toD1SafeInteger(fee)).toBe(Number.MAX_SAFE_INTEGER);
    expect(fixedIntegerString(fee)).toBe('9007199254740991');
    expect(parseJpyInteger('999999999999999999999')).toBe(
      999_999_999_999_999_999_999n,
    );
  });

  it('rejects precision loss, signs, fractions in integer fields, and overflow', () => {
    expect(() => parseCnyPerJpyDecimal('0.050000001'))
      .toThrow('invalid_rate_decimal');
    expect(() => parseCnyPerJpyDecimal('0')).toThrow('rate_out_of_range');
    expect(() => parseCnyPerJpyE8('9007199254740992'))
      .toThrow('integer_out_of_range');
    expect(() => parseCnyFen('-1')).toThrow('invalid_integer');
    expect(() => parseJpyInteger('1.5')).toThrow('invalid_integer');
    expect(() => toD1SafeInteger(9_007_199_254_740_992n))
      .toThrow('d1_integer_out_of_range');
  });
});
