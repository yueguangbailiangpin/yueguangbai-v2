import { describe, expect, it } from 'vitest';
import type { CurrencyRateSnapshot } from '@ygb/contracts';
import { convertMoney, formatMoney, money } from './currency';

function rate(
  source: 'JPY' | 'USD' | 'KRW',
  value: string,
): CurrencyRateSnapshot {
  return {
    rate_version_id: `rate-${source}`,
    source_currency_code: source,
    quote_currency_code: 'CNY',
    source_currency_exponent: source === 'USD' ? 2 : 0,
    quote_currency_exponent: 2,
    rate_value: value,
    rate_scale: '100000000',
    rounding_rule: 'HALF_UP',
  };
}

describe('multi-currency integer calculations', () => {
  it('preserves the JP e8 conversion exactly', () => {
    expect(convertMoney(money('1000', 'JPY'), rate('JPY', '4800000')))
      .toEqual(money('4800', 'CNY'));
  });

  it('converts USD cents to CNY fen without floating point', () => {
    expect(convertMoney(money('12345', 'USD'), rate('USD', '720000000')))
      .toEqual(money('88884', 'CNY'));
  });

  it('uses half-up rounding at the integer boundary', () => {
    expect(convertMoney(money('1', 'KRW'), rate('KRW', '350000')))
      .toEqual(money('0', 'CNY'));
    expect(convertMoney(money('1', 'KRW'), rate('KRW', '500000')))
      .toEqual(money('1', 'CNY'));
  });

  it('formats minor units with the frozen ISO exponent', () => {
    expect(formatMoney(money('12345', 'USD'))).toBe('123.45');
    expect(formatMoney(money('12345', 'JPY'))).toBe('12345');
  });

  it('rejects currency/rate mismatches and unsafe D1 amounts', () => {
    expect(() => convertMoney(money('1', 'JPY'), rate('USD', '1')))
      .toThrow('rate_source_mismatch');
    expect(() => money('9007199254740992', 'CNY'))
      .toThrow('money_out_of_range');
  });
});
