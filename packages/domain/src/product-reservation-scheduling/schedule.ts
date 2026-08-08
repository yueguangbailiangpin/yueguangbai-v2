import type { ReservationStatus } from '@ygb/contracts';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/u;
const ACTIVE_STATUSES = new Set<ReservationStatus>([
  'PENDING_REVIEW',
  'APPROVED',
]);

export interface ReservationQueueFact {
  id: string;
  status: ReservationStatus;
  submittedAt: number;
}

export interface RankedReservation extends ReservationQueueFact {
  rank: number | null;
}

export function validateOrderCadence(input: {
  orderIntervalDays: number;
  ordersPerRun: number;
}): void {
  if (!Number.isSafeInteger(input.orderIntervalDays)
    || input.orderIntervalDays < 1
    || input.orderIntervalDays > 36_500
    || !Number.isSafeInteger(input.ordersPerRun)
    || input.ordersPerRun < 1
    || input.ordersPerRun > 100_000) {
    throw new Error('invalid_order_cadence');
  }
}

export function plannedOrderDate(input: {
  firstOrderDate: string;
  rank: number;
  orderIntervalDays: number;
  ordersPerRun: number;
}): string {
  validateOrderCadence(input);
  if (!Number.isSafeInteger(input.rank) || input.rank < 1) {
    throw new Error('invalid_reservation_rank');
  }
  const runIndex = Math.floor((input.rank - 1) / input.ordersPerRun);
  const days = runIndex * input.orderIntervalDays;
  if (!Number.isSafeInteger(days)) throw new Error('invalid_schedule_range');
  return addCalendarDays(input.firstOrderDate, days);
}

export function theoreticalLastOrderDate(input: {
  firstOrderDate: string;
  targetQuantity: number;
  orderIntervalDays: number;
  ordersPerRun: number;
}): string {
  if (!Number.isSafeInteger(input.targetQuantity)
    || input.targetQuantity < 1
    || input.targetQuantity > 100_000) {
    throw new Error('invalid_target_quantity');
  }
  return plannedOrderDate({
    ...input,
    rank: input.targetQuantity,
  });
}

export function rankReservationQueue(
  facts: readonly ReservationQueueFact[],
): readonly RankedReservation[] {
  const ordered = facts.map((fact) => {
    if (!Number.isSafeInteger(fact.submittedAt) || fact.submittedAt < 0
      || typeof fact.id !== 'string' || fact.id.length < 1) {
      throw new Error('invalid_reservation_queue_fact');
    }
    return fact;
  }).sort((left, right) => left.submittedAt - right.submittedAt
    || left.id.localeCompare(right.id, 'en'));
  let rank = 0;
  return ordered.map((fact) => ({
    ...fact,
    rank: ACTIVE_STATUSES.has(fact.status) ? ++rank : null,
  }));
}

export function isEffectiveReservationStatus(
  status: ReservationStatus,
): boolean {
  return ACTIVE_STATUSES.has(status);
}

export function addCalendarDays(value: string, days: number): string {
  const date = parseDate(value);
  if (!Number.isSafeInteger(days)) throw new Error('invalid_schedule_range');
  date.setUTCDate(date.getUTCDate() + days);
  if (!Number.isFinite(date.getTime())) throw new Error('invalid_schedule_range');
  return formatDate(date);
}

export function beijingDateFromEpochMs(epochMs: number): string {
  if (!Number.isSafeInteger(epochMs) || epochMs < 0) {
    throw new Error('invalid_epoch_milliseconds');
  }
  const shifted = new Date(epochMs + 8 * 60 * 60 * 1000);
  if (!Number.isFinite(shifted.getTime())) {
    throw new Error('invalid_epoch_milliseconds');
  }
  return formatDate(shifted);
}

function parseDate(value: string): Date {
  if (typeof value !== 'string') throw new Error('invalid_date_only');
  const match = DATE_ONLY.exec(value);
  if (!match) throw new Error('invalid_date_only');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day) {
    throw new Error('invalid_date_only');
  }
  return date;
}

function formatDate(date: Date): string {
  return [
    String(date.getUTCFullYear()).padStart(4, '0'),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}
