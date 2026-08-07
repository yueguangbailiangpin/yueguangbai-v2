import { describe,expect,it } from 'vitest';
import { addShanghaiCalendarMonths,archiveDueAt,formatShanghaiTimestamp } from './time';

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
