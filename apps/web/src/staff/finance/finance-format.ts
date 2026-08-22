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
 * The as-of timestamp for a by-date lookup: the last Beijing-time instant of
 * the requested business date, capped at now so today resolves to the
 * present moment.
 */
export function lookupAsOf(businessDate: string, now: number = Date.now()): number {
  const endOfDay = Date.parse(`${businessDate}T23:59:59.999+08:00`);
  if (!Number.isSafeInteger(endOfDay)) return now;
  return Math.min(endOfDay, now);
}

// The rule engine refuses to confirm a version whose effective time has
// already passed, so the submit form defaults to a few minutes ahead: submit,
// (confirm,) and the rule becomes effective almost immediately.
export function futureDateTime(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(Date.now() + 5 * 60 * 1000));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values['year']}-${values['month']}-${values['day']}T${values['hour']}:${values['minute']}`;
}

export function parseBeijingDateTime(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(value)) return Number.NaN;
  return Date.parse(`${value}:00+08:00`);
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
