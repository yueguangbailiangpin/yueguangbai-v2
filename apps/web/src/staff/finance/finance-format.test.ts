import { describe, expect, it } from 'vitest';
import { lookupAsOf, shiftChinaDate } from './finance-format';

describe('finance-format Beijing date helpers', () => {
  it('shifts dates on the Beijing calendar (not UTC)', () => {
    expect(shiftChinaDate('2026-08-23', 1)).toBe('2026-08-24');
    expect(shiftChinaDate('2026-08-23', -1)).toBe('2026-08-22');
    expect(shiftChinaDate('2026-08-31', 1)).toBe('2026-09-01');
    expect(shiftChinaDate('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('caps the as-of lookup at now', () => {
    const now = Date.parse('2026-08-23T10:00:00+08:00');
    expect(lookupAsOf('2026-08-23', now)).toBe(now);
    expect(lookupAsOf('2026-08-01', now)).toBe(Date.parse('2026-08-01T23:59:59.999+08:00'));
  });
});
