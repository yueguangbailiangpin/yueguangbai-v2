export const DEMAND_TASK_TYPES = [
  'RATING',
  'TEXT',
  'IMAGE',
  'VIDEO',
] as const;

export type DemandTaskType = typeof DEMAND_TASK_TYPES[number];

export const DEMAND_BATCH_STATUSES = [
  'SUBMITTED',
  'PUBLISHED',
  'REJECTED',
  'WITHDRAWN',
  'CLOSED',
] as const;

export type DemandBatchStatus =
  typeof DEMAND_BATCH_STATUSES[number];

export const DEMAND_REVIEW_DECISIONS = [
  'PUBLISH',
  'REJECT',
] as const;

export type DemandReviewDecision =
  typeof DEMAND_REVIEW_DECISIONS[number];

export function isDemandTaskType(
  value: unknown,
): value is DemandTaskType {
  return typeof value === 'string'
    && (DEMAND_TASK_TYPES as readonly string[]).includes(value);
}

export function isDemandReviewDecision(
  value: unknown,
): value is DemandReviewDecision {
  return typeof value === 'string'
    && (DEMAND_REVIEW_DECISIONS as readonly string[])
      .includes(value);
}
