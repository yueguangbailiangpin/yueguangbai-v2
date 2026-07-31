import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  createMigratedTestDatabase,
  type SqliteDatabase,
} from '@ygb/testkit';
import {
  resolveStaffAuthorizationByFeishu,
} from './staff-authorization';

let database: SqliteDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe('staff authorization resolver', () => {
  it('resolves multi-role, override, membership, and leader scope', async () => {
    database = createMigratedTestDatabase();
    seedOrganization(database);

    await database.batch([
      database.prepare(`
        INSERT INTO staff_users (
          id, display_name, status, authorization_version,
          version, created_at, updated_at, disabled_at
        ) VALUES (
          'staff-1', '测试员工', 'ACTIVE', 7,
          1, 1000, 1000, NULL
        )
      `),
      database.prepare(`
        INSERT INTO feishu_staff_identities (
          id, staff_id, tenant_key, open_id, user_id,
          status, verified_at, created_at, updated_at, revoked_at
        ) VALUES (
          'identity-1', 'staff-1', 'tenant-test', 'open-1', 'user-1',
          'ACTIVE', 1000, 1000, 1000, NULL
        )
      `),
      role(database, 'staff-1', 'pre_sales'),
      role(database, 'staff-1', 'buyer_support'),
      database.prepare(`
        INSERT INTO staff_team_memberships (
          staff_id, team_id, status, joined_at, ended_at,
          created_at, updated_at
        ) VALUES (
          'staff-1', 'team-sales', 'ACTIVE', 1000, NULL,
          1000, 1000
        )
      `),
      database.prepare(`
        INSERT INTO staff_team_leaders (
          staff_id, team_id, status, assigned_by_staff_id,
          assigned_at, revoked_at, created_at, updated_at
        ) VALUES (
          'staff-1', 'team-sales', 'ACTIVE', NULL,
          1000, NULL, 1000, 1000
        )
      `),
      override(database, 'staff-1', 'SELLER_VIEW', 'GRANT'),
      override(database, 'staff-1', 'ORDER_CONFIRM', 'DENY'),
      override(database, 'staff-1', 'FINANCIAL_CORRECT', 'GRANT'),
    ]);

    const context = await resolveStaffAuthorizationByFeishu(database, {
      tenantKey: ' tenant-test ',
      openId: ' open-1 ',
    });

    expect(context).not.toBeNull();
    expect(context?.staffId).toBe('staff-1');
    expect(context?.authorizationVersion).toBe(7);
    expect([...context?.roles ?? []].sort()).toEqual([
      'buyer_support',
      'pre_sales',
    ]);
    expect(context?.permissions.has('BUYER_SUPPORT_NOTE')).toBe(true);
    expect(context?.permissions.has('SELLER_VIEW')).toBe(true);
    expect(context?.permissions.has('TASK_ASSIGN_TEAM')).toBe(true);
    expect(context?.permissions.has('ORDER_CONFIRM')).toBe(false);
    expect(context?.permissions.has('FINANCIAL_CORRECT')).toBe(false);
    expect(context?.memberTeamIds).toEqual(['team-sales']);
    expect(context?.leaderTeamIds).toEqual(['team-sales']);
  });

  it('fails closed for disabled staff, revoked identity, or no roles', async () => {
    database = createMigratedTestDatabase();
    seedOrganization(database);

    await database.batch([
      database.prepare(`
        INSERT INTO staff_users (
          id, display_name, status, authorization_version,
          version, created_at, updated_at, disabled_at
        ) VALUES (
          'staff-disabled', '停用员工', 'DISABLED', 1,
          1, 1000, 1000, 1000
        )
      `),
      database.prepare(`
        INSERT INTO feishu_staff_identities (
          id, staff_id, tenant_key, open_id, user_id,
          status, verified_at, created_at, updated_at, revoked_at
        ) VALUES (
          'identity-disabled', 'staff-disabled', 'tenant-test',
          'open-disabled', NULL, 'ACTIVE', 1000, 1000, 1000, NULL
        )
      `),
      database.prepare(`
        INSERT INTO staff_users (
          id, display_name, status, authorization_version,
          version, created_at, updated_at, disabled_at
        ) VALUES (
          'staff-no-role', '无角色员工', 'ACTIVE', 1,
          1, 1000, 1000, NULL
        )
      `),
      database.prepare(`
        INSERT INTO feishu_staff_identities (
          id, staff_id, tenant_key, open_id, user_id,
          status, verified_at, created_at, updated_at, revoked_at
        ) VALUES (
          'identity-no-role', 'staff-no-role', 'tenant-test',
          'open-no-role', NULL, 'ACTIVE', 1000, 1000, 1000, NULL
        )
      `),
    ]);

    await expect(resolveStaffAuthorizationByFeishu(database, {
      tenantKey: 'tenant-test',
      openId: 'open-disabled',
    })).resolves.toBeNull();

    await expect(resolveStaffAuthorizationByFeishu(database, {
      tenantKey: 'tenant-test',
      openId: 'open-no-role',
    })).resolves.toBeNull();

    await expect(resolveStaffAuthorizationByFeishu(database, {
      tenantKey: 'tenant-test',
      openId: 'missing',
    })).resolves.toBeNull();
  });
});

function seedOrganization(database: SqliteDatabase): void {
  database.exec(`
    INSERT INTO staff_departments (
      id, code, name, status, version,
      created_at, updated_at, disabled_at
    ) VALUES (
      'department-sales', 'sales', '业务部', 'ACTIVE', 1,
      1000, 1000, NULL
    );

    INSERT INTO staff_teams (
      id, department_id, code, name, status, version,
      created_at, updated_at, disabled_at
    ) VALUES (
      'team-sales', 'department-sales', 'sales-team',
      '业务一组', 'ACTIVE', 1, 1000, 1000, NULL
    );
  `);
}

function role(
  database: SqliteDatabase,
  staffId: string,
  roleCode: string,
) {
  return database.prepare(`
    INSERT INTO staff_role_assignments (
      staff_id, role_code, status, assigned_by_staff_id,
      assigned_at, revoked_at, created_at, updated_at
    ) VALUES (?, ?, 'ACTIVE', NULL, 1000, NULL, 1000, 1000)
  `).bind(staffId, roleCode);
}

function override(
  database: SqliteDatabase,
  staffId: string,
  permissionCode: string,
  effect: 'GRANT' | 'DENY',
) {
  return database.prepare(`
    INSERT INTO staff_permission_overrides (
      staff_id, permission_code, effect, status, reason,
      assigned_by_staff_id, assigned_at, revoked_at,
      created_at, updated_at
    ) VALUES (
      ?, ?, ?, 'ACTIVE', NULL, NULL, 1000, NULL, 1000, 1000
    )
  `).bind(staffId, permissionCode, effect);
}
