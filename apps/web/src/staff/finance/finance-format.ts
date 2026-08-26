/** Formatting and Beijing-time helpers shared by the finance workspace cards. */

export function chinaDate(at: number = Date.now()): string {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  return `${values['year']}-${values['month']}-${values['day']}`;
}

/**
 * Shift a yyyy-mm-dd Beijing business date by whole days (e.g. yesterday /
 * tomorrow), staying on the Beijing calendar even across month boundaries.
 * The result is formatted in Asia/Shanghai — toISOString() would slice the
 * UTC date, which is still the previous Beijing day before 08:00Z.
 */
export function shiftChinaDate(businessDate: string, days: number): string {
  const shifted = Date.parse(`${businessDate}T00:00:00+08:00`) + days * 86_400_000;
  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(shifted)
      .map((part) => [part.type, part.value]),
  );
  return `${values['year']}-${values['month']}-${values['day']}`;
}

/**
 * The as-of timestamp for a by-date lookup: the last Beijing-time instant of
 * the requested business date, capped at now so today resolves to the
 * present moment.
 */
export function lookupAsOf(businessDate: string, now: number = Date.now()): number {
  const endOfDay = Date.parse(`${businessDate}T23:59:59.999+08:00`);
  if (!Number.isSafeInteger(endOfDay)) return now;
  return Math.min(endOfDay, now);
}

export function markupLabel(value: string): string {
  const raw = BigInt(value);
  const integer = raw / 100_000_000n;
  const fraction = (raw % 100_000_000n).toString().padStart(8, '0').replace(/0+$/u, '');
  return `+${integer}.${fraction || '0'}`;
}

export function rateLabel(value: string): string {
  const raw = BigInt(value);
  const integer = raw / 100_000_000n;
  const fraction = (raw % 100_000_000n).toString().padStart(8, '0').replace(/0+$/u, '');
  return `${integer}.${fraction || '0'} CNY / JPY`;
}

export function fenToYuan(value: string): string {
  const fen = Number(value);
  return `¥${(fen / 100).toFixed(2)}`;
}

export function yuanToFen(value: string): string | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/u.exec(value.trim());
  if (!match) return null;
  const fraction = (match[2] ?? '').padEnd(2, '0');
  return String(Number(match[1]) * 100 + Number(fraction));
}
