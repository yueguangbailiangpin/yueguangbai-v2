import { describe, expect, it } from 'vitest';
import {
  beijingDateFromEpochMs,
  plannedOrderDate,
  rankReservationQueue,
  theoreticalLastOrderDate,
} from './schedule';

describe('product reservation order scheduling', () => {
  it('maps the three frozen cadence examples', () => {
    expect([1, 2, 3].map((rank) => plannedOrderDate({
      firstOrderDate: '2026-08-08', rank,
      orderIntervalDays: 1, ordersPerRun: 1,
    }))).toEqual(['2026-08-08', '2026-08-09', '2026-08-10']);
    expect([1, 2, 3, 4].map((rank) => plannedOrderDate({
      firstOrderDate: '2026-08-08', rank,
      orderIntervalDays: 1, ordersPerRun: 2,
    }))).toEqual(['2026-08-08', '2026-08-08', '2026-08-09', '2026-08-09']);
    expect([1, 2, 3].map((rank) => plannedOrderDate({
      firstOrderDate: '2026-08-08', rank,
      orderIntervalDays: 2, ordersPerRun: 1,
    }))).toEqual(['2026-08-08', '2026-08-10', '2026-08-12']);
  });

  it('counts weekends, holidays, month/year and leap boundaries', () => {
    expect(plannedOrderDate({ firstOrderDate: '2026-10-01', rank: 4,
      orderIntervalDays: 1, ordersPerRun: 1 })).toBe('2026-10-04');
    expect(plannedOrderDate({ firstOrderDate: '2024-02-28', rank: 2,
      orderIntervalDays: 1, ordersPerRun: 1 })).toBe('2024-02-29');
    expect(plannedOrderDate({ firstOrderDate: '2026-12-31', rank: 2,
      orderIntervalDays: 1, ordersPerRun: 1 })).toBe('2027-01-01');
    expect(theoreticalLastOrderDate({ firstOrderDate: '2026-08-08',
      targetQuantity: 20, orderIntervalDays: 1, ordersPerRun: 2 }))
      .toBe('2026-08-17');
    expect(beijingDateFromEpochMs(Date.UTC(2026, 7, 7, 15, 59, 59)))
      .toBe('2026-08-07');
    expect(beijingDateFromEpochMs(Date.UTC(2026, 7, 7, 16, 0, 0)))
      .toBe('2026-08-08');
  });

  it('ranks active rows by timestamp then immutable id and compacts exits', () => {
    expect(rankReservationQueue([
      { id: 'b', status: 'APPROVED', submittedAt: 10 },
      { id: 'a', status: 'REJECTED', submittedAt: 10 },
      { id: 'c', status: 'PENDING_REVIEW', submittedAt: 10 },
      { id: 'd', status: 'CANCELLED', submittedAt: 11 },
      { id: 'e', status: 'EXPIRED', submittedAt: 12 },
    ])).toEqual([
      { id: 'a', status: 'REJECTED', submittedAt: 10, rank: null },
      { id: 'b', status: 'APPROVED', submittedAt: 10, rank: 1 },
      { id: 'c', status: 'PENDING_REVIEW', submittedAt: 10, rank: 2 },
      { id: 'd', status: 'CANCELLED', submittedAt: 11, rank: null },
      { id: 'e', status: 'EXPIRED', submittedAt: 12, rank: null },
    ]);
  });

  it('rejects invalid cadence, rank and dates', () => {
    expect(() => plannedOrderDate({ firstOrderDate: '2026-02-30', rank: 1,
      orderIntervalDays: 1, ordersPerRun: 1 })).toThrow('invalid_date_only');
    expect(() => plannedOrderDate({ firstOrderDate: '2026-02-28', rank: 0,
      orderIntervalDays: 1, ordersPerRun: 1 })).toThrow('invalid_reservation_rank');
    expect(() => plannedOrderDate({ firstOrderDate: '2026-02-28', rank: 1,
      orderIntervalDays: 0, ordersPerRun: 1 })).toThrow('invalid_order_cadence');
  });
});
