export const CNY_PER_JPY_SCALE = 100_000_000n;
export const CNY_FEN_PER_YUAN = 100n;
export const JPY_TO_CNY_FEN_DIVISOR =
  CNY_PER_JPY_SCALE / CNY_FEN_PER_YUAN;
export const MAX_D1_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);

export type FixedPointRounding = 'HALF_UP';

export function parseUnsignedInteger(
  raw: string,
  options: {
    allowZero?: boolean;
    maximum?: bigint;
  } = {},
): bigint {
  if (typeof raw !== 'string') throw new Error('invalid_integer');
  const normalized = raw.normalize('NFKC').trim();
  if (!/^(?:0|[1-9]\d*)$/u.test(normalized)) {
    throw new Error('invalid_integer');
  }

  const value = BigInt(normalized);
  if (!options.allowZero && value === 0n) {
    throw new Error('integer_must_be_positive');
  }
  if (options.maximum !== undefined && value > options.maximum) {
    throw new Error('integer_out_of_range');
  }
  return value;
}

export function parseCnyPerJpyE8(raw: string): bigint {
  return parseUnsignedInteger(raw, {
    maximum: MAX_D1_SAFE_INTEGER,
  });
}

/** Parse an absolute seller-principal rate increment; zero is meaningful. */
export function parseCnyPerJpyMarkupE8(raw: string): bigint {
  return parseUnsignedInteger(raw, {
    allowZero: true,
    maximum: MAX_D1_SAFE_INTEGER,
  });
}

export function addCnyPerJpyE8(
  baseRateE8: bigint,
  markupRateE8: bigint,
): bigint {
  if (baseRateE8 <= 0n || markupRateE8 < 0n) {
    throw new Error('invalid_rate_increment');
  }
  const finalRate = baseRateE8 + markupRateE8;
  if (finalRate > MAX_D1_SAFE_INTEGER) {
    throw new Error('rate_out_of_range');
  }
  return finalRate;
}

/** Parse the display direction `1 JPY = X CNY` into e8 fixed point. */
export function parseCnyPerJpyDecimal(raw: string): bigint {
  if (typeof raw !== 'string') throw new Error('invalid_rate_decimal');
  const normalized = raw.normalize('NFKC').trim();
  const match = /^(?:0|[1-9]\d*)(?:\.(\d{1,8}))?$/u.exec(normalized);
  if (!match) throw new Error('invalid_rate_decimal');

  const [integerPart = '0'] = normalized.split('.');
  const fraction = (match[1] ?? '').padEnd(8, '0');
  const value = BigInt(`${integerPart}${fraction}`);
  if (value <= 0n || value > MAX_D1_SAFE_INTEGER) {
    throw new Error('rate_out_of_range');
  }
  return value;
}

export function formatCnyPerJpyDecimal(cnyPerJpyE8: bigint): string {
  if (cnyPerJpyE8 <= 0n || cnyPerJpyE8 > MAX_D1_SAFE_INTEGER) {
    throw new Error('rate_out_of_range');
  }
  const digits = cnyPerJpyE8.toString(10).padStart(9, '0');
  const integerPart = digits.slice(0, -8);
  const fraction = digits.slice(-8).replace(/0+$/u, '');
  return fraction.length > 0
    ? `${integerPart}.${fraction}`
    : integerPart;
}

export function parseCnyFen(raw: string): bigint {
  return parseUnsignedInteger(raw, {
    allowZero: true,
    maximum: MAX_D1_SAFE_INTEGER,
  });
}

export function parseJpyInteger(raw: string): bigint {
  return parseUnsignedInteger(raw, {
    allowZero: true,
  });
}

/**
 * Converts integer JPY to integer CNY fen using:
 *
 *   fen = round_half_up(jpy * cny_per_jpy_e8 / 1_000_000)
 *
 * Both inputs must be non-negative. No binary floating-point arithmetic is
 * used at any point.
 */
export function convertJpyToCnyFen(
  jpy: bigint,
  cnyPerJpyE8: bigint,
  rounding: FixedPointRounding = 'HALF_UP',
): bigint {
  if (jpy < 0n || cnyPerJpyE8 <= 0n) {
    throw new Error('invalid_money_input');
  }
  if (rounding !== 'HALF_UP') {
    throw new Error('unsupported_rounding');
  }

  const numerator = jpy * cnyPerJpyE8;
  const quotient = numerator / JPY_TO_CNY_FEN_DIVISOR;
  const remainder = numerator % JPY_TO_CNY_FEN_DIVISOR;
  return remainder * 2n >= JPY_TO_CNY_FEN_DIVISOR
    ? quotient + 1n
    : quotient;
}

export function toD1SafeInteger(value: bigint): number {
  if (value < 0n || value > MAX_D1_SAFE_INTEGER) {
    throw new Error('d1_integer_out_of_range');
  }
  return Number(value);
}

export function fixedIntegerString(value: bigint): string {
  return value.toString(10);
}
