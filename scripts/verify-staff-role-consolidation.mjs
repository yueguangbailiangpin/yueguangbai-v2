import { DatabaseSync } from 'node:sqlite';
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const migrationsDirectory = path.join(root, 'migrations');
const migrations = readdirSync(migrationsDirectory)
  .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name))
  .sort();
const work = mkdtempSync(path.join(tmpdir(), 'ygb-role-consolidation-'));

try {
  assert(migrations.length === 35, 'expected 35 migrations');
  assert(
    migrations.at(-1) === '0035_staff_four_role_consolidation.sql',
    '0035 ownership drift',
  );

  const fresh = open(':memory:');
  apply(fresh, migrations);
  assert(schemaVersion(fresh) === 35, 'fresh schema is not 35');
  assertHealthy(fresh, 'fresh');
  fresh.close();

  const sourcePath = path.join(work, 'schema34.sqlite');
  const backupPath = path.join(work, 'schema34.backup.sqlite');
  const restorePath = path.join(work, 'schema34.restored.sqlite');
  let upgrade = open(sourcePath);
  apply(upgrade, migrations.slice(0, 34));
  seedSchema34(upgrade);
  upgrade.close();
  copyFileSync(sourcePath, backupPath);

  upgrade = open(sourcePath);
  run(upgrade, migrations[34]);
  assert(schemaVersion(upgrade) === 35, '34 -> 35 failed');
  assertRole(upgrade, 'after-staff', 'buyer_refund');
  assert(
    scalar(upgrade, `SELECT COUNT(*) FROM staff_role_assignments
      WHERE staff_id='after-staff' AND role_code='after_sales'
        AND status='REVOKED' AND revoked_reason='STAFF_ROLE_CONSOLIDATION'`) === 1,
    'after_sales history not retained',
  );
  assert(
    scalar(upgrade, `SELECT COUNT(*) FROM staff_sessions
      WHERE staff_id='after-staff' AND status='REVOKED'
        AND revoked_reason='STAFF_ROLE_CONSOLIDATION'`) === 1,
    'pre-cutover session not revoked',
  );
  assertHealthy(upgrade, 'upgrade');
  forwardRepair(upgrade);
  assertRole(upgrade, 'after-staff', 'pre_sales');
  assert(
    scalar(upgrade, `SELECT COUNT(*) FROM staff_role_assignments
      WHERE staff_id='after-staff' AND role_code='buyer_refund'
        AND status='REVOKED' AND revoked_reason='FORWARD_ROLE_REPAIR'`) === 1,
    'forward repair lost post-cutover history',
  );
  assertHealthy(upgrade, 'forward-repair');
  upgrade.close();

  copyFileSync(backupPath, restorePath);
  const restored = open(restorePath);
  assert(schemaVersion(restored) === 34, 'pre-cutover restore schema drift');
  assertRole(restored, 'after-staff', 'after_sales');
  assert(
    scalar(restored, `SELECT COUNT(*) FROM staff_sessions
      WHERE staff_id='after-staff' AND status='ACTIVE'`) === 1,
    'pre-cutover restore did not restore session state',
  );
  assertHealthy(restored, 'pre-cutover-restore');
  restored.close();

  const wrongOrder = open(':memory:');
  apply(wrongOrder, migrations.slice(0, 33));
  expectGuardFailure(wrongOrder, migrations[34], 'wrong-order');
  assert(schemaVersion(wrongOrder) === 33, 'wrong-order changed schema');
  assert(
    !objectExists(wrongOrder, 'staff_role_consolidation_cutovers'),
    'wrong-order left partial DDL',
  );
  wrongOrder.close();

  const repeated = open(':memory:');
  apply(repeated, migrations);
  expectGuardFailure(repeated, migrations[34], 'repeat');
  assert(schemaVersion(repeated) === 35, 'repeat changed schema');
  assertHealthy(repeated, 'repeat');
  repeated.close();

  console.log(JSON.stringify({
    status: 'PASS',
    migration: '0035_staff_four_role_consolidation.sql',
    fresh_schema: 35,
    upgrade: '34 -> 35',
    wrong_order_rejected: true,
    repeat_rejected: true,
    partial_ddl_rolled_back: true,
    pre_cutover_restore: true,
    post_cutover_forward_repair: true,
    production_data_read: false,
  }, null, 2));
} finally {
  rmSync(work, { recursive: true, force: true });
}

