import { DatabaseSync } from 'node:sqlite';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { assert, read, report, root } from './wave13-verifier-lib.mjs';

const migrationDirectory = path.join(root, 'migrations');
const files = readdirSync(migrationDirectory)
  .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name))
  .sort();
// Wave 13 schema assertions re-anchored on the stage 3 clean baseline
// (staff auth domain lives in 0002_staff_identity_permissions).
assert(files.length === 19, 'expected the stage 3 clean baseline 0001-0019');

const database = new DatabaseSync(':memory:');
database.exec('PRAGMA foreign_keys=ON;');
for (const name of files) database.exec(read(`migrations/${name}`));
const schema = Number(database.prepare(`
  SELECT schema_version FROM app_schema_state WHERE singleton_id=1
`).get()?.schema_version);
assert(schema === 19, `schema version is ${schema}, expected 19`);
const tables = database.prepare(`
  SELECT name FROM sqlite_schema
  WHERE type='table' AND name NOT LIKE 'sqlite_%'
`).all().map((row) => String(row.name));
const triggers = database.prepare(`
  SELECT name FROM sqlite_schema WHERE type='trigger'
`).all().map((row) => String(row.name));
// staff_login_states / staff_auth_rate_limits / staff_auth_security_events
// were retired by later legacy migrations; the final baseline intentionally
// carries only staff_sessions plus the staff_users session-version column.
assert(tables.includes('staff_sessions'), 'missing staff_sessions');
const staffColumns = database.prepare('PRAGMA table_info(staff_users)').all();
const sessionVersion = staffColumns.find((column) => column.name === 'session_version');
assert(sessionVersion?.type === 'INTEGER', 'staff_users.session_version must be INTEGER');
assert(Number(sessionVersion?.notnull) === 1, 'session_version must be NOT NULL');
assert(String(sessionVersion?.dflt_value) === '1', 'session_version default must be 1');
for (const trigger of [
  'trg_staff_sessions_transition_guard',
]) assert(triggers.includes(trigger), `missing ${trigger}`);
assert(database.prepare('PRAGMA integrity_check').get()?.integrity_check === 'ok',
  'integrity_check failed');
assert(database.prepare('PRAGMA foreign_key_check').all().length === 0,
  'foreign_key_check failed');
database.close();
report('wave13-migration', {
  baseline: 'stage3-clean-baseline-0001-0019',
  migrations: files.length,
  schema_version: schema,
  application_tables: tables.length,
  triggers: triggers.length,
});
