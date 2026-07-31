import {
  CHINA_UTC_OFFSET_MS,
  assertEpochMilliseconds,
} from '../time/business-clock';

const BUSINESS_DATE_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})$/u;

export function parseChinaBusinessDate(raw: string): string {
  if (typeof raw !== 'string') throw new Error('invalid_business_date');
  const normalized = raw.normalize('NFKC').trim();
  const match = BUSINESS_DATE_PATTERN.exec(normalized);
  if (!match) throw new Error('invalid_business_date');

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day) {
    throw new Error('invalid_business_date');
  }
  return normalized;
}

export function chinaBusinessDateStartEpoch(
  businessDate: string,
): number {
  const normalized = parseChinaBusinessDate(businessDate);
  const [year, month, day] = normalized.split('-').map(Number);
  const value = Date.UTC(year!, month! - 1, day!)
    - CHINA_UTC_OFFSET_MS;
  assertEpochMilliseconds(value);
  return value;
}
