import { describe, expect, it } from 'vitest';
import {
  DEMAND_BATCH_STATUSES,
  DEMAND_REVIEW_DECISIONS,
  DEMAND_TASK_TYPES,
  isDemandReviewDecision,
  isDemandTaskType,
} from './demand';

describe('demand batch contracts', () => {
  it('publishes the frozen task types and lifecycle states', () => {
    expect(DEMAND_TASK_TYPES).toEqual([
      'RATING',
      'TEXT',
      'IMAGE',
      'VIDEO',
    ]);
    expect(DEMAND_BATCH_STATUSES).toEqual([
      'SUBMITTED',
      'PUBLISHED',
      'REJECTED',
      'WITHDRAWN',
      'CLOSED',
    ]);
  });

  it('recognizes only supported task types and review decisions', () => {
    expect(DEMAND_REVIEW_DECISIONS).toEqual([
      'PUBLISH',
      'REJECT',
    ]);
    expect(isDemandTaskType('IMAGE')).toBe(true);
    expect(isDemandTaskType('PHOTO')).toBe(false);
    expect(isDemandReviewDecision('PUBLISH')).toBe(true);
    expect(isDemandReviewDecision('APPROVE')).toBe(false);
  });
});
