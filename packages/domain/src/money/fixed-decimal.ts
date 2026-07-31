/**
 * Convert a decimal string to a safe scaled integer without using binary
 * floating-point arithmetic.
 */
export function parseFixedDecimal(raw: string, scale: number): number {
  assertScale(scale);
  const cleaned = raw.replace(/[,，\s¥￥$元]/gu, '');
  const normalized = expandScientificDecimal(cleaned);
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/u.exec(normalized);
  if (!match) throw new Error('invalid_decimal');

  const sign = match[1] === '-' ? -1n : 1n;
  const integerPart = match[2] ?? '0';
  const fraction = match[3] ?? '';
  const discarded = fraction.slice(scale);
  if (discarded && /[1-9]/u.test(discarded)) {
    throw new Error('decimal_precision_exceeded');
  }

  const scaledFraction = fraction.slice(0, scale).padEnd(scale, '0');
  const digits = `${integerPart}${scaledFraction}`.replace(/^0+(?=\d)/u, '');
  const value = sign * BigInt(digits || '0');
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error('decimal_out_of_range');
  return result;
}

export function formatFixedDecimal(value: number, scale: number): string {
  assertScale(scale);
  if (!Number.isSafeInteger(value)) throw new Error('decimal_out_of_range');

  const sign = value < 0 ? '-' : '';
  const absolute = BigInt(value < 0 ? -value : value);
  if (scale === 0) return `${sign}${absolute}`;

  const digits = absolute.toString().padStart(scale + 1, '0');
  const splitAt = digits.length - scale;
  return `${sign}${digits.slice(0, splitAt)}.${digits.slice(splitAt)}`;
}

function assertScale(scale: number): void {
  if (!Number.isInteger(scale) || scale < 0 || scale > 9) {
    throw new Error('invalid_scale');
  }
}

function expandScientificDecimal(raw: string): string {
  const match = /^([+-]?)(\d+)(?:\.(\d*))?[eE]([+-]?\d+)$/u.exec(raw);
  if (!match) return raw;

  const sign = match[1] ?? '';
  const integer = match[2] ?? '0';
  const fraction = match[3] ?? '';
  const exponent = Number(match[4]);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100) {
    throw new Error('invalid_decimal');
  }

  const digits = `${integer}${fraction}`;
  const point = integer.length + exponent;
  if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`;
  if (point >= digits.length) {
    return `${sign}${digits}${'0'.repeat(point - digits.length)}`;
  }
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}
