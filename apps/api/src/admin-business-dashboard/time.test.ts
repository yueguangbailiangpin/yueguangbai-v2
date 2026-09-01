import { describe, expect, it } from 'vitest';
import { dashboardDateRange, dashboardWindow } from './time';

describe('admin dashboard Beijing calendar windows', () => {
  it('changes today at Beijing midnight and starts weeks on Monday', () => {
    expect(dashboardWindow('TODAY', Date.parse('2026-08-02T15:59:59.999Z')))
      .toMatchObject({ from_date: '2026-08-02', to_date: '2026-08-02' });
    expect(dashboardWindow('TODAY', Date.parse('2026-08-02T16:00:00.000Z')))
      .toMatchObject({ from_date: '2026-08-03', to_date: '2026-08-03' });
    expect(dashboardWindow('WEEK', Date.parse('2026-08-08T04:00:00.000Z')))
      .toMatchObject({ from_date: '2026-08-03', to_date: '2026-08-08' });
    expect(dashboardWindow('MONTH', Date.parse('2026-08-08T04:00:00.000Z')))
      .toMatchObject({ from_date: '2026-08-01', to_date: '2026-08-08' });
  });

  it('rejects reversed and excessive ranges', () => {
    expect(() => dashboardDateRange('2026-08-02', '2026-08-01')).toThrow();
    expect(() => dashboardDateRange('2025-01-01', '2026-08-01')).toThrow();
  });
});
