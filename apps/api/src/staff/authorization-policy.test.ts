import { describe, expect, it } from 'vitest';
import type {
  StaffPermissionCode,
  StaffRoleCode,
} from '@ygb/contracts';
import {
  calculateEffectiveStaffAuthorization,
  isOwnerOnlyPermission,
  leaderPermissionPack,
  roleDefaultPermissions,
} from './authorization-policy';

function set<T>(...values: T[]): ReadonlySet<T> {
  return new Set(values);
}

describe('staff authorization formula', () => {
  it('keeps scheduled operation execution owner-only and personal deny final', () => {
    const deniedOwner = calculateEffectiveStaffAuthorization({ roles: set<StaffRoleCode>('owner'), grants: set<StaffPermissionCode>(), denies: set<StaffPermissionCode>('SCHEDULED_OPERATIONS_RUN'), memberTeamIds: [], leaderTeamIds: [] });
    const grantedNonOwner = calculateEffectiveStaffAuthorization({ roles: set<StaffRoleCode>('pre_sales'), grants: set<StaffPermissionCode>('SCHEDULED_OPERATIONS_RUN'), denies: set<StaffPermissionCode>(), memberTeamIds: ['team-1'], leaderTeamIds: [] });
    expect(deniedOwner.permissions.has('SCHEDULED_OPERATIONS_RUN')).toBe(false);
    expect(grantedNonOwner.permissions.has('SCHEDULED_OPERATIONS_RUN')).toBe(false);
  });
  it('rejects role unions and ignores legacy personal grants', () => {
    expect(() => calculateEffectiveStaffAuthorization({
      roles: set<StaffRoleCode>('pre_sales', 'buyer_refund'),
      grants: set<StaffPermissionCode>(),
      denies: set<StaffPermissionCode>(),
      memberTeamIds: [],
      leaderTeamIds: [],
    })).toThrow('invalid_active_staff_role_count');
    const result = calculateEffectiveStaffAuthorization({
      roles: set<StaffRoleCode>('pre_sales'),
      grants: set<StaffPermissionCode>('SELLER_VIEW'),
      denies: set<StaffPermissionCode>(),
      memberTeamIds: ['team-b', 'team-a'],
      leaderTeamIds: [],
    });
    expect(result.permissions.has('ORDER_CONFIRM')).toBe(true);
    expect(result.permissions.has('SELLER_VIEW')).toBe(false);
    expect(result.memberTeamIds).toEqual(['team-a', 'team-b']);
  });

  it('keeps legacy leader membership audit-only without a permission pack', () => {
    const ordinary = calculateEffectiveStaffAuthorization({
      roles: set<StaffRoleCode>('seller_ops'),
      grants: set<StaffPermissionCode>(),
      denies: set<StaffPermissionCode>(),
      memberTeamIds: ['team-a'],
      leaderTeamIds: [],
    });
    expect(ordinary.permissions.has('TASK_ASSIGN_TEAM')).toBe(false);

    const leader = calculateEffectiveStaffAuthorization({
      roles: set<StaffRoleCode>('seller_ops'),
      grants: set<StaffPermissionCode>(),
      denies: set<StaffPermissionCode>(),
      memberTeamIds: ['team-a'],
      leaderTeamIds: ['team-a'],
    });
    expect(leaderPermissionPack()).toEqual(new Set());
    expect(leader.leaderTeamIds).toEqual(['team-a']);
    expect(leader.permissions.has('TASK_ASSIGN_TEAM')).toBe(false);
  });

  it('keeps owner-only prohibitions even when legacy grants exist', () => {
    const result = calculateEffectiveStaffAuthorization({
      roles: set<StaffRoleCode>('seller_ops'),
      grants: set<StaffPermissionCode>(
        'FINANCIAL_CORRECT',
        'FINANCIAL_EXPORT',
        'STAFF_MANAGE',
        'ACQUISITION_ADMIN',
      ),
      denies: set<StaffPermissionCode>(),
      memberTeamIds: [],
      leaderTeamIds: [],
    });

    expect(result.permissions.has('FINANCIAL_CORRECT')).toBe(false);
    expect(result.permissions.has('FINANCIAL_EXPORT')).toBe(false);
    expect(result.permissions.has('STAFF_MANAGE')).toBe(false);
    expect(result.permissions.has('ACQUISITION_ADMIN')).toBe(false);
    expect(isOwnerOnlyPermission('FINANCIAL_CORRECT')).toBe(true);
  });

  it('applies personal denies after role defaults', () => {
    const result = calculateEffectiveStaffAuthorization({
      roles: set<StaffRoleCode>('owner'),
      grants: set<StaffPermissionCode>(),
      denies: set<StaffPermissionCode>(
        'FINANCIAL_EXPORT',
        'TASK_ASSIGN_TEAM',
      ),
      memberTeamIds: ['team-a'],
      leaderTeamIds: ['team-a'],
    });

    expect(result.permissions.has('FINANCIAL_CORRECT')).toBe(true);
    expect(result.permissions.has('FINANCIAL_EXPORT')).toBe(false);
    expect(result.permissions.has('TASK_ASSIGN_TEAM')).toBe(false);
  });

  it('bounds buyer_refund to review, refund and necessary Buyer duties', () => {
    const defaults = roleDefaultPermissions('buyer_refund');
    expect(defaults).toEqual(new Set([
      'TASK_VIEW_OPEN',
      'TASK_CLAIM',
      'BUYER_VIEW',
      'ORDER_VIEW',
      'REVIEW_VIEW',
      'REVIEW_DECIDE',
      'BUYER_REFUND_VIEW',
      'BUYER_REFUND_RECORD',
      'ASSIGNMENT_ELIGIBLE_BUYER_AFTER_SALES',
      'ASSIGNMENT_ELIGIBLE_BUYER_REFUND',
    ]));
    for (const excluded of [
      'FINANCIAL_VIEW',
      'SELLER_VIEW',
      'SELLER_MANAGE',
      'STAFF_MANAGE',
      'PERMISSION_MANAGE',
      'BUYER_IDENTITY_HIGH_RISK_MANAGE',
      'SCHEDULED_OPERATIONS_RUN',
    ] as const) expect(defaults.has(excluded)).toBe(false);
  });
});
