import { DatabaseSync } from 'node:sqlite';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const migrationsDirectory = path.join(root, 'migrations');
const workDirectory = mkdtempSync(path.join(tmpdir(), 'ygb-phase3h-migration-'));
const migrationFiles = readdirSync(migrationsDirectory)
  .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name))
  .sort();

function openDatabase(name) {
  const database = new DatabaseSync(path.join(workDirectory, name));
  database.exec('PRAGMA foreign_keys=ON;');
  return database;
}
function readMigration(name) {
  return readFileSync(path.join(migrationsDirectory, name), 'utf8');
}
function applyOne(database, name) {
  database.exec('BEGIN IMMEDIATE;');
  try {
    database.exec(readMigration(name));
    database.exec('COMMIT;');
  } catch (error) {
    database.exec('ROLLBACK;');
    throw error;
  }
}
function apply(database, names) {
  for (const name of names) applyOne(database, name);
}
function schemaVersion(database) {
  return Number(database.prepare(`
    SELECT schema_version FROM app_schema_state WHERE singleton_id=1
  `).get()?.schema_version);
}
function expectFailure(operation, expected, label) {
  let error = null;
  try { operation(); } catch (caught) { error = caught; }
  if (!error || !String(error).includes(expected)) {
    throw new Error(`${label}: expected ${expected}, got ${String(error)}`);
  }
}
function names(database, type) {
  return new Set(database.prepare(`
    SELECT name FROM sqlite_schema WHERE type=?
  `).all(type).map((row) => String(row.name)));
}

