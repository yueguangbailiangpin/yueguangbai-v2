import { CHINA_UTC_OFFSET_MS, assertEpochMilliseconds } from '@ygb/domain';

export function addTwelveShanghaiMonths(epochMilliseconds: number): number {
  assertEpochMilliseconds(epochMilliseconds);
  const local = new Date(epochMilliseconds + CHINA_UTC_OFFSET_MS);
  const year = local.getUTCFullYear() + 1;
  const month = local.getUTCMonth();
  const day = Math.min(local.getUTCDate(), daysInMonth(year, month));
  const result = Date.UTC(
    year, month, day,
    local.getUTCHours(), local.getUTCMinutes(), local.getUTCSeconds(),
    local.getUTCMilliseconds(),
  ) - CHINA_UTC_OFFSET_MS;
  assertEpochMilliseconds(result);
  return result;
}

function daysInMonth(year: number, zeroBasedMonth: number): number {
  return new Date(Date.UTC(year, zeroBasedMonth + 1, 0)).getUTCDate();
}
