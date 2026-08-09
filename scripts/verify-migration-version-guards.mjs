import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { verifyHistoricalMigrationImmutability } from './historical-migration-immutability.mjs';

const root = path.resolve(import.meta.dirname, '..');
const migrationsDirectory = path.join(root, 'migrations');
const expectedLatestSchema = 43;
const expectedLastMigration =
  '0043_seller_principal_rate_integrity_hardening.sql';
const migrationFiles = readdirSync(migrationsDirectory)
  .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name))
  .sort();

const migrationNumbers = migrationFiles.map((name) => Number(name.slice(0, 4)));
const expectedNumbers = Array.from(
  { length: expectedLatestSchema },
  (_, index) => index + 1,
);
if (migrationFiles.length !== expectedLatestSchema
  || migrationFiles.at(-1) !== expectedLastMigration
  || migrationNumbers.some((number, index) => number !== expectedNumbers[index])) {
  throw new Error('expected one continuous migration for every version 0001-0043');
}
const historicalIntegrity = verifyHistoricalMigrationImmutability(root);

const migrationSql = migrationFiles.map((name) =>
  readFileSync(path.join(migrationsDirectory, name), 'utf8'));

function openDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON;');
  return database;
}

function runMigration(database, number) {
  database.exec('BEGIN IMMEDIATE;');
  try {
    const versionBefore = schemaVersion(database);
    database.exec(migrationSql[number - 1]);
    const expectedPredecessor = number - 1;
    if (versionBefore !== expectedPredecessor) {
      throw new Error(
        `migration_predecessor_mismatch: expected ${expectedPredecessor}, got ${versionBefore}`,
      );
    }
    if (schemaVersion(database) !== number) {
      throw new Error(`migration_result_version_mismatch: expected ${number}`);
    }
    database.exec('COMMIT;');
  } catch (error) {
    try { database.exec('ROLLBACK;'); } catch { /* no open tx */ }
    try { database.exec('PRAGMA foreign_keys = ON;'); } catch { /* ignore */ }
    throw error;
  }
}

function applyPrefix(database, count) {
  for (let number = 1; number <= count; number += 1) {
    runMigration(database, number);
  }
}

function schemaVersion(database) {
  const stateTable = database.prepare(`
    SELECT 1 AS present
    FROM sqlite_schema
    WHERE type='table' AND name='app_schema_state'
  `).get();
  if (!stateTable) return 0;
  return Number(database.prepare(`
    SELECT schema_version FROM app_schema_state WHERE singleton_id=1
  `).get()?.schema_version);
}

