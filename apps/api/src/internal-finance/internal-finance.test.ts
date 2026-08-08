import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createMigratedTestDatabase,
  SqliteDatabase,
} from '@ygb/testkit';
import type {
  StaffPermissionCode,
  StaffRoleCode,
} from '@ygb/contracts';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { calculateEffectiveStaffAuthorization } from '../staff/authorization-policy';
import { requireFinancialActor } from './shared';

let database: SqliteDatabase | null = null;
afterEach(() => {
  database?.close();
  database = null;
});

describe('Wave 12 migration and authorization boundaries', () => {
  it('preserves Wave 12 finance authority on schema 28', async () => {
    database = createMigratedTestDatabase();
    const schema = await database.prepare(`
      SELECT schema_version FROM app_schema_state WHERE singleton_id=1
    `).first<{ schema_version: number }>();
    expect(Number(schema?.schema_version)).toBe(37);
    const objects = await database.prepare(`
      SELECT type, name FROM sqlite_schema
      WHERE name IN (
        'internal_order_finance_positions','internal_finance_exceptions',
        'internal_finance_cash_movements','financial_export_events',
        'trg_financial_export_events_no_update',
        'trg_financial_export_events_no_delete'
      ) ORDER BY name
    `).all();
    expect(objects.results).toHaveLength(6);
    const defaults = await database.prepare(`
      SELECT role_code FROM staff_assignment_role_permission_defaults
      WHERE permission_code='FINANCIAL_VIEW' ORDER BY role_code
    `).all<{ role_code: string }>();
    expect(defaults.results).toEqual([{ role_code: 'owner' }]);
  });

  it('preserves every override and role default through the 0025 rebuild', async () => {
    database = new SqliteDatabase();
    applyMigrationsThrough(database, 24);
    database.exec(`
      INSERT INTO staff_users (
        id, display_name, status, authorization_version, version,
        created_at, updated_at, disabled_at
      ) VALUES
        ('legacy-staff','Legacy Staff','ACTIVE',1,1,1,1,NULL),
        ('legacy-owner','Legacy Owner','ACTIVE',1,1,1,1,NULL);
      INSERT INTO staff_permission_overrides (
        staff_id, permission_code, effect, status, reason,
        assigned_by_staff_id, assigned_at, revoked_at, created_at, updated_at
      ) VALUES
        ('legacy-staff','BUYER_VIEW','DENY','REVOKED','historical deny',
          'legacy-owner',10,20,10,20),
        ('legacy-staff','SELLER_VIEW','GRANT','ACTIVE',NULL,
          'legacy-owner',11,NULL,11,11);
    `);
    const legacyOverrides = database.raw.prepare(`
      SELECT staff_id, permission_code, effect, status, reason,
        assigned_by_staff_id, assigned_at, revoked_at, created_at, updated_at
      FROM staff_permission_overrides
      ORDER BY staff_id, permission_code
    `).all();
    const legacyDefaults = database.raw.prepare(`
      SELECT role_code, permission_code, created_at
      FROM staff_assignment_role_permission_defaults
      ORDER BY role_code, permission_code
    `).all();
    const dependentViews = database.raw.prepare(`
      SELECT name FROM sqlite_schema
      WHERE type='view'
        AND sql LIKE '%staff_assignment_role_permission_defaults%'
      ORDER BY name
    `).all() as { name: string }[];

    applyMigration(database, '0025_internal_finance_reporting.sql');
    applyMigration(database, '0026_financial_export_audit.sql');

    const rebuiltOverrides = database.raw.prepare(`
      SELECT staff_id, permission_code, effect, status, reason,
        assigned_by_staff_id, assigned_at, revoked_at, created_at, updated_at
      FROM staff_permission_overrides
      ORDER BY staff_id, permission_code
    `).all();
    expect(rebuiltOverrides).toEqual(legacyOverrides);

    const rebuiltLegacyDefaults = database.raw.prepare(`
      SELECT role_code, permission_code, created_at
      FROM staff_assignment_role_permission_defaults
      WHERE permission_code<>'FINANCIAL_VIEW'
      ORDER BY role_code, permission_code
    `).all();
    expect(rebuiltLegacyDefaults).toEqual(legacyDefaults);
    expect(database.raw.prepare(`
      SELECT role_code FROM staff_assignment_role_permission_defaults
      WHERE permission_code='FINANCIAL_VIEW' ORDER BY role_code
    `).all()).toEqual([{ role_code: 'owner' }]);
    expect(database.raw.prepare(`
      SELECT role_code FROM staff_assignment_role_permission_defaults
      WHERE permission_code='FINANCIAL_EXPORT' ORDER BY role_code
    `).all()).toEqual([{ role_code: 'owner' }]);

    expect(database.raw.prepare(`
      SELECT name FROM sqlite_schema
      WHERE type='index'
        AND name='idx_staff_permission_override_effect_status'
    `).get()).toEqual({
      name: 'idx_staff_permission_override_effect_status',
    });
    await expect(database.prepare(`
      INSERT INTO staff_permission_overrides (
        staff_id, permission_code, effect, status, reason,
        assigned_by_staff_id, assigned_at, revoked_at, created_at, updated_at
      ) VALUES (
        'legacy-staff','BUYER_VIEW','GRANT','ACTIVE',NULL,
        'legacy-owner',30,NULL,30,30
      )
    `).run()).rejects.toThrow();
    await expect(database.prepare(`
      INSERT INTO staff_permission_overrides (
        staff_id, permission_code, effect, status, reason,
        assigned_by_staff_id, assigned_at, revoked_at, created_at, updated_at
      ) VALUES (
        'legacy-staff','PRODUCT_VIEW','GRANT','ACTIVE',NULL,
        'legacy-owner',30,31,30,31
      )
    `).run()).rejects.toThrow();
    await expect(database.prepare(`
      INSERT INTO staff_permission_overrides (
        staff_id, permission_code, effect, status, reason,
        assigned_by_staff_id, assigned_at, revoked_at, created_at, updated_at
      ) VALUES (
        'legacy-staff','PRODUCT_EDIT','ALLOW','ACTIVE',NULL,
        'legacy-owner',32,NULL,32,32
      )
    `).run()).rejects.toThrow();
    await expect(database.prepare(`
      INSERT INTO staff_permission_overrides (
        staff_id, permission_code, effect, status, reason,
        assigned_by_staff_id, assigned_at, revoked_at, created_at, updated_at
      ) VALUES (
        'legacy-staff','PRODUCT_EDIT','GRANT','UNKNOWN',NULL,
        'legacy-owner',33,NULL,33,33
      )
    `).run()).rejects.toThrow();

    await database.prepare(`
      INSERT INTO staff_permission_overrides (
        staff_id, permission_code, effect, status, reason,
        assigned_by_staff_id, assigned_at, revoked_at, created_at, updated_at
      ) VALUES (
        'legacy-staff','FINANCIAL_VIEW','DENY','ACTIVE','owner-only guard',
        'legacy-owner',34,NULL,34,34
      )
    `).run();
    expect(await database.prepare(`
      SELECT permission_code, effect, status
      FROM staff_permission_overrides
      WHERE staff_id='legacy-staff' AND permission_code='FINANCIAL_VIEW'
    `).first()).toEqual({
      permission_code: 'FINANCIAL_VIEW',
      effect: 'DENY',
      status: 'ACTIVE',
    });

    const rebuiltViews = database.raw.prepare(`
      SELECT name FROM sqlite_schema
      WHERE type='view'
        AND sql LIKE '%staff_assignment_role_permission_defaults%'
      ORDER BY name
    `).all() as { name: string }[];
    expect(rebuiltViews).toEqual(dependentViews);
    for (const view of rebuiltViews) {
      const quoted = view.name.replaceAll('"', '""');
      expect(() => database!.raw.prepare(
        `SELECT * FROM "${quoted}" LIMIT 1`,
      ).all()).not.toThrow();
    }
    expect(database.raw.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(database.raw.prepare('PRAGMA integrity_check').get())
      .toEqual({ integrity_check: 'ok' });
    expect(database.raw.prepare(`
      SELECT schema_version FROM app_schema_state WHERE singleton_id=1
    `).get()).toEqual({ schema_version: 26 });
  });

  it('keeps export events immutable', async () => {
    database = createMigratedTestDatabase();
    await database.prepare(`
      INSERT INTO staff_users (
        id, display_name, status, authorization_version, version,
        created_at, updated_at, disabled_at
      ) VALUES ('finance-owner','Owner','ACTIVE',1,1,1,1,NULL)
    `).run();
    await database.prepare(`
      INSERT INTO financial_export_events (
        id, export_type, requested_by_staff_id, filter_json, filter_hash,
        data_as_of, row_count, output_byte_length, output_sha256,
        request_id, generated_at, created_at
      ) VALUES (
        'export-immutable-0001','ORDER_DETAIL','finance-owner','{}',
        ?,1,0,1,?,'request-1',1,1
      )
    `).bind('a'.repeat(64), 'b'.repeat(64)).run();
    await expect(database.prepare(`
      UPDATE financial_export_events SET row_count=1
      WHERE id='export-immutable-0001'
    `).run()).rejects.toThrow('financial_export_events_are_immutable');
    await expect(database.prepare(`
      DELETE FROM financial_export_events WHERE id='export-immutable-0001'
    `).run()).rejects.toThrow('financial_export_events_are_immutable');
  });

  it('requires owner, FINANCIAL_VIEW and honors personal DENY', () => {
    const owner = actor(['owner'], ['FINANCIAL_VIEW', 'FINANCIAL_EXPORT']);
    expect(requireFinancialActor(owner)).toBe(owner);
    expect(requireFinancialActor(owner, { export: true })).toBe(owner);

    const nonOwnerEffective = calculateEffectiveStaffAuthorization({
      roles: new Set<StaffRoleCode>(['seller_ops']),
      grants: new Set<StaffPermissionCode>(['FINANCIAL_VIEW']),
      denies: new Set<StaffPermissionCode>(),
      memberTeamIds: ['team'],
      leaderTeamIds: [],
    });
    expect(nonOwnerEffective.permissions.has('FINANCIAL_VIEW')).toBe(false);

    const denied = actor(['owner'], ['FINANCIAL_EXPORT']);
    expect(() => requireFinancialActor(denied)).toThrow('FORBIDDEN');
    expect(() => requireFinancialActor(undefined)).toThrow('UNAUTHENTICATED');
  });
});

function applyMigrationsThrough(
  target: SqliteDatabase,
  maximumVersion: number,
): void {
  const directory = path.resolve(process.cwd(), 'migrations');
  const files = readdirSync(directory)
    .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name))
    .sort()
    .filter((name) => Number(name.slice(0, 4)) <= maximumVersion);
  for (const file of files) applyMigration(target, file);
}

function applyMigration(target: SqliteDatabase, file: string): void {
  const migrationPath = path.resolve(process.cwd(), 'migrations', file);
  target.exec('BEGIN IMMEDIATE;');
  try {
    target.exec(readFileSync(migrationPath, 'utf8'));
    target.exec('COMMIT;');
  } catch (error) {
    try {
      target.exec('ROLLBACK;');
    } catch {
      // SQLite may already have rolled back the failed statement.
    }
    throw error;
  }
}

function actor(
  roles: readonly StaffRoleCode[],
  permissions: readonly StaffPermissionCode[],
): AssignmentStaffAuthorization {
  return {
    staffId: 'staff',
    displayName: 'Staff',
    staffStatus: 'ACTIVE',
    authorizationVersion: 1,
    roles: new Set(roles),
    permissions: new Set(permissions),
    memberTeamIds: [],
    leaderTeamIds: [],
  };
}
