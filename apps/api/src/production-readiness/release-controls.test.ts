import { describe, expect, it } from 'vitest';
import { evaluateWorkerRollback, runAnonymousCapacityDryRun } from '@ygb/testkit';

describe('production readiness capacity and rollback controls', () => {
  it('covers the frozen 8 Staff / 200 daily order envelope with a peak burst', () => {
    expect(runAnonymousCapacityDryRun(1)).toMatchObject({
      status: 'PASS',
      staff_count: 8,
      daily_orders: 200,
      peak_orders_15m: 50,
      file_objects: 800,
      actionable_summaries: 50,
      order_batches_at_50: 4,
      file_batches_at_50: 16,
      max_orders_per_staff: 25,
      reconciliation_findings: 0,
      external_calls: 0,
    });
  });

  it('blocks an R2-only rollback after deletion until every object is rehydrated', () => {
    expect(evaluateWorkerRollback({
      deletedR2Objects: 2,
      targetSupportsDriveProxy: false,
      manifestVerifiedRehydratedObjects: 1,
    })).toEqual({ allowed: false, reason: 'R2_REHYDRATION_REQUIRED' });
    expect(evaluateWorkerRollback({
      deletedR2Objects: 2,
      targetSupportsDriveProxy: false,
      manifestVerifiedRehydratedObjects: 2,
    })).toEqual({
      allowed: true,
      reason: 'MANIFEST_VERIFIED_REHYDRATION_COMPLETE',
    });
    expect(evaluateWorkerRollback({
      deletedR2Objects: 2,
      targetSupportsDriveProxy: true,
      manifestVerifiedRehydratedObjects: 0,
    }).allowed).toBe(true);
  });
});
