import { CHINA_UTC_OFFSET_MS } from './business-clock';

/**
 * 承诺期限推算（P13-A）：从起始时刻的次一自然日开始，推进 N 个工作日
 * （周一至周五，法定节假日不扣除——将来不准再升级节假日日历），
 * 返回第 N 个工作日的同一时刻。中国时区固定 UTC+8、无夏令时，
 * 逐日加 86400000 毫秒不会跨日漂移。
 */
export function addChinaBusinessDays(
  startEpochMilliseconds: number,
  businessDays: number,
): number {
  if (!Number.isSafeInteger(startEpochMilliseconds) || startEpochMilliseconds < 0) {
    throw new Error('invalid_epoch_milliseconds');
  }
  if (!Number.isSafeInteger(businessDays) || businessDays < 1 || businessDays > 365) {
    throw new Error('invalid_business_days');
  }
  let cursor = startEpochMilliseconds;
  let remaining = businessDays;
  while (remaining > 0) {
    cursor += 86_400_000;
    const dayOfWeek = new Date(cursor + CHINA_UTC_OFFSET_MS).getUTCDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) remaining -= 1;
  }
  return cursor;
}
