import { describe, expect, it } from 'vitest';
import { parseGregorianDateOnly } from './date-only';

describe('Gregorian date-only parsing', () => {
  it.each(['2024-02-29', '2000-02-29', '2026-08-06'])(
    'accepts %s without timezone conversion',
    (value) => expect(parseGregorianDateOnly(value)).toBe(value),
  );

  it.each([
    '2023-02-29', '2024-02-30', '2024-00-01', '2024-13-01',
    '2024-01-00', '2024-1-01', ' 2024-01-01', '2024-01-01 ',
    '2024-01-01T00:00:00Z', '２０２４-０１-０１',
  ])('rejects %s', (value) => {
    expect(() => parseGregorianDateOnly(value)).toThrow('invalid_date_only');
  });
});
