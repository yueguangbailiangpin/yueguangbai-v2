import {
  currencyExponent,
  type CurrencyCode,
  type CurrencyRateSnapshot,
  type Money,
} from '@ygb/contracts';
import { MAX_D1_SAFE_INTEGER } from '../pricing/fixed-point';

const INTEGER = /^(?:0|[1-9]\d*)$/u;

export function money(
  amountMinor: string | bigint,
  currencyCode: CurrencyCode,
): Money {
  const raw = typeof amountMinor === 'bigint'
    ? amountMinor.toString(10)
    : amountMinor;
  if (!INTEGER.test(raw)) throw new Error('invalid_money_amount');
  const amount = BigInt(raw);
  if (amount > MAX_D1_SAFE_INTEGER) throw new Error('money_out_of_range');
  return {
    amount_minor: raw,
    currency_code: currencyCode,
    currency_exponent: currencyExponent(currencyCode),
  };
}

export function convertMoney(
  source: Money,
  rate: CurrencyRateSnapshot,
): Money {
  if (source.currency_code !== rate.source_currency_code
    || source.currency_exponent !== rate.source_currency_exponent) {
    throw new Error('rate_source_mismatch');
  }
  if (rate.rounding_rule !== 'HALF_UP') {
    throw new Error('unsupported_rounding');
  }

  const amount = parsePositiveOrZero(source.amount_minor, 'invalid_money_amount');
  const rateValue = parsePositive(rate.rate_value, 'invalid_rate');
  const rateScale = parsePositive(rate.rate_scale, 'invalid_rate_scale');
  const numerator = amount * rateValue * pow10(rate.quote_currency_exponent);
  const denominator = rateScale * pow10(rate.source_currency_exponent);
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;
  return money(rounded, rate.quote_currency_code);
}

export function formatMoney(value: Money): string {
  const amount = parsePositiveOrZero(value.amount_minor, 'invalid_money_amount');
  const exponent = currencyExponent(value.currency_code);
  if (value.currency_exponent !== exponent) throw new Error('currency_exponent_mismatch');
  if (exponent === 0) return amount.toString(10);
  const digits = amount.toString(10).padStart(exponent + 1, '0');
  return `${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
}

function parsePositive(raw: string, error: string): bigint {
  const value = parsePositiveOrZero(raw, error);
  if (value === 0n) throw new Error(error);
  return value;
}

function parsePositiveOrZero(raw: string, error: string): bigint {
  if (!INTEGER.test(raw)) throw new Error(error);
  return BigInt(raw);
}

function pow10(exponent: number): bigint {
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > 9) {
    throw new Error('invalid_currency_exponent');
  }
  return 10n ** BigInt(exponent);
}
