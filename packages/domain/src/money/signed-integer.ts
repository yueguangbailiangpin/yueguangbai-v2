export function parseSignedIntegerString(raw: string): bigint {
  if (typeof raw !== 'string') throw new Error('invalid_signed_integer');
  const normalized = raw.normalize('NFKC').trim();
  if (!/^(?:0|-?[1-9]\d*)$/u.test(normalized)) {
    throw new Error('invalid_signed_integer');
  }
  return BigInt(normalized);
}

export function signedIntegerString(value: bigint): string {
  return value.toString(10);
}

export function databaseIntegerToBigInt(value: number | string | bigint): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('unsafe_database_integer');
    return BigInt(value);
  }
  return parseSignedIntegerString(value);
}

export function formatFenAsCny(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  const digits = absolute.toString(10).padStart(3, '0');
  return `${sign}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}
