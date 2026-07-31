export const PRODUCT_APPLICATION_STATUSES = [
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'WITHDRAWN',
] as const;

export type ProductApplicationStatus =
  typeof PRODUCT_APPLICATION_STATUSES[number];

export const PRODUCT_APPLICATION_REVIEW_DECISIONS = [
  'APPROVE',
  'REJECT',
] as const;

export type ProductApplicationReviewDecision =
  typeof PRODUCT_APPLICATION_REVIEW_DECISIONS[number];

export function isProductApplicationReviewDecision(
  value: unknown,
): value is ProductApplicationReviewDecision {
  return typeof value === 'string'
    && (PRODUCT_APPLICATION_REVIEW_DECISIONS as readonly string[])
      .includes(value);
}
