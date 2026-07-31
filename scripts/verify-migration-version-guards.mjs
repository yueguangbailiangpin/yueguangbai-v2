import { DatabaseSync } from 'node:sqlite';
import {
  readFileSync,
  readdirSync,
} from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const migrationsDirectory = path.join(root, 'migrations');

const migrationFiles = readdirSync(migrationsDirectory)
  .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name))
  .sort();

function readMigration(name) {
  return readFileSync(path.join(migrationsDirectory, name), 'utf8');
}

function openDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON;');
  return database;
}

function applyFiles(database, names) {
  for (const name of names) database.exec(readMigration(name));
}

function schemaVersion(database) {
  const row = database.prepare(`
    SELECT schema_version
    FROM app_schema_state
    WHERE singleton_id=1
  `).get();
  return Number(row?.schema_version);
}

function assertIntegrity(database, label) {
  const integrity = database.prepare('PRAGMA integrity_check').all()
    .map((row) => String(row.integrity_check));
  if (integrity.length !== 1 || integrity[0] !== 'ok') {
    throw new Error(`${label}: integrity_check 失败`);
  }
  const foreignKeys = database.prepare('PRAGMA foreign_key_check').all();
  if (foreignKeys.length > 0) {
    throw new Error(`${label}: foreign_key_check 发现 ${foreignKeys.length} 项`);
  }
}

function assertObjectAbsent(database, type, name) {
  const row = database.prepare(`
    SELECT 1
    FROM sqlite_schema
    WHERE type=? AND name=?
  `).get(type, name);
  if (row) throw new Error(`${type} ${name} 不应在失败后残留`);
}

function expectMigrationFailure(database, name, label) {
  let failed = false;
  try {
    database.exec(readMigration(name));
  } catch (error) {
    failed = true;
    if (!String(error).includes('transaction_assertion_failed')) {
      throw new Error(`${label}: 失败原因不是前置断言: ${String(error)}`);
    }
  }
  if (!failed) throw new Error(`${label}: Migration 应失败但未失败`);
}

// 1. Fresh full sequence 0001-0013.
{
  const fresh = openDatabase();
  applyFiles(fresh, migrationFiles);
  if (schemaVersion(fresh) !== 13) {
    throw new Error(`fresh: schema 应为 13，实际 ${schemaVersion(fresh)}`);
  }
  assertIntegrity(fresh, 'fresh');
  fresh.close();
}

// 2. Upgrade path 0001-0009 -> 0010 -> 0011 -> 0012 -> 0013.
{
  const upgrade = openDatabase();
  applyFiles(upgrade, migrationFiles.slice(0, 9));
  if (schemaVersion(upgrade) !== 9) throw new Error('upgrade: schema 9');
  applyFiles(upgrade, ['0010_file_storage.sql']);
  if (schemaVersion(upgrade) !== 10) throw new Error('upgrade: schema 10');
  applyFiles(upgrade, ['0011_pricing_rules.sql']);
  if (schemaVersion(upgrade) !== 11) throw new Error('upgrade: schema 11');
  applyFiles(upgrade, ['0012_customer_auth_security.sql']);
  if (schemaVersion(upgrade) !== 12) throw new Error('upgrade: schema 12');
  applyFiles(upgrade, ['0013_order_evidence.sql']);
  if (schemaVersion(upgrade) !== 13) throw new Error('upgrade: schema 13');
  assertIntegrity(upgrade, 'upgrade');
  upgrade.close();
}

// 3. Negative: schema=9, direct 0011.
{
  const neg = openDatabase();
  applyFiles(neg, migrationFiles.slice(0, 9));
  expectMigrationFailure(neg, '0011_pricing_rules.sql', 'schema9->0011');
  if (schemaVersion(neg) !== 9) throw new Error('schema9->0011 changed');
  assertObjectAbsent(neg, 'table', 'buyer_daily_exchange_rates');
  assertIntegrity(neg, 'schema9->0011');
  neg.close();
}

// 4. Negative: schema=10, direct 0012.
{
  const neg = openDatabase();
  applyFiles(neg, migrationFiles.slice(0, 10));
  expectMigrationFailure(neg, '0012_customer_auth_security.sql', 'schema10->0012');
  if (schemaVersion(neg) !== 10) throw new Error('schema10->0012 changed');
  assertObjectAbsent(neg, 'table', 'customer_login_rate_limits');
  assertIntegrity(neg, 'schema10->0012');
  neg.close();
}

// 5. Negative: schema=11, direct 0013.
{
  const neg = openDatabase();
  applyFiles(neg, migrationFiles.slice(0, 11));
  expectMigrationFailure(neg, '0013_order_evidence.sql', 'schema11->0013');
  if (schemaVersion(neg) !== 11) throw new Error('schema11->0013 changed');
  assertObjectAbsent(neg, 'table', 'order_evidence_submissions');
  assertIntegrity(neg, 'schema11->0013');
  neg.close();
}

// 6. Repeat 0011 at schema 11.
{
  const neg = openDatabase();
  applyFiles(neg, migrationFiles.slice(0, 11));
  expectMigrationFailure(neg, '0011_pricing_rules.sql', 'repeat0011@11');
  if (schemaVersion(neg) !== 11) throw new Error('repeat0011 changed');
  assertIntegrity(neg, 'repeat0011@11');
  neg.close();
}

// 7. Repeat 0012 at schema 12.
{
  const neg = openDatabase();
  applyFiles(neg, migrationFiles.slice(0, 12));
  expectMigrationFailure(neg, '0012_customer_auth_security.sql', 'repeat0012@12');
  if (schemaVersion(neg) !== 12) throw new Error('repeat0012 changed');
  assertIntegrity(neg, 'repeat0012@12');
  neg.close();
}

// 8. Repeat 0013 at schema 13.
{
  const neg = openDatabase();
  applyFiles(neg, migrationFiles);
  expectMigrationFailure(neg, '0013_order_evidence.sql', 'repeat0013@13');
  if (schemaVersion(neg) !== 13) throw new Error('repeat0013 changed');
  assertIntegrity(neg, 'repeat0013@13');
  neg.close();
}

console.log(JSON.stringify({
  status: 'PASS',
  fresh_db: 'schema 13, integrity ok, fk 0',
  upgrade_9_to_13: '9 -> 10 -> 11 -> 12 -> 13',
  negative_schema9_to_0011: 'REJECTED',
  negative_schema10_to_0012: 'REJECTED',
  negative_schema11_to_0013: 'REJECTED',
  repeat_0011_rejected: true,
  repeat_0012_rejected: true,
  repeat_0013_rejected: true,
  no_partial_ddl: true,
}, null, 2));
