// Original verify-wave12-migrations asserted the mid-chain Wave 12 schema state
// at migration 0026. The chain-position assertions retired with the legacy
// chain (D-054); the protected Wave 12 business assertions — internal finance
// read model objects, export event immutability, and the owner-only
// FINANCIAL_VIEW persisted catalog — are re-anchored on the stage 3 clean
// baseline's applied final schema.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const directory = path.join(root, 'migrations');
const files = readdirSync(directory)
  .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name))
  .sort();
if (files.length !== 19) {
  throw new Error('Expected the stage 3 clean baseline 0001-0019');
}

const database = new DatabaseSync(':memory:');
try {
  database.exec('PRAGMA foreign_keys=ON;');
  for (const file of files) {
    database.exec('BEGIN IMMEDIATE;');
    try {
      database.exec(readFileSync(path.join(directory, file), 'utf8'));
      database.exec('COMMIT;');
    } catch (error) {
      try { database.exec('ROLLBACK;'); } catch { /* no transaction */ }
      throw new Error(`${file}: ${String(error)}`);
    }
  }
  const version = Number(database.prepare(`
    SELECT schema_version FROM app_schema_state WHERE singleton_id=1
  `).get()?.schema_version);
  if (version !== 19) throw new Error(`expected schema 19, got ${version}`);

  const required = new Map([
    ['internal_order_finance_positions', 'view'],
    ['internal_finance_exceptions', 'view'],
    ['internal_finance_cash_movements', 'view'],
    ['financial_export_events', 'table'],
    ['trg_financial_export_events_no_update', 'trigger'],
    ['trg_financial_export_events_no_delete', 'trigger'],
  ]);
  for (const [name, type] of required) {
    const row = database.prepare(
      'SELECT type FROM sqlite_schema WHERE name=?',
    ).get(name);
    if (row?.type !== type) throw new Error(`missing ${type}: ${name}`);
  }

  const ownerRows = database.prepare(`
    SELECT role_code FROM staff_assignment_role_permission_defaults
    WHERE permission_code='FINANCIAL_VIEW' ORDER BY role_code
  `).all();
  if (JSON.stringify(ownerRows) !== JSON.stringify([{ role_code: 'owner' }])) {
    throw new Error('FINANCIAL_VIEW must be owner-only in persisted catalog');
  }
  const integrity = database.prepare('PRAGMA integrity_check').all();
  if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok') {
    throw new Error('integrity_check failed');
  }
  if (database.prepare('PRAGMA foreign_key_check').all().length !== 0) {
    throw new Error('foreign_key_check failed');
  }
  console.log(JSON.stringify({
    status: 'PASS',
    baseline: 'stage3-clean-baseline-0001-0019',
    schema_version: 19,
  }, null, 2));
} finally {
  database.close();
}
