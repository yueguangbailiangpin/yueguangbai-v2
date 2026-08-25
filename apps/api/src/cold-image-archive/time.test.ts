import { describe,expect,it } from 'vitest';
import { addShanghaiCalendarMonths,archiveDueAt,bundleEligibilityAt,formatShanghaiTimestamp } from './time';

const shanghai=(value:string)=>Date.parse(`${value}+08:00`);
describe('six natural months in Asia/Shanghai',()=>{
  it.each([
    ['2026-01-31T23:59:59.123','2026-07-31T23:59:59.123'],
    ['2026-08-31T12:30:00.000','2027-02-28T12:30:00.000'],
    ['2024-08-31T00:00:00.000','2025-02-28T00:00:00.000'],
    ['2023-08-29T08:09:10.011','2024-02-29T08:09:10.011'],
  ])('%s -> %s',(start,end)=>expect(archiveDueAt(shanghai(start))).toBe(shanghai(end)));
  it('stores UTC milliseconds and renders Beijing time',()=>{
    const value=addShanghaiCalendarMonths(shanghai('2026-02-07T00:00:00.000'),6);
    expect(new Date(value).toISOString()).toBe('2026-08-06T16:00:00.000Z');
    expect(formatShanghaiTimestamp(value)).toContain('2026');
  });
});

describe('bundle eligibility: six UTC calendar months, never 180 days',()=>{
  it.each([
    // Month-end clamping in UTC: Aug 31 + 6 months lands on Feb 28/29.
    ['2026-08-31T15:30:00.000Z','2027-02-28T15:30:00.000Z'],
    ['2024-08-29T08:09:10.011Z','2025-02-28T08:09:10.011Z'],
    ['2026-01-31T23:59:59.999Z','2026-07-31T23:59:59.999Z'],
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
  });
});
