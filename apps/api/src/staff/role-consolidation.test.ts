import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteDatabase } from '@ygb/testkit';
import type { StaffPermissionCode } from '@ygb/contracts';
import {
  approveStaffRoleConsolidationPlan,
  buildStaffRoleConsolidationPlans,
} from './role-consolidation';

const migrationsDirectory = path.resolve(process.cwd(), 'migrations');
const migrations = readdirSync(migrationsDirectory)
  .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name))
  .sort();
let database: SqliteDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe('staff four-role consolidation planning and approval', () => {
  it('calculates exact support-role permission differences, DENY and team scope', async () => {
    database = schema34();
    seedOwner(database);
    seedTeam(database);
    insertStaff(database, 'support-staff', 'buyer_support');
    database.exec(`
      INSERT INTO staff_team_memberships (
        staff_id,team_id,status,joined_at,ended_at,created_at,updated_at
      ) VALUES ('support-staff','team-role','ACTIVE',1000,NULL,1000,1000);
      INSERT INTO staff_team_leaders (
        staff_id,team_id,status,assigned_by_staff_id,assigned_at,revoked_at,
        created_at,updated_at
      ) VALUES (
        'support-staff','team-role','ACTIVE','owner-staff',1000,NULL,1000,1000
      );
      INSERT INTO staff_permission_overrides (
        staff_id,permission_code,effect,status,reason,assigned_by_staff_id,
        assigned_at,revoked_at,created_at,updated_at
      ) VALUES
        ('support-staff','ORDER_CONFIRM','DENY','ACTIVE','bounded deny',
          'owner-staff',1000,NULL,1000,1000),
        ('support-staff','FINANCIAL_VIEW','GRANT','ACTIVE','must hard deny',
          'owner-staff',1000,NULL,1000,1000);
    `);

    const plan = (await buildStaffRoleConsolidationPlans(database))
      .find((candidate) => candidate.staffId === 'support-staff');
    expect(plan).toMatchObject({
      sourceRoles: ['buyer_support'],
      targetRole: 'pre_sales',
      status: 'OWNER_APPROVAL_REQUIRED',
      approvalRequired: true,
      personalDenies: ['ORDER_CONFIRM'],
      scope: { memberTeamIds: ['team-role'], leaderTeamIds: ['team-role'] },
    });
    expect(plan?.addedPermissions).toEqual(expect.arrayContaining([
      'BUYER_CREATE',
      'BUYER_ACTIVATE_STANDARD',
      'RESERVATION_DECIDE',
    ]));
    expect(plan?.afterPermissions).not.toContain('ORDER_CONFIRM');
    expect(plan?.afterPermissions).not.toContain('FINANCIAL_VIEW');
    expect(plan?.afterPermissions).toEqual(expect.arrayContaining([
      'TASK_ASSIGN_TEAM',
      'TASK_REASSIGN_TEAM',
    ]));
    expect(plan?.mappingHash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('records one immutable owner approval and rejects a drifted plan hash', async () => {
    database = schema34();
    seedOwner(database);
    insertStaff(database, 'support-staff', 'seller_support');
    const plan = (await buildStaffRoleConsolidationPlans(database))
      .find((candidate) => candidate.staffId === 'support-staff')!;
    const actor = ownerActor();
    const result = await approveStaffRoleConsolidationPlan(database, {
      staffId: 'support-staff',
      targetRole: 'seller_ops',
      expectedMappingHash: plan.mappingHash!,
      actor,
      idempotencyKey: 'approve-support-role-1',
      now: 2000,
    });
    expect(result.mapping_hash).toBe(plan.mappingHash);
    expect(await database.prepare(`
      SELECT event_type,actor_id,json_extract(next_state_json,'$.target_role')
        AS target_role
      FROM audit_events WHERE id=?
    `).bind(result.approval_audit_event_id).first()).toEqual({
      event_type: 'STAFF_ROLE_MAPPING_APPROVED',
      actor_id: 'owner-staff',
      target_role: 'seller_ops',
    });

    database.exec(`
      UPDATE staff_users SET authorization_version=authorization_version+1
      WHERE id='support-staff';
    `);
    await expect(approveStaffRoleConsolidationPlan(database, {
      staffId: 'support-staff',
      targetRole: 'seller_ops',
      expectedMappingHash: plan.mappingHash!,
      actor,
      idempotencyKey: 'approve-support-role-2',
      now: 3000,
    })).rejects.toMatchObject({ code: 'PLAN_HASH_CHANGED' });
  });

  it('blocks zero, unknown-equivalent and unselected multi-role states', async () => {
    database = schema34();
    seedOwner(database);
    insertStaff(database, 'zero-role', null);
    insertStaff(database, 'multi-role', 'buyer_support');
    insertRole(database, 'multi-role', 'after_sales');
    const plans = await buildStaffRoleConsolidationPlans(database);
    expect(plans.find((plan) => plan.staffId === 'zero-role')).toMatchObject({
      status: 'BLOCKED', blockReason: 'ZERO_ACTIVE_ROLES', targetRole: null,
    });
    expect(plans.find((plan) => plan.staffId === 'multi-role')).toMatchObject({
      status: 'BLOCKED', blockReason: 'MULTI_ROLE_TARGET_REQUIRED', targetRole: null,
    });
  });
});

describe('Migration 0035 data cutover', () => {
  it('maps direct and approved roles, preserves history, bumps versions and revokes sessions', async () => {
    database = schema34();
    seedOwner(database);
    insertStaff(database, 'pre-staff', 'pre_sales');
    insertStaff(database, 'seller-staff', 'seller_ops');
    insertStaff(database, 'after-staff', 'after_sales');
    insertStaff(database, 'support-staff', 'buyer_support');
    insertStaff(database, 'multi-staff', 'seller_support');
    insertRole(database, 'multi-staff', 'after_sales');
    insertSession(database, 'after-staff', 'session-after-staff', 'a');
    insertSession(database, 'support-staff', 'session-support-staff', 'b');

    for (const [staffId, targetRole] of [
      ['support-staff', 'pre_sales'],
      ['multi-staff', 'buyer_refund'],
    ] as const) {
      const plan = (await buildStaffRoleConsolidationPlans(database, {
        [staffId]: targetRole,
      })).find((candidate) => candidate.staffId === staffId)!;
      await approveStaffRoleConsolidationPlan(database, {
        staffId,
        targetRole,
        expectedMappingHash: plan.mappingHash!,
        actor: ownerActor(),
        idempotencyKey: `approve-${staffId}`,
        now: 2000,
      });
    }

    runMigration(database, migrations[34]!);
    expect(schemaVersion(database)).toBe(35);
    const active = await database.prepare(`
      SELECT staff_id,role_code FROM staff_role_assignments
      WHERE status='ACTIVE' ORDER BY staff_id
    `).all();
    expect(active.results).toEqual([
      { staff_id: 'after-staff', role_code: 'buyer_refund' },
      { staff_id: 'multi-staff', role_code: 'buyer_refund' },
      { staff_id: 'owner-staff', role_code: 'owner' },
      { staff_id: 'pre-staff', role_code: 'pre_sales' },
      { staff_id: 'seller-staff', role_code: 'seller_ops' },
      { staff_id: 'support-staff', role_code: 'pre_sales' },
    ]);
    expect(await database.prepare(`
      SELECT role_code,status,revoked_by_staff_id,revoked_reason
      FROM staff_role_assignments
      WHERE staff_id='support-staff' AND role_code='buyer_support'
    `).first()).toEqual({
      role_code: 'buyer_support',
      status: 'REVOKED',
      revoked_by_staff_id: 'owner-staff',
      revoked_reason: 'STAFF_ROLE_CONSOLIDATION',
    });
    expect(await database.prepare(`
      SELECT authorization_version,session_version
      FROM staff_users WHERE id='after-staff'
    `).first()).toEqual({ authorization_version: 2, session_version: 2 });
    expect(await database.prepare(`
      SELECT status,revoked_reason FROM staff_sessions
      WHERE staff_id='after-staff'
    `).first()).toEqual({
      status: 'REVOKED', revoked_reason: 'STAFF_ROLE_CONSOLIDATION',
    });
    expect(await database.prepare(`
      SELECT COUNT(*) AS total FROM staff_authorization_events
      WHERE event_type='STAFF_ROLE_CONSOLIDATED'
    `).first()).toEqual({ total: 6 });
    await expect(database.prepare(`
      INSERT INTO staff_role_assignments (
        staff_id,role_code,status,assigned_by_staff_id,assigned_at,
        revoked_at,created_at,updated_at
      ) VALUES ('pre-staff','seller_ops','ACTIVE','owner-staff',3000,NULL,3000,3000)
    `).run()).rejects.toThrow();
  });

  it.each([
    ['unapproved support', (db: SqliteDatabase) =>
      insertStaff(db, 'blocked-staff', 'buyer_support')],
    ['multiple roles', (db: SqliteDatabase) => {
      insertStaff(db, 'blocked-staff', 'pre_sales');
      insertRole(db, 'blocked-staff', 'after_sales');
    }],
    ['zero roles', (db: SqliteDatabase) =>
      insertStaff(db, 'blocked-staff', null)],
  ])('fails closed for %s without partial DDL', async (_label, seed) => {
    database = schema34();
    seedOwner(database);
    seed(database);
    expect(() => runMigration(database!, migrations[34]!))
      .toThrow('transaction_assertion_failed');
    expect(schemaVersion(database)).toBe(34);
    expect(await database.prepare(`
      SELECT name FROM sqlite_schema
      WHERE name='staff_role_consolidation_cutovers'
    `).first()).toBeNull();
    expect(await database.prepare(`
      SELECT role_code,status FROM staff_role_assignments
      WHERE staff_id='blocked-staff' ORDER BY role_code
    `).all()).toMatchObject({ results: expect.any(Array) });
  });
});

function schema34(): SqliteDatabase {
  const result = new SqliteDatabase();
  for (const migration of migrations.slice(0, 34)) runMigration(result, migration);
  return result;
}

function runMigration(db: SqliteDatabase, name: string): void {
  db.exec('BEGIN IMMEDIATE;');
  try {
    db.exec(readFileSync(path.join(migrationsDirectory, name), 'utf8'));
    db.exec('COMMIT;');
  } catch (error) {
    try { db.exec('ROLLBACK;'); } catch { /* no open transaction */ }
    throw error;
  }
}

function schemaVersion(db: SqliteDatabase): number {
  return Number(db.raw.prepare(`
    SELECT schema_version FROM app_schema_state WHERE singleton_id=1
  `).get()?.['schema_version']);
}

function seedOwner(db: SqliteDatabase): void {
  insertStaff(db, 'owner-staff', 'owner');
}

function insertStaff(
  db: SqliteDatabase,
  staffId: string,
  role: string | null,
): void {
  db.exec(`
    INSERT INTO staff_users (
      id,display_name,status,authorization_version,version,
      created_at,updated_at,disabled_at
    ) VALUES ('${staffId}','${staffId}','ACTIVE',1,1,1000,1000,NULL);
  `);
  if (role) insertRole(db, staffId, role);
}

function insertRole(db: SqliteDatabase, staffId: string, role: string): void {
  db.exec(`
    INSERT INTO staff_role_assignments (
      staff_id,role_code,status,assigned_by_staff_id,assigned_at,
      revoked_at,created_at,updated_at
    ) VALUES (
      '${staffId}','${role}','ACTIVE',
      ${staffId === 'owner-staff' ? 'NULL' : "'owner-staff'"},
      1000,NULL,1000,1000
    );
  `);
}

function insertSession(
  db: SqliteDatabase,
  staffId: string,
  sessionId: string,
  hashCharacter: string,
): void {
  db.exec(`
    INSERT INTO staff_sessions (
      id,token_hash,staff_id,issued_session_version,
      issued_authorization_version,status,expires_at,revoked_at,
      revoked_reason,created_at,updated_at
    ) VALUES (
      '${sessionId}','${hashCharacter.repeat(64)}','${staffId}',1,1,
      'ACTIVE',9999999999999,NULL,NULL,1000,1000
    );
  `);
}

function seedTeam(db: SqliteDatabase): void {
  db.exec(`
    INSERT INTO staff_departments (
      id,code,name,status,version,created_at,updated_at,disabled_at
    ) VALUES ('department-role','role','Role','ACTIVE',1,1000,1000,NULL);
    INSERT INTO staff_teams (
      id,department_id,code,name,status,version,created_at,updated_at,disabled_at
    ) VALUES (
      'team-role','department-role','role','Role','ACTIVE',1,1000,1000,NULL
    );
  `);
}

function ownerActor() {
  const permissions = new Set<StaffPermissionCode>([
    'STAFF_MANAGE',
    'PERMISSION_MANAGE',
  ]);
  return {
    staffId: 'owner-staff',
    displayName: 'Owner',
    staffStatus: 'ACTIVE' as const,
    authorizationVersion: 1,
    roles: new Set(['owner'] as const),
    permissions,
    memberTeamIds: [],
    leaderTeamIds: [],
  };
}
