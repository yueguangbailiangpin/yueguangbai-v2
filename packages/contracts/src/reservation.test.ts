import { describe, expect, it } from 'vitest';
import {
  isReservationDecision,
  RESERVATION_DECISIONS,
  RESERVATION_STATUSES,
} from './reservation';

describe('reservation contracts', () => {
  it('publishes the frozen reservation states', () => {
    expect(RESERVATION_STATUSES).toEqual([
      'PENDING_REVIEW',
      'APPROVED',
      'REJECTED',
      'CANCELLED',
      'EXPIRED',
    ]);
  });

  it('recognizes only approve and reject decisions', () => {
    expect(RESERVATION_DECISIONS).toEqual([
      'APPROVE',
      'REJECT',
    ]);
    expect(isReservationDecision('APPROVE')).toBe(true);
    expect(isReservationDecision('CANCEL')).toBe(false);
  });
});
