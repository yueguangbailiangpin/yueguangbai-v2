import { describe, expect, it } from 'vitest';
import type {
  StaffPermissionCode,
  StaffRoleCode,
} from '@ygb/contracts';
import {
  calculateEffectiveStaffAuthorization,
  isOwnerOnlyPermission,
  leaderPermissionPack,
} from './authorization-policy';

function set<T>(...values: T[]): ReadonlySet<T> {
  return new Set(values);
}

describe('staff authorization formula', () => {
  it('unions multiple role defaults and personal grants', () => {
    const result = calculateEffectiveStaffAuthorization({
      roles: set<StaffRoleCode>('pre_sales', 'buyer_support'),
      grants: set<StaffPermissionCode>('SELLER_VIEW'),
      denies: set<StaffPermissionCode>(),
      memberTeamIds: ['team-b', 'team-a'],
      leaderTeamIds: [],
    });

    expect(result.permissions.has('ORDER_CONFIRM')).toBe(true);
    expect(result.permissions.has('BUYER_SUPPORT_NOTE')).toBe(true);
    expect(result.permissions.has('SELLER_VIEW')).toBe(true);
    expect(result.memberTeamIds).toEqual(['team-a', 'team-b']);
  });

  it('applies the leader pack only when a leader scope exists', () => {
    const ordinary = calculateEffectiveStaffAuthorization({
      roles: set<StaffRoleCode>('seller_support'),
      grants: set<StaffPermissionCode>(),
      denies: set<StaffPermissionCode>(),
      memberTeamIds: ['team-a'],
      leaderTeamIds: [],
    });
    expect(ordinary.permissions.has('TASK_ASSIGN_TEAM')).toBe(false);

    const leader = calculateEffectiveStaffAuthorization({
      roles: set<StaffRoleCode>('seller_support'),
      grants: set<StaffPermissionCode>(),
      denies: set<StaffPermissionCode>(),
      memberTeamIds: ['team-a'],
      leaderTeamIds: ['team-a'],
    });
    for (const permission of leaderPermissionPack()) {
      expect(leader.permissions.has(permission)).toBe(true);
    }
  });

  it('applies hard owner-only prohibitions after grants', () => {
    const result = calculateEffectiveStaffAuthorization({
      roles: set<StaffRoleCode>('seller_ops'),
      grants: set<StaffPermissionCode>(
        'FINANCIAL_CORRECT',
        'FINANCIAL_EXPORT',
        'STAFF_MANAGE',
      ),
      denies: set<StaffPermissionCode>(),
      memberTeamIds: [],
      leaderTeamIds: [],
    });

    expect(result.permissions.has('FINANCIAL_CORRECT')).toBe(false);
    expect(result.permissions.has('FINANCIAL_EXPORT')).toBe(false);
    expect(result.permissions.has('STAFF_MANAGE')).toBe(false);
    expect(isOwnerOnlyPermission('FINANCIAL_CORRECT')).toBe(true);
  });

  it('applies personal denies after role defaults and leader grants', () => {
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
});
