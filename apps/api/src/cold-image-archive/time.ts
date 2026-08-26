/**
 * Stage 6.5 unified retention-time semantics (one owner decision, 2026-08-26):
 *
 * - Storage is UTC milliseconds everywhere.
 * - Hot retention / archive eligibility is SIX UTC CALENDAR MONTHS from the
 *   full business closure timestamp — never a flat 180-day offset and never
 *   Asia/Shanghai local-month arithmetic. Month-end clamps to the target
 *   month's last day (Jan 31 + 6 mo = Jul 31; Aug 31 + 6 mo = Feb 28/29).
 * - Staff-facing display MAY render Asia/Shanghai, but display never changes
 *   the stored eligibility_at value.
 */

function addUtcCalendarMonths(timestamp: number, months: number): number {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0
    || !Number.isSafeInteger(months) || months < 0 || months > 1200) {
    throw new Error('invalid_archive_calendar_time');
  }
  const utc = new Date(timestamp);
  const year = utc.getUTCFullYear();
  const month = utc.getUTCMonth();
  const targetMonthIndex = month + months;
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

/**
 * Six UTC calendar months after full business closure. Stage 5 computed the
 * closure DTO's archive_due_at with Asia/Shanghai local months while bundle
 * eligibility used UTC months; stage 6.5 unified both onto this single UTC
 * rule (difference was at most an 8-hour boundary shift).
 */
export function archiveDueAt(businessClosedAt: number): number {
  return addUtcCalendarMonths(businessClosedAt, 6);
}

/**
 * Bundle eligibility gate: business fully closed for six UTC calendar
 * months. Calendar-month arithmetic on the closure timestamp, never a flat
 * 180-day offset — month lengths differ (28–31 days) and the owner-facing
 * requirement is natural months, not days. Identical to archiveDueAt since
 * the stage 6.5 unification (kept as its own name for call-site clarity).
 */
export function bundleEligibilityAt(businessClosedAt: number): number {
  return addUtcCalendarMonths(businessClosedAt, 6);
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
