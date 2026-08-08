import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteDatabase } from '@ygb/testkit';

let database: SqliteDatabase|null = null;
afterEach(() => { database?.close(); database = null; });

describe('Migration 0036 acquisition guarded upgrade', () => {
  it('upgrades schema 35, preserves Personal DENY rows and installs strict facts', () => {
    database = new SqliteDatabase();
    applyThrough(database, 35);
    database.exec(`
      INSERT INTO staff_users (id,display_name,status,authorization_version,version,
        created_at,updated_at,disabled_at,session_version)
      VALUES ('m14-staff','M14','ACTIVE',1,1,1000,1000,NULL,1);
      INSERT INTO staff_permission_overrides (staff_id,permission_code,effect,status,
        reason,assigned_by_staff_id,assigned_at,revoked_at,created_at,updated_at)
      VALUES ('m14-staff','FINANCIAL_VIEW','DENY','ACTIVE','test',NULL,
        1000,NULL,1000,1000);
    `);
    apply(database, '0036_staff_acquisition_funnel_workbench.sql');
    expect(database.raw.prepare(`SELECT schema_version FROM app_schema_state
      WHERE singleton_id=1`).get()).toEqual({ schema_version: 36 });
    expect(database.raw.prepare(`SELECT permission_code,effect,status
      FROM staff_permission_overrides WHERE staff_id='m14-staff'`).get())
      .toEqual({ permission_code: 'FINANCIAL_VIEW', effect: 'DENY', status: 'ACTIVE' });
    expect(database.raw.prepare(`SELECT role_code,permission_code
      FROM acquisition_role_permission_defaults ORDER BY role_code,permission_code`).all())
      .toEqual([
        { role_code: 'owner', permission_code: 'ACQUISITION_ADMIN' },
        { role_code: 'owner', permission_code: 'ACQUISITION_BUYER_LEAD' },
        { role_code: 'owner', permission_code: 'ACQUISITION_SELLER_LEAD' },
        { role_code: 'pre_sales', permission_code: 'ACQUISITION_BUYER_LEAD' },
        { role_code: 'seller_ops', permission_code: 'ACQUISITION_SELLER_LEAD' },
      ]);
    expect(database.raw.prepare('PRAGMA integrity_check').get())
      .toEqual({ integrity_check: 'ok' });
    expect(database.raw.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('rejects wrong order and repeat without partial DDL', () => {
    database = new SqliteDatabase();
    applyThrough(database, 34);
    expect(() => apply(database!, '0036_staff_acquisition_funnel_workbench.sql'))
      .toThrow(/transaction_assertion_failed/iu);
    expect(database.raw.prepare(`SELECT name FROM sqlite_schema
      WHERE name='acquisition_channels'`).get()).toBeUndefined();
    expect(database.raw.prepare(`SELECT schema_version FROM app_schema_state
      WHERE singleton_id=1`).get()).toEqual({ schema_version: 34 });

    apply(database, '0035_staff_four_role_consolidation.sql');
    apply(database, '0036_staff_acquisition_funnel_workbench.sql');
    expect(() => apply(database!, '0036_staff_acquisition_funnel_workbench.sql'))
      .toThrow(/transaction_assertion_failed/iu);
    expect(database.raw.prepare(`SELECT schema_version FROM app_schema_state
      WHERE singleton_id=1`).get()).toEqual({ schema_version: 36 });
    expect(database.raw.prepare('PRAGMA integrity_check').get())
      .toEqual({ integrity_check: 'ok' });
  });
});

function migrationFiles(): string[] {
  return readdirSync(path.resolve(process.cwd(),'migrations'))
    .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name)).sort();
}
function applyThrough(db: SqliteDatabase, count: number): void {
  for (const name of migrationFiles().slice(0,count)) apply(db,name);
}
function apply(db: SqliteDatabase, name: string): void {
  db.exec('BEGIN IMMEDIATE;');
  try {
    db.exec(readFileSync(path.resolve(process.cwd(),'migrations',name),'utf8'));
    db.exec('COMMIT;');
  } catch (error) {
    try { db.exec('ROLLBACK;'); } catch { /* already rolled back */ }
    throw error;
  }
}
