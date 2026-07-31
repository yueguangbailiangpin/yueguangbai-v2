import { describe, expect, it } from 'vitest';
import {
  isStaffPermissionCode,
  isStaffRoleCode,
  STAFF_PERMISSION_CODES,
  STAFF_ROLE_CODES,
} from './staff';

describe('staff contracts', () => {
  it('publishes the six frozen internal roles', () => {
    expect(STAFF_ROLE_CODES).toEqual([
      'owner',
      'pre_sales',
      'seller_ops',
      'seller_support',
      'after_sales',
      'buyer_support',
    ]);
  });

  it('recognizes only published role and permission codes', () => {
    expect(isStaffRoleCode('seller_support')).toBe(true);
    expect(isStaffRoleCode('department_leader')).toBe(false);
    expect(isStaffPermissionCode('ORDER_CONFIRM')).toBe(true);
    expect(isStaffPermissionCode('ROOT_ACCESS')).toBe(false);
    expect(new Set(STAFF_PERMISSION_CODES).size)
      .toBe(STAFF_PERMISSION_CODES.length);
  });
});
