import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const migrationsDirectory = path.join(root, 'migrations');
const migrationFiles = readdirSync(migrationsDirectory)
  .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name))
  .sort();

if (migrationFiles.length !== 34
  || migrationFiles.at(-5) !== '0030_customer_multipersona_invitation_recovery.sql'
  || migrationFiles.at(-4) !== '0031_scheduled_operations.sql'
  || migrationFiles.at(-3) !== '0032_google_drive_cold_image_archive.sql'
  || migrationFiles.at(-2) !== '0033_feishu_staff_workbench_poc.sql'
  || migrationFiles.at(-1) !== '0034_feishu_sync_dead_letter_categories.sql') {
  throw new Error('expected migrations 0001-0034');
}

const guarded = new Map([
  [11, 'buyer_daily_exchange_rates'],
  [12, 'customer_login_rate_limits'],
  [13, 'order_evidence_submissions'],
  [14, 'formal_orders'],
  [15, 'file_entity_audience_grants'],
  [16, 'review_cases'],
  [17, 'buyer_refund_obligations'],
  [18, 'buyer_registration_conflicts'],
  [19, 'product_version_main_images'],
  [20, 'staff_availability'],
  [21, 'order_instructions'],
  [22, 'idx_review_evidence_versions_current_url'],
  [23, 'seller_payables'],
  [24, 'seller_payments'],
  [25, 'internal_order_finance_positions'],
  [26, 'financial_export_events'],
  [27, 'staff_sessions'],
  [29, 'marketplace_registry'],
  [30, 'customer_account_personas'],
  [31, 'scheduled_job_states'],
  [32, 'file_drive_archives'],
  [33, 'feishu_workbench_mirrors'],
  [34, 'scheduled_dead_letters_next'],
]);

function readMigration(name) {
  return readFileSync(path.join(migrationsDirectory, name), 'utf8');
}
function openDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON;');
  return database;
}
function runMigration(database, name) {
  database.exec('BEGIN IMMEDIATE;');
  try {
    database.exec(readMigration(name));
    database.exec('COMMIT;');
  } catch (error) {
    try { database.exec('ROLLBACK;'); } catch { /* no open tx */ }
    try { database.exec('PRAGMA foreign_keys = ON;'); } catch { /* ignore */ }
    throw error;
  }
}
function applyPrefix(database, count) {
  for (const name of migrationFiles.slice(0, count)) runMigration(database, name);
}
function schemaVersion(database) {
  return Number(database.prepare(`
    SELECT schema_version FROM app_schema_state WHERE singleton_id=1
  `).get()?.schema_version);
}
function assertIntegrity(database, label) {
  database.exec('PRAGMA foreign_keys = ON;');
  const integrity = database.prepare('PRAGMA integrity_check').all()
    .map((row) => String(row.integrity_check));
  if (integrity.length !== 1 || integrity[0] !== 'ok') {
    throw new Error(`${label}: integrity failed`);
  }
  if (database.prepare('PRAGMA foreign_key_check').all().length > 0) {
    throw new Error(`${label}: foreign keys failed`);
  }
}
function expectGuardFailure(database, migration, label) {
  let failed = false;
  try { runMigration(database, migration); }
  catch (error) {
    failed = true;
    if (!String(error).includes('transaction_assertion_failed')) {
      throw new Error(`${label}: wrong failure ${String(error)}`);
    }
  }
  if (!failed) throw new Error(`${label}: expected failure`);
}

{
  const fresh = openDatabase();
  applyPrefix(fresh, migrationFiles.length);
  if (schemaVersion(fresh) !== 34) throw new Error('fresh schema not 34');
  assertIntegrity(fresh, 'fresh');
  fresh.close();
}

{
  const upgrade = openDatabase();
  for (let count = 1; count <= migrationFiles.length; count += 1) {
    runMigration(upgrade, migrationFiles[count - 1]);
    if (schemaVersion(upgrade) !== count) {
      throw new Error(`upgrade expected schema ${count}`);
    }
  }
  assertIntegrity(upgrade, 'upgrade');
  upgrade.close();
}

for (const [number, sentinel] of guarded) {
  const migration = migrationFiles[number - 1];
  const skipped = openDatabase();
  applyPrefix(skipped, number - 2);
  expectGuardFailure(skipped, migration, `skip-${number}`);
  if (schemaVersion(skipped) !== number - 2) {
    throw new Error(`skip-${number}: schema changed`);
  }
  if (skipped.prepare('SELECT 1 FROM sqlite_schema WHERE name=?')
    .get(sentinel)) {
    throw new Error(`skip-${number}: partial DDL ${sentinel}`);
  }
  assertIntegrity(skipped, `skip-${number}`);
  skipped.close();

  const repeated = openDatabase();
  applyPrefix(repeated, number);
  expectGuardFailure(repeated, migration, `repeat-${number}`);
  if (schemaVersion(repeated) !== number) {
    throw new Error(`repeat-${number}: schema changed`);
  }
  assertIntegrity(repeated, `repeat-${number}`);
  repeated.close();
}

console.log(JSON.stringify({
  status: 'PASS',
  fresh_schema: 34,
  sequential_upgrade: '0001 -> 0034',
  guarded_migrations: [...guarded.keys()],
  wrong_order_rejected: true,
  repeat_rejected: true,
  no_partial_ddl: true,
}, null, 2));
