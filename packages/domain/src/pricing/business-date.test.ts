import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  chinaBusinessDateStartEpoch,
  parseChinaBusinessDate,
} from './business-date';
import { chinaBusinessDate } from '../time/business-clock';

describe('China business date parsing', () => {
  it('accepts only real calendar dates in YYYY-MM-DD form', () => {
    expect(parseChinaBusinessDate(' ２０２６-０８-０１ '))
      .toBe('2026-08-01');
    expect(parseChinaBusinessDate('2024-02-29')).toBe('2024-02-29');
    expect(() => parseChinaBusinessDate('2026-02-29'))
      .toThrow('invalid_business_date');
    expect(() => parseChinaBusinessDate('2026-8-1'))
      .toThrow('invalid_business_date');
  });

  it('maps midnight Asia/Shanghai to an exact UTC millisecond', () => {
    const epoch = chinaBusinessDateStartEpoch('2026-08-01');
    expect(epoch).toBe(Date.UTC(2026, 6, 31, 16, 0, 0, 0));
    expect(chinaBusinessDate(epoch)).toBe('2026-08-01');
  });
});
