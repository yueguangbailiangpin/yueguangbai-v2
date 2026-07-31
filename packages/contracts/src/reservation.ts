export const RESERVATION_STATUSES = [
  'PENDING_REVIEW',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
  'EXPIRED',
] as const;

export type ReservationStatus =
  typeof RESERVATION_STATUSES[number];

export const RESERVATION_DECISIONS = [
  'APPROVE',
  'REJECT',
] as const;

export type ReservationDecision =
  typeof RESERVATION_DECISIONS[number];

export function isReservationDecision(
  value: unknown,
): value is ReservationDecision {
  return typeof value === 'string'
    && (RESERVATION_DECISIONS as readonly string[])
      .includes(value);
}
