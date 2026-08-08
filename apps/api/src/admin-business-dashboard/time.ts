import type {
  DashboardGranularity,
  DashboardWindow,
  DashboardWindowDto,
} from '@ygb/contracts';
import {
  chinaBusinessDate,
  chinaBusinessDateStartEpoch,
  parseChinaBusinessDate,
} from '@ygb/domain';

const DAY_MS = 86_400_000;
export const DASHBOARD_MAX_RANGE_DAYS = 366;

export function dashboardWindow(
  key: DashboardWindow,
  now = Date.now(),
): DashboardWindowDto {
  const today = chinaBusinessDate(now);
  let fromDate = today;
  if (key === 'WEEK') {
    const localMidnight = chinaBusinessDateStartEpoch(today) + 8 * 60 * 60 * 1000;
    const mondayOffset = (new Date(localMidnight).getUTCDay() + 6) % 7;
    fromDate = addDays(today, -mondayOffset);
  } else if (key === 'MONTH') {
    fromDate = `${today.slice(0, 7)}-01`;
  }
  return Object.freeze({
    key,
    from_date: fromDate,
    to_date: today,
    timezone: 'Asia/Shanghai',
    data_as_of: now,
  });
}

export function dashboardDateRange(
  fromDate: string,
  toDate: string,
): { fromDate: string; toDate: string; fromEpoch: number; toExclusiveEpoch: number } {
  const from = parseChinaBusinessDate(fromDate);
  const to = parseChinaBusinessDate(toDate);
  const fromEpoch = chinaBusinessDateStartEpoch(from);
  const toEpoch = chinaBusinessDateStartEpoch(to);
  if (fromEpoch > toEpoch || (toEpoch - fromEpoch) / DAY_MS >= DASHBOARD_MAX_RANGE_DAYS) {
    throw new Error('invalid_dashboard_date_range');
  }
  return { fromDate: from, toDate: to, fromEpoch, toExclusiveEpoch: toEpoch + DAY_MS };
}

export function dashboardBuckets(
  fromDate: string,
  toDate: string,
  granularity: DashboardGranularity,
): readonly { from_date: string; to_date: string }[] {
  const range = dashboardDateRange(fromDate, toDate);
  const buckets: { from_date: string; to_date: string }[] = [];
  let cursor = range.fromDate;
  while (cursor <= range.toDate) {
    const end = minimum(bucketEnd(cursor, granularity), range.toDate);
    buckets.push({ from_date: cursor, to_date: end });
    cursor = addDays(end, 1);
  }
  return Object.freeze(buckets);
}

function bucketEnd(date: string, granularity: DashboardGranularity): string {
  if (granularity === 'DAY') return date;
  if (granularity === 'WEEK') {
    const localMidnight = chinaBusinessDateStartEpoch(date) + 8 * 60 * 60 * 1000;
    const weekday = new Date(localMidnight).getUTCDay();
    return addDays(date, (7 - weekday) % 7);
  }
  const [year, month] = date.split('-').map(Number) as [number, number, number];
  return chinaBusinessDate(Date.UTC(year, month, 1) - 8 * 60 * 60 * 1000 - 1);
}

function addDays(date: string, days: number): string {
  return chinaBusinessDate(chinaBusinessDateStartEpoch(date) + days * DAY_MS);
}

function minimum(left: string, right: string): string {
  return left < right ? left : right;
}