function assertIntegrity(database, label) {
  database.exec('PRAGMA foreign_keys = ON;');
  const integrity = database.prepare('PRAGMA integrity_check').all()
    .map((row) => String(row.integrity_check));
  if (integrity.length !== 1 || integrity[0] !== 'ok') {
    throw new Error(`${label}: integrity failed: ${integrity.join(',')}`);
  }
  const foreignKeys = database.prepare('PRAGMA foreign_key_check').all();
  if (foreignKeys.length > 0) {
    throw new Error(`${label}: ${foreignKeys.length} foreign key errors`);
  }
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function serializeValue(value) {
  if (value === null) return ['null'];
  if (value instanceof Uint8Array) {
    return ['blob', Buffer.from(value).toString('hex')];
  }
  if (typeof value === 'number') {
    return ['number', Object.is(value, -0) ? '-0' : String(value)];
  }
  if (typeof value === 'bigint') return ['bigint', value.toString()];
  return [typeof value, String(value)];
}

function completeSnapshot(database) {
  const schema = database.prepare(`
    SELECT type, name, tbl_name, sql
    FROM sqlite_schema
    ORDER BY type, name
  `).all().map((row) => ({
    type: String(row.type),
    name: String(row.name),
    table: String(row.tbl_name),
    sql: row.sql === null ? null : String(row.sql),
  }));
  const data = {};
  for (const table of schema.filter((object) => object.type === 'table')) {
    const rows = database.prepare(
      `SELECT * FROM ${quoteIdentifier(table.name)}`,
    ).all().map((row) => Object.fromEntries(
      Object.entries(row).map(([column, value]) => [
        column,
        serializeValue(value),
      ]),
    ));
    rows.sort((left, right) => JSON.stringify(left).localeCompare(
      JSON.stringify(right),
    ));
    data[table.name] = rows;
  }
  return JSON.stringify({ schema, data });
}

function expectFailureWithoutMutation(database, number, label) {
  const before = completeSnapshot(database);
  let failure = null;
  try {
    runMigration(database, number);
  } catch (error) {
    failure = String(error);
  }
  if (failure === null) throw new Error(`${label}: expected failure`);
  const after = completeSnapshot(database);
  if (after !== before) {
    throw new Error(`${label}: failed migration changed schema or table data`);
  }
  assertIntegrity(database, label);
  return failure;
}

{
  const fresh = openDatabase();
  applyPrefix(fresh, migrationFiles.length);
  if (schemaVersion(fresh) !== expectedLatestSchema) {
    throw new Error(`fresh schema not ${expectedLatestSchema}`);
  }
  assertIntegrity(fresh, 'fresh');
  fresh.close();
}

{
  const upgrade = openDatabase();
  for (let number = 1; number <= migrationFiles.length; number += 1) {
    runMigration(upgrade, number);
    if (schemaVersion(upgrade) !== number) {
      throw new Error(`upgrade expected schema ${number}`);
    }
  }
  assertIntegrity(upgrade, 'upgrade');
  upgrade.close();
}

const wrongOrderResults = [];
for (let number = 2; number <= migrationFiles.length; number += 1) {
  const skipped = openDatabase();
  applyPrefix(skipped, number - 2);
  wrongOrderResults.push({
    number,
    failure: expectFailureWithoutMutation(
      skipped,
      number,
      `skip-previous-${String(number).padStart(4, '0')}`,
    ),
  });
  if (schemaVersion(skipped) !== number - 2) {
    throw new Error(`skip-${number}: schema version changed`);
  }
  skipped.close();
}
const wrongOrderFailures = wrongOrderResults.map((result) => result.failure);
const verifierRollbackMigrations = wrongOrderResults
  .filter((result) => result.failure.includes('migration_predecessor_mismatch'))
  .map((result) => migrationFiles[result.number - 1]);
const rawWrongOrderFailureCount =
  wrongOrderResults.length - verifierRollbackMigrations.length;

const repeatFailures = [];
for (let number = 1; number <= migrationFiles.length; number += 1) {
  const repeated = openDatabase();
  applyPrefix(repeated, number);
  repeatFailures.push(expectFailureWithoutMutation(
    repeated,
    number,
    `repeat-${String(number).padStart(4, '0')}`,
  ));
  if (schemaVersion(repeated) !== number) {
    throw new Error(`repeat-${number}: schema version changed`);
  }
  repeated.close();
}

const failureKinds = [...wrongOrderFailures, ...repeatFailures].reduce(
  (counts, failure) => {
    let kind = 'other_sql_failure';
    if (failure.includes('transaction_assertion_failed')) {
      kind = 'transaction_assertion_failed';
    } else if (failure.includes('migration_predecessor_mismatch')) {
      kind = 'verifier_predecessor_mismatch';
    }
    counts[kind] += 1;
    return counts;
  },
  {
    transaction_assertion_failed: 0,
    verifier_predecessor_mismatch: 0,
    other_sql_failure: 0,
  },
);

console.log(JSON.stringify({
  status: 'PASS',
  historical_baseline: historicalIntegrity.baseline,
  immutable_historical_migrations: historicalIntegrity.count,
  historical_migration_aggregate_sha256:
    historicalIntegrity.aggregateSha256,
  migration_count: migrationFiles.length,
  fresh_schema: expectedLatestSchema,
  sequential_upgrade: '0001 -> 0043',
  sequential_steps: migrationFiles.length,
  wrong_order_cases: wrongOrderFailures.length,
  wrong_order_commits_rejected: wrongOrderFailures.length,
  wrong_order_sql_self_rejected: rawWrongOrderFailureCount,
  wrong_order_sql_succeeded_but_verifier_rolled_back:
    verifierRollbackMigrations,
  repeat_cases: repeatFailures.length,
  repeat_rejected: repeatFailures.length,
  failed_snapshots_unchanged:
    wrongOrderFailures.length + repeatFailures.length,
  no_partial_schema_or_data: true,
  failure_kinds: failureKinds,
}, null, 2));
