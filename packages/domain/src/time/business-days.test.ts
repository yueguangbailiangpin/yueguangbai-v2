import { describe, expect, it } from 'vitest';
import { addChinaBusinessDays } from './business-days';

// 北京时间 2026-08-21 是周五（epoch 取当日正午，北京时间 12:00）。
const FRIDAY_NOON = Date.parse('2026-08-21T04:00:00.000Z');
const MS_PER_DAY = 86_400_000;

describe('addChinaBusinessDays', () => {
  it('advances from Friday across the weekend to the next Tuesday', () => {
    // 周五 +1 → 周一（周六日跳过）
    expect(addChinaBusinessDays(FRIDAY_NOON, 1)).toBe(FRIDAY_NOON + 3 * MS_PER_DAY);
    // 周五 +7 个工作日：8/24-28（一至五）5 天 + 8/31、9/1 两天，跳两个周末 = 11 个自然日
    expect(addChinaBusinessDays(FRIDAY_NOON, 7)).toBe(FRIDAY_NOON + 11 * MS_PER_DAY);
  });

  it('starts counting from the next calendar day (weekend starts skip to Monday)', () => {
    // 周六起点：周日跳过，8/24（一）是第 1 个工作日 → +7 落在 9/1（二）
    const saturday = FRIDAY_NOON + MS_PER_DAY;
    expect(addChinaBusinessDays(saturday, 7)).toBe(FRIDAY_NOON + 11 * MS_PER_DAY);
    // 周一起点：8/25（二）是第 1 个工作日 → +7 落在 9/2（三）
    const monday = FRIDAY_NOON + 3 * MS_PER_DAY;
    expect(addChinaBusinessDays(monday, 7)).toBe(FRIDAY_NOON + 12 * MS_PER_DAY);
  });

  it('never lands on a weekend', () => {
    let cursor = FRIDAY_NOON;
    for (let day = 1; day <= 20; day += 1) {
      cursor = addChinaBusinessDays(FRIDAY_NOON, day);
      const dow = new Date(cursor + 8 * 3600 * 1000).getUTCDay();
      expect(dow).not.toBe(0);
      expect(dow).not.toBe(6);
    }
  });

  it('preserves the time of day and rejects invalid input', () => {
    const deadline = addChinaBusinessDays(FRIDAY_NOON, 3);
    expect(new Date(deadline + 8 * 3600 * 1000).getUTCHours()).toBe(12);
    expect(() => addChinaBusinessDays(FRIDAY_NOON, 0)).toThrow();
    expect(() => addChinaBusinessDays(-1, 3)).toThrow();
    expect(() => addChinaBusinessDays(FRIDAY_NOON, 366)).toThrow();
  });
});