function open(file) {
  const database = new DatabaseSync(file);
  database.exec('PRAGMA foreign_keys=ON;');
  return database;
}

function apply(database, names) {
  for (const name of names) run(database, name);
}

function run(database, name) {
  database.exec('BEGIN IMMEDIATE;');
  try {
    database.exec(readFileSync(path.join(migrationsDirectory, name), 'utf8'));
    database.exec('COMMIT;');
  } catch (error) {
    try { database.exec('ROLLBACK;'); } catch { /* no open transaction */ }
    throw error;
  }
}

function expectGuardFailure(database, name, label) {
  try {
    run(database, name);
  } catch (error) {
    assert(String(error).includes('transaction_assertion_failed'), `${label} wrong error`);
    return;
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

function seedSchema34(database) {
  database.exec(`
    INSERT INTO staff_users (
      id,display_name,status,authorization_version,version,
      created_at,updated_at,disabled_at
    ) VALUES
      ('owner-staff','Owner','ACTIVE',1,1,1000,1000,NULL),
      ('after-staff','After','ACTIVE',1,1,1000,1000,NULL);
    INSERT INTO staff_role_assignments (
      staff_id,role_code,status,assigned_by_staff_id,assigned_at,
      revoked_at,created_at,updated_at
    ) VALUES
      ('owner-staff','owner','ACTIVE',NULL,1000,NULL,1000,1000),
      ('after-staff','after_sales','ACTIVE','owner-staff',1000,NULL,1000,1000);
    INSERT INTO staff_sessions (
      id,token_hash,staff_id,issued_session_version,
      issued_authorization_version,status,expires_at,revoked_at,
      revoked_reason,created_at,updated_at
    ) VALUES (
      'session-after-staff','${'a'.repeat(64)}','after-staff',1,1,
      'ACTIVE',9999999999999,NULL,NULL,1000,1000
    );
  `);
}

function forwardRepair(database) {
  const now = Date.now();
  database.exec('BEGIN IMMEDIATE;');
  try {
    database.prepare(`
      UPDATE staff_role_assignments
      SET status='REVOKED',revoked_at=?,revoked_by_staff_id='owner-staff',
        revoked_reason='FORWARD_ROLE_REPAIR',updated_at=?
      WHERE staff_id='after-staff' AND status='ACTIVE'
    `).run(now, now);
    database.prepare(`
      INSERT INTO staff_role_assignments (
        staff_id,role_code,status,assigned_by_staff_id,assigned_at,
        revoked_at,revoked_by_staff_id,revoked_reason,created_at,updated_at
      ) VALUES (
        'after-staff','pre_sales','ACTIVE','owner-staff',?,
        NULL,NULL,NULL,?,?
      )
    `).run(now, now, now);
    database.prepare(`
      UPDATE staff_users
      SET authorization_version=authorization_version+1,
        session_version=session_version+1,version=version+1,updated_at=?
      WHERE id='after-staff'
    `).run(now);
    database.exec(`
      INSERT INTO transaction_assertions(assertion_value)
      SELECT CASE WHEN 1=(
        SELECT COUNT(*) FROM staff_role_assignments
        WHERE staff_id='after-staff' AND status='ACTIVE'
          AND role_code='pre_sales'
      ) THEN 1 ELSE 0 END;
    `);
    database.exec('COMMIT;');
  } catch (error) {
    database.exec('ROLLBACK;');
    throw error;
  }
}

function assertRole(database, staffId, role) {
  assert(
    scalar(database, `SELECT COUNT(*) FROM staff_role_assignments
      WHERE staff_id='${staffId}' AND role_code='${role}' AND status='ACTIVE'`) === 1,
    `${staffId} active role mismatch`,
  );
}

function schemaVersion(database) {
  return Number(database.prepare(`
    SELECT schema_version FROM app_schema_state WHERE singleton_id=1
  `).get()?.schema_version);
}

function scalar(database, sql) {
  return Number(Object.values(database.prepare(sql).get())[0]);
}

function objectExists(database, name) {
  return Boolean(database.prepare(`
    SELECT 1 FROM sqlite_schema WHERE name=?
  `).get(name));
}

function assertHealthy(database, label) {
  assert(database.prepare('PRAGMA integrity_check').get().integrity_check === 'ok', `${label} integrity`);
  assert(database.prepare('PRAGMA foreign_key_check').all().length === 0, `${label} foreign keys`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
