import { describe, expect, it } from 'vitest';
import {
  basePermissionForDuty,
  businessPermissionsForDuty,
  businessPermissionForWorkItem,
  cleanAssignmentReason,
  dutyForWorkItem,
  eligibilityPermissionForDuty,
} from './rules';

describe('staff assignment rules', () => {
  it('keeps duty, eligibility and work permissions explicit', () => {
    expect(dutyForWorkItem('PRODUCT_APPLICATION_REVIEW')).toBe('SELLER_ACCOUNT_MANAGER');
    expect(dutyForWorkItem('BUYER_REFUND_PROCESSING')).toBe('BUYER_REFUND_OWNER');
    expect(eligibilityPermissionForDuty('BUYER_AFTER_SALES_OWNER'))
      .toBe('ASSIGNMENT_ELIGIBLE_BUYER_AFTER_SALES');
    expect(basePermissionForDuty('SELLER_ACCOUNT_MANAGER')).toBe('PRODUCT_VIEW');
    expect(businessPermissionsForDuty('SELLER_ACCOUNT_MANAGER')).toEqual([
      'PRODUCT_VIEW',
      'PRODUCT_REVIEW',
      'DEMAND_VIEW',
      'DEMAND_PUBLISH',
    ]);
    expect(businessPermissionForWorkItem('ORDER_EVIDENCE_REVIEW')).toBe('ORDER_CONFIRM');
  });

  it('requires a concrete reassignment reason', () => {
    expect(cleanAssignmentReason('  team change  ')).toBe('team change');
    expect(() => cleanAssignmentReason('   ')).toThrow('invalid_assignment_reason');
  });
});
