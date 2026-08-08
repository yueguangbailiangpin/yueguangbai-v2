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
  ProvisionStaffError,
  provisionStaff,
} from './provision-staff';
import {
  resolveStaffAuthorizationByFeishu,
} from './staff-authorization';

let database: SqliteDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe('staff provisioning command', () => {
  it('atomically creates identity, roles, scope, audit, and outbox and replays', async () => {
    database = createMigratedTestDatabase();
    seedOwnerAndTeam(database);

    const input = {
      displayName: ' 新员工 ',
      feishu: {
        tenantKey: 'tenant-test',
        openId: 'open-new',
        userId: 'user-new',
      },
      roles: ['pre_sales'] as const,
      teamIds: ['team-sales'],
      leaderTeamIds: ['team-sales'],
      permissionOverrides: [
        {
          permission: 'ORDER_CONFIRM',
          effect: 'DENY',
          reason: '培训期',
        },
      ] as const,
    };
    const command = {
      actor: {
        staffId: 'staff-owner',
        displayName: '管理员',
        roles: ['owner'] as const,
      },
      idempotencyKey: 'staff:provision:0001',
      requestId: 'request-1',
      now: 2000,
    };

    const first = await provisionStaff(database, input, command);
    expect(first.replayed).toBe(false);

    const replay = await provisionStaff(database, input, {
      ...command,
      now: 2100,
    });
    expect(replay).toEqual({
      ...first,
      replayed: true,
    });

    const context = await resolveStaffAuthorizationByFeishu(database, {
      tenantKey: 'tenant-test',
      openId: 'open-new',
    });
    expect(context?.displayName).toBe('新员工');
    expect(context?.roles).toEqual(new Set(['pre_sales']));
    expect(context?.leaderTeamIds).toEqual(['team-sales']);
    expect(context?.permissions.has('TASK_ASSIGN_TEAM')).toBe(true);
    expect(context?.permissions.has('ORDER_CONFIRM')).toBe(false);

    const counts = await database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM staff_users
          WHERE id=?) AS staff_count,
        (SELECT COUNT(*) FROM staff_authorization_events
          WHERE staff_id=?) AS authorization_events,
        (SELECT COUNT(*) FROM audit_events
          WHERE aggregate_type='STAFF' AND aggregate_id=?) AS audits,
        (SELECT COUNT(*) FROM integration_outbox
          WHERE aggregate_type='STAFF' AND aggregate_id=?) AS outbox_events,
        (SELECT COUNT(*) FROM command_idempotency_records
          WHERE action='PROVISION_STAFF'
            AND status='COMMITTED') AS committed_commands
    `).bind(
      first.staff_id,
      first.staff_id,
      first.staff_id,
      first.staff_id,
    ).first<{
      staff_count: number;
      authorization_events: number;
      audits: number;
      outbox_events: number;
      committed_commands: number;
    }>();

    expect(counts).toEqual({
      staff_count: 1,
      authorization_events: 1,
      audits: 1,
      outbox_events: 1,
      committed_commands: 1,
    });
  });

  it('rejects non-owner actors, invalid leader scope, and duplicate Feishu identity', async () => {
    database = createMigratedTestDatabase();
    seedOwnerAndTeam(database);

    const baseInput = {
      displayName: '员工',
      feishu: {
        tenantKey: 'tenant-test',
        openId: 'open-duplicate',
        userId: null,
      },
      roles: ['pre_sales'] as const,
      teamIds: ['team-sales'],
      leaderTeamIds: [] as string[],
      permissionOverrides: [],
    };

    await expect(provisionStaff(database, baseInput, {
      actor: {
        staffId: 'staff-not-owner',
        displayName: '普通员工',
        roles: ['pre_sales'],
      },
      idempotencyKey: 'staff:provision:0002',
      now: 2000,
    })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });

    await expect(provisionStaff(database, {
      ...baseInput,
      feishu: {
        ...baseInput.feishu,
        openId: 'open-invalid-leader',
      },
      teamIds: [],
      leaderTeamIds: ['team-sales'],
    }, {
      actor: ownerActor(),
      idempotencyKey: 'staff:provision:0003',
      now: 2000,
    })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });

    await provisionStaff(database, baseInput, {
      actor: ownerActor(),
      idempotencyKey: 'staff:provision:0004',
      now: 2000,
    });

    await expect(provisionStaff(database, {
      ...baseInput,
      displayName: '另一个员工',
    }, {
      actor: ownerActor(),
      idempotencyKey: 'staff:provision:0005',
      now: 2100,
    })).rejects.toMatchObject({
      code: 'IDENTITY_CONFLICT',
      status: 409,
    });
  });

  it('rejects the same idempotency key with a different request', async () => {
    database = createMigratedTestDatabase();
    seedOwnerAndTeam(database);

    const command = {
      actor: ownerActor(),
      idempotencyKey: 'staff:provision:0006',
      now: 2000,
    };
    const input = {
      displayName: '员工一',
      feishu: {
        tenantKey: 'tenant-test',
        openId: 'open-one',
        userId: null,
      },
      roles: ['pre_sales'] as const,
      teamIds: ['team-sales'],
      leaderTeamIds: [] as string[],
      permissionOverrides: [],
    };

    await provisionStaff(database, input, command);

    await expect(provisionStaff(database, {
      ...input,
      displayName: '员工二',
    }, {
      ...command,
      now: 2100,
    })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
      status: 409,
    });
  });
});

function seedOwnerAndTeam(database: SqliteDatabase): void {
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

    INSERT INTO staff_users (
      id, display_name, status, authorization_version,
      version, created_at, updated_at, disabled_at
    ) VALUES (
      'staff-owner', '管理员', 'ACTIVE', 1,
      1, 1000, 1000, NULL
    );

    INSERT INTO staff_role_assignments (
      staff_id, role_code, status, assigned_by_staff_id,
      assigned_at, revoked_at, created_at, updated_at
    ) VALUES (
      'staff-owner', 'owner', 'ACTIVE', NULL,
      1000, NULL, 1000, 1000
    );
  `);
}

function ownerActor() {
  return {
    staffId: 'staff-owner',
    displayName: '管理员',
    roles: ['owner'] as const,
  };
}
