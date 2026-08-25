const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

export function addShanghaiCalendarMonths(timestamp: number, months: number): number {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0
    || !Number.isSafeInteger(months) || months < 0 || months > 1200) {
    throw new Error('invalid_archive_calendar_time');
  }
  const local = new Date(timestamp + SHANGHAI_OFFSET_MS);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  const targetMonthIndex = month + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = targetMonthIndex % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const day = Math.min(local.getUTCDate(), lastDay);
  const result = Date.UTC(
    targetYear,
    targetMonth,
    day,
    local.getUTCHours(),
    local.getUTCMinutes(),
    local.getUTCSeconds(),
    local.getUTCMilliseconds(),
  ) - SHANGHAI_OFFSET_MS;
  if (!Number.isSafeInteger(result) || result < 0) throw new Error('invalid_archive_calendar_time');
  return result;
}

export function archiveDueAt(businessClosedAt: number): number {
  return addShanghaiCalendarMonths(businessClosedAt, 6);
}

/**
 * Bundle eligibility gate (stage 5): business fully closed for six UTC
 * calendar months. Calendar-month arithmetic on the closure timestamp, never
 * a flat 180-day offset — month lengths differ (28–31 days) and the
 * owner-facing requirement is natural months, not days.
 */
export function bundleEligibilityAt(businessClosedAt: number): number {
  if (!Number.isSafeInteger(businessClosedAt) || businessClosedAt < 0) {
    throw new Error('invalid_archive_calendar_time');
  }
  const utc = new Date(businessClosedAt);
  const year = utc.getUTCFullYear();
  const month = utc.getUTCMonth();
  const targetMonthIndex = month + 6;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = targetMonthIndex % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const day = Math.min(utc.getUTCDate(), lastDay);
  const result = Date.UTC(
    targetYear,
    targetMonth,
    day,
    utc.getUTCHours(),
    utc.getUTCMinutes(),
    utc.getUTCSeconds(),
    utc.getUTCMilliseconds(),
  );
  if (!Number.isSafeInteger(result) || result < 0) throw new Error('invalid_archive_calendar_time');
  return result;
}

export function formatShanghaiTimestamp(timestamp: number): string {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error('invalid_archive_calendar_time');
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(timestamp));
}