try {
  if (migrationFiles.length !== 20
    || migrationFiles.at(-1) !== '0020_staff_assignment_rules.sql') {
    throw new Error(`expected 0001-0020, got ${migrationFiles.join(',')}`);
  }

  const upgraded = openDatabase('upgraded.sqlite');
  try {
    apply(upgraded, migrationFiles.slice(0, 19));
    if (schemaVersion(upgraded) !== 19) throw new Error('baseline is not schema 19');
    upgraded.exec(`
      INSERT INTO staff_departments (
        id, code, name, status, version, created_at, updated_at, disabled_at
      ) VALUES ('phase3h-dept','phase3h','Phase 3H','ACTIVE',1,1,1,NULL);
      INSERT INTO staff_teams (
        id, department_id, code, name, status, version,
        created_at, updated_at, disabled_at
      ) VALUES ('phase3h-team','phase3h-dept','phase3h','Phase 3H',
        'ACTIVE',1,1,1,NULL);
      INSERT INTO staff_users (
        id, display_name, status, authorization_version, version,
        created_at, updated_at, disabled_at
      ) VALUES ('phase3h-staff','Phase 3H Staff','ACTIVE',1,1,1,1,NULL);
      INSERT INTO staff_role_assignments (
        staff_id, role_code, status, assigned_by_staff_id,
        assigned_at, revoked_at, created_at, updated_at
      ) VALUES ('phase3h-staff','pre_sales','ACTIVE',NULL,1,NULL,1,1);
      INSERT INTO staff_team_memberships (
        staff_id, team_id, status, joined_at, ended_at, created_at, updated_at
      ) VALUES ('phase3h-staff','phase3h-team','ACTIVE',1,NULL,1,1);
      INSERT INTO staff_permission_overrides (
        staff_id, permission_code, effect, status, reason,
        assigned_by_staff_id, assigned_at, revoked_at, created_at, updated_at
      ) VALUES ('phase3h-staff','RESERVATION_DECIDE','DENY','ACTIVE',
        'migration preservation probe',NULL,1,NULL,1,1);
    `);
    applyOne(upgraded, '0020_staff_assignment_rules.sql');
    if (schemaVersion(upgraded) !== 20) throw new Error('schema target is not 20');

    const override = upgraded.prepare(`
      SELECT effect, status FROM staff_permission_overrides
      WHERE staff_id='phase3h-staff' AND permission_code='RESERVATION_DECIDE'
    `).get();
    if (override?.effect !== 'DENY' || override?.status !== 'ACTIVE') {
      throw new Error('historical personal DENY was not preserved');
    }
    upgraded.exec(`
      INSERT INTO staff_permission_overrides (
        staff_id, permission_code, effect, status, reason,
        assigned_by_staff_id, assigned_at, revoked_at, created_at, updated_at
      ) VALUES ('phase3h-staff','ASSIGNMENT_ELIGIBLE_BUYER_PRE_SALES',
        'DENY','ACTIVE','candidate deny probe',NULL,2,NULL,2,2);
    `);
    const denied = Number(upgraded.prepare(`
      SELECT COUNT(*) AS count
      FROM staff_effective_assignment_permissions
      WHERE staff_id='phase3h-staff'
        AND permission_code='ASSIGNMENT_ELIGIBLE_BUYER_PRE_SALES'
    `).get()?.count ?? -1);
    if (denied !== 0) throw new Error('personal DENY did not remove eligibility');

    const requiredTables = [
      'staff_availability', 'staff_assignment_role_permission_defaults',
      'buyer_staff_assignments', 'seller_staff_assignments',
      'staff_assignment_cursors', 'staff_assignment_fallbacks',
      'staff_work_items', 'staff_assignment_events',
      'staff_reassignment_batches', 'staff_reassignment_batch_items',
      'staff_assignment_cursor_assertions',
    ];
    const requiredIndexes = [
      'uq_buyer_staff_assignment_active',
      'uq_seller_staff_assignment_active',
      'uq_staff_work_item_open_source',
    ];
    const requiredTriggers = [
      'trg_buyer_staff_assignments_revoke_only',
      'trg_buyer_staff_assignments_no_delete',
      'trg_seller_staff_assignments_revoke_only',
      'trg_seller_staff_assignments_no_delete',
      'trg_staff_assignment_role_permission_defaults_no_update',
      'trg_staff_assignment_role_permission_defaults_no_delete',
      'trg_staff_assignment_fallbacks_insert_guard',
      'trg_staff_assignment_fallbacks_update_guard',
      'trg_staff_work_items_assignment_guard',
      'trg_staff_work_items_update_guard',
      'trg_staff_work_items_no_delete',
      'trg_staff_assignment_events_no_update',
      'trg_staff_assignment_events_no_delete',
      'trg_staff_assignment_cursor_assertion_guard',
    ];
    const tables = names(upgraded, 'table');
    const indexes = names(upgraded, 'index');
    const triggers = names(upgraded, 'trigger');
    for (const name of requiredTables) if (!tables.has(name)) throw new Error(`missing table ${name}`);
    for (const name of requiredIndexes) if (!indexes.has(name)) throw new Error(`missing index ${name}`);
    for (const name of requiredTriggers) if (!triggers.has(name)) throw new Error(`missing trigger ${name}`);

    const foreignKeys = upgraded.prepare('PRAGMA foreign_key_check').all();
    if (foreignKeys.length !== 0) throw new Error(`foreign_key_check=${foreignKeys.length}`);
    const integrity = String(upgraded.prepare('PRAGMA integrity_check').get()?.integrity_check ?? '');
    if (integrity !== 'ok') throw new Error(`integrity_check=${integrity}`);
  } finally {
    upgraded.close();
  }

  const wrongOrder = openDatabase('wrong-order.sqlite');
  try {
    apply(wrongOrder, migrationFiles.slice(0, 18));
    expectFailure(
      () => applyOne(wrongOrder, '0020_staff_assignment_rules.sql'),
      'transaction_assertion_failed',
      'schema18->0020',
    );
    if (schemaVersion(wrongOrder) !== 18) throw new Error('wrong order changed schema');
    const residual = wrongOrder.prepare(`
      SELECT 1 FROM sqlite_schema
      WHERE type='table' AND name='staff_availability'
    `).get();
    if (residual) throw new Error('wrong-order migration left partial DDL');
  } finally {
    wrongOrder.close();
  }

  const repeated = openDatabase('repeated.sqlite');
  try {
    apply(repeated, migrationFiles);
    expectFailure(
      () => applyOne(repeated, '0020_staff_assignment_rules.sql'),
      'transaction_assertion_failed',
      'repeat0020@20',
    );
    if (schemaVersion(repeated) !== 20) throw new Error('repeat changed schema');
  } finally {
    repeated.close();
  }

  console.log(JSON.stringify({
    status: 'PASS',
    migrations: 20,
    schema_version: 20,
    wrong_order_rejected: true,
    partial_failure_rolled_back: true,
    repeat_rejected: true,
    historical_override_preserved: true,
    personal_deny_preserved: true,
    foreign_key_check: 0,
    integrity_check: 'ok',
  }, null, 2));
} finally {
  rmSync(workDirectory, { recursive: true, force: true });
}
