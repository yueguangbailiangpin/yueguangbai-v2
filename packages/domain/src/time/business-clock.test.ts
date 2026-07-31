import { describe, expect, it } from 'vitest';
import { chinaBusinessDate } from './business-clock';

describe('China business clock', () => {
  it('changes date at 00:00 Asia/Shanghai', () => {
    expect(chinaBusinessDate(Date.parse('2026-07-31T15:59:59.999Z')))
      .toBe('2026-07-31');
    expect(chinaBusinessDate(Date.parse('2026-07-31T16:00:00.000Z')))
      .toBe('2026-08-01');
  });

  it('rejects invalid timestamps', () => {
    expect(() => chinaBusinessDate(-1)).toThrow('invalid_epoch_milliseconds');
    expect(() => chinaBusinessDate(Number.NaN))
      .toThrow('invalid_epoch_milliseconds');
  });
});
