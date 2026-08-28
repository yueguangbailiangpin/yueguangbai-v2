import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..'),
  directory = path.join(root, 'migrations');
const expectedLatestSchema = 30,
  expectedLastMigration = '0030_stage66e_invitation_binding_and_permission_cleanup.sql';
const migrationFiles = readdirSync(directory)
  .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name))
  .sort();
const numbers = migrationFiles.map((name) => Number(name.slice(0, 4))),
  expected = Array.from({ length: expectedLatestSchema }, (_, index) => index + 1);
if (
  migrationFiles.length !== expectedLatestSchema ||
  migrationFiles.at(-1) !== expectedLastMigration ||
  numbers.some((number, index) => number !== expected[index])
)
  throw new Error('expected one continuous migration for every version 0001-0023');
const sql = migrationFiles.map((name) => readFileSync(path.join(directory, name), 'utf8'));
function open() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}
function version(db) {
  const exists = db
    .prepare(
      "SELECT 1 AS present FROM sqlite_schema WHERE type='table' AND name='app_schema_state'",
    )
    .get();
  return exists
    ? Number(
        db.prepare('SELECT schema_version FROM app_schema_state WHERE singleton_id=1').get()
          ?.schema_version,
      )
    : 0;
}
function run(db, number) {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const before = version(db);
    db.exec(sql[number - 1]);
    if (before !== number - 1)
      throw new Error(`migration_predecessor_mismatch: expected ${number - 1}, got ${before}`);
    if (version(db) !== number)
      throw new Error(`migration_result_version_mismatch: expected ${number}`);
    db.exec('COMMIT;');
  } catch (error) {
    try {
      db.exec('ROLLBACK;');
    } catch {}
    try {
      db.exec('PRAGMA foreign_keys = ON;');
    } catch {}
    throw error;
  }
}
function prefix(db, count) {
  for (let number = 1; number <= count; number += 1) run(db, number);
}
function integrity(db, label) {
  db.exec('PRAGMA foreign_keys = ON;');
  const result = db
    .prepare('PRAGMA integrity_check')
    .all()
    .map((row) => String(row.integrity_check));
  if (result.length !== 1 || result[0] !== 'ok')
    throw new Error(`${label}: integrity failed: ${result.join(',')}`);
  const foreign = db.prepare('PRAGMA foreign_key_check').all();
  if (foreign.length) throw new Error(`${label}: ${foreign.length} foreign key errors`);
}
function q(value) {
  return `"${value.replaceAll('"', '""')}"`;
}
function serial(value) {
  if (value === null) return ['null'];
  if (value instanceof Uint8Array) return ['blob', Buffer.from(value).toString('hex')];
  if (typeof value === 'number') return ['number', Object.is(value, -0) ? '-0' : String(value)];
  if (typeof value === 'bigint') return ['bigint', value.toString()];
  return [typeof value, String(value)];
}
function snapshot(db) {
  const schema = db
    .prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name')
    .all()
    .map((row) => ({
      type: String(row.type),
      name: String(row.name),
      table: String(row.tbl_name),
      sql: row.sql === null ? null : String(row.sql),
    }));
  const data = {};
  for (const table of schema.filter((item) => item.type === 'table')) {
    const rows = db
      .prepare(`SELECT * FROM ${q(table.name)}`)
      .all()
      .map((row) =>
        Object.fromEntries(Object.entries(row).map(([column, value]) => [column, serial(value)])),
      );
    rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    data[table.name] = rows;
  }
  return JSON.stringify({ schema, data });
}
function expectFailure(db, number, label) {
  const before = snapshot(db);
  let failure = null;
  try {
    run(db, number);
  } catch (error) {
    failure = String(error);
  }
  if (failure === null) throw new Error(`${label}: expected failure`);
  if (snapshot(db) !== before) throw new Error(`${label}: failed migration changed schema or data`);
  integrity(db, label);
  return failure;
}
{
  const db = open();
  prefix(db, migrationFiles.length);
  if (version(db) !== expectedLatestSchema)
    throw new Error(`fresh schema not ${expectedLatestSchema}`);
  integrity(db, 'fresh');
  db.close();
}
{
  const db = open();
  for (let number = 1; number <= migrationFiles.length; number += 1) {
    run(db, number);
    if (version(db) !== number) throw new Error(`upgrade expected schema ${number}`);
  }
  integrity(db, 'upgrade');
  db.close();
}
const wrong = [];
for (let number = 2; number <= migrationFiles.length; number += 1) {
  const db = open();
  prefix(db, number - 2);
  wrong.push({
    number,
    failure: expectFailure(db, number, `skip-previous-${String(number).padStart(4, '0')}`),
  });
  if (version(db) !== number - 2) throw new Error(`skip-${number}: schema version changed`);
  db.close();
}
const repeats = [];
for (let number = 1; number <= migrationFiles.length; number += 1) {
  const db = open();
  prefix(db, number);
  repeats.push(expectFailure(db, number, `repeat-${String(number).padStart(4, '0')}`));
  if (version(db) !== number) throw new Error(`repeat-${number}: schema version changed`);
  db.close();
}
const verifierRollbacks = wrong
  .filter((item) => item.failure.includes('migration_predecessor_mismatch'))
  .map((item) => migrationFiles[item.number - 1]);
const failureKinds = [...wrong.map((item) => item.failure), ...repeats].reduce(
  (counts, failure) => {
    const key = failure.includes('transaction_assertion_failed')
      ? 'transaction_assertion_failed'
      : failure.includes('migration_predecessor_mismatch')
        ? 'verifier_predecessor_mismatch'
        : 'other_sql_failure';
    counts[key] += 1;
    return counts;
  },
  { transaction_assertion_failed: 0, verifier_predecessor_mismatch: 0, other_sql_failure: 0 },
);
console.log(
  JSON.stringify(
    {
      status: 'PASS',
      baseline: 'clean-baseline-0001-0021',
      migration_count: migrationFiles.length,
      fresh_schema: expectedLatestSchema,
      sequential_upgrade: '0001 -> 0023',
      sequential_steps: migrationFiles.length,
      wrong_order_cases: wrong.length,
      wrong_order_commits_rejected: wrong.length,
      wrong_order_sql_succeeded_but_verifier_rolled_back: verifierRollbacks,
      repeat_cases: repeats.length,
      repeat_rejected: repeats.length,
      failed_snapshots_unchanged: wrong.length + repeats.length,
      no_partial_schema_or_data: true,
      failure_kinds: failureKinds,
    },
    null,
    2,
  ),
);
