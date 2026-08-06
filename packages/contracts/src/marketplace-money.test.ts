import { describe, expect, it } from 'vitest';
import {
  assertMoney,
  currencyExponent,
  isCurrencyCode,
  isMoney,
} from './marketplace-money';

describe('marketplace money contracts', () => {
  it('freezes ISO currency exponents', () => {
    expect(currencyExponent('JPY')).toBe(0);
    expect(currencyExponent('KRW')).toBe(0);
    expect(currencyExponent('USD')).toBe(2);
    expect(currencyExponent('CNY')).toBe(2);
    expect(isCurrencyCode('RMB')).toBe(false);
  });

  it('accepts only integer minor-unit strings with matching exponent', () => {
    expect(isMoney({
      amount_minor: '12345', currency_code: 'USD', currency_exponent: 2,
    })).toBe(true);
    expect(isMoney({
      amount_minor: '123.45', currency_code: 'USD', currency_exponent: 2,
    })).toBe(false);
    expect(() => assertMoney({
      amount_minor: '100', currency_code: 'JPY', currency_exponent: 2,
    })).toThrow('invalid_money');
  });
});
