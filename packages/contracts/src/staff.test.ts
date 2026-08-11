import { describe, expect, it } from 'vitest';
import {
  isStaffPermissionCode,
  isStaffRoleCode,
  STAFF_PERMISSION_CODES,
  STAFF_ROLE_DISPLAY_NAMES,
  STAFF_ROLE_CODES,
} from './staff';

describe('staff contracts', () => {
  it('publishes the five frozen internal roles and Chinese displays', () => {
    expect(STAFF_ROLE_CODES).toEqual([
      'owner',
      'acquisition',
      'pre_sales',
      'seller_ops',
      'buyer_refund',
    ]);
    expect(STAFF_ROLE_DISPLAY_NAMES).toEqual({
      owner: '总管理员',
      acquisition: '获客',
      pre_sales: '售前',
      seller_ops: '卖家对接',
      buyer_refund: '买家返款',
    });
  });

  it('recognizes only published role and permission codes', () => {
    expect(isStaffRoleCode('buyer_refund')).toBe(true);
    expect(isStaffRoleCode('seller_support')).toBe(false);
    expect(isStaffRoleCode('department_leader')).toBe(false);
    expect(isStaffPermissionCode('ORDER_CONFIRM')).toBe(true);
    expect(isStaffPermissionCode('ROOT_ACCESS')).toBe(false);
    expect(new Set(STAFF_PERMISSION_CODES).size)
      .toBe(STAFF_PERMISSION_CODES.length);
  });
});
