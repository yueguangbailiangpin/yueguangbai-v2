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

export function formatShanghaiTimestamp(timestamp: number): string {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error('invalid_archive_calendar_time');
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(timestamp));
}
