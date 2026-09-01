import { describe,expect,it } from 'vitest';
import {archiveDueAt,bundleEligibilityAt,formatShanghaiTimestamp} from './time';

// Stage 6.5 unified rule: ONE six-month computation — UTC calendar months on
// the stored UTC-millisecond closure timestamp. archiveDueAt (closure DTO)
// and bundleEligibilityAt (selector gate) are the same function now.

describe('six UTC calendar months (unified archiveDueAt + bundleEligibilityAt)',()=>{
  it('archiveDueAt equals bundleEligibilityAt for every boundary case',()=>{
    for (const start of [
      '2026-01-31T23:59:59.999Z','2024-02-29T00:00:00.000Z','2026-08-31T15:30:00.000Z',
      '2026-03-15T00:00:00.000Z','2025-12-31T23:59:59.999Z',
    ]) {
      const closed=Date.parse(start);
      expect(archiveDueAt(closed)).toBe(bundleEligibilityAt(closed));
    }
  });
  it.each([
    // Month-end clamping in UTC: the target month keeps the same day when it
    // exists and clamps to its last day otherwise.
    ['2026-01-31T23:59:59.999Z','2026-07-31T23:59:59.999Z'],
    ['2026-01-30T10:11:12.133Z','2026-07-30T10:11:12.133Z'],
    // Leap-year February: Feb 29 exists only in leap years.
    ['2024-02-29T08:09:10.011Z','2024-08-29T08:09:10.011Z'],
    ['2023-02-28T08:09:10.011Z','2023-08-28T08:09:10.011Z'],
    // Aug 31 + 6 months clamps into Feb 28/29 (184/185-day span).
    ['2026-08-31T15:30:00.000Z','2027-02-28T15:30:00.000Z'],
    ['2024-08-31T15:30:00.000Z','2025-02-28T15:30:00.000Z'],
    ['2023-08-31T15:30:00.000Z','2024-02-29T15:30:00.000Z'],
    // UTC day-boundary crossing: 20:00 UTC closures stay 20:00 UTC six
    // calendar months later regardless of the Shanghai calendar day.
    ['2026-01-31T20:00:00.000Z','2026-07-31T20:00:00.000Z'],
    ['2026-07-31T20:00:00.000Z','2027-01-31T20:00:00.000Z'],
    ['2026-03-15T00:00:00.000Z','2026-09-15T00:00:00.000Z'],
  ])('%s -> %s',(start,end)=>expect(bundleEligibilityAt(Date.parse(start))).toBe(Date.parse(end)));
  it('is never a flat 180-day offset across the year',()=>{
    // Aug -> Feb spans 184/185 days; Feb -> Aug spans 181 days.
    const august=Date.parse('2026-08-01T00:00:00.000Z');
    expect(bundleEligibilityAt(august)-august).toBe(184*86_400_000);
    const february=Date.parse('2026-02-01T00:00:00.000Z');
    expect(bundleEligibilityAt(february)-february).toBe(181*86_400_000);
  });
  it('rejects invalid timestamps',()=>{
    expect(()=>bundleEligibilityAt(-1)).toThrow('invalid_archive_calendar_time');
    expect(()=>bundleEligibilityAt(1.5)).toThrow('invalid_archive_calendar_time');
    expect(()=>archiveDueAt(-1)).toThrow('invalid_archive_calendar_time');
  });
  it('renders Shanghai display strings without shifting the stored UTC value',()=>{
    const closed=Date.parse('2026-02-07T00:00:00.000Z');
    const due=archiveDueAt(closed);
    expect(new Date(due).toISOString()).toBe('2026-08-07T00:00:00.000Z');
    expect(formatShanghaiTimestamp(due)).toContain('2026');
  });
});
