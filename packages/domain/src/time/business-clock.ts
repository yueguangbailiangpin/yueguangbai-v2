export const CHINA_TIME_ZONE = 'Asia/Shanghai' as const;
export const CHINA_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;

export function assertEpochMilliseconds(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('invalid_epoch_milliseconds');
  }
}

export function chinaBusinessDate(epochMilliseconds: number): string {
  assertEpochMilliseconds(epochMilliseconds);
  const shifted = new Date(epochMilliseconds + CHINA_UTC_OFFSET_MS);

  return [
    String(shifted.getUTCFullYear()).padStart(4, '0'),
    String(shifted.getUTCMonth() + 1).padStart(2, '0'),
    String(shifted.getUTCDate()).padStart(2, '0'),
  ].join('-');
}
