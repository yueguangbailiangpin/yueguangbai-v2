const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

export function parseGregorianDateOnly(value: string): string {
  if (typeof value !== 'string') throw new Error('invalid_date_only');
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) throw new Error('invalid_date_only');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day) {
    throw new Error('invalid_date_only');
  }
  return value;
}
