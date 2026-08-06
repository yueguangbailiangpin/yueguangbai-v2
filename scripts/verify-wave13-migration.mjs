import { DatabaseSync } from 'node:sqlite';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { assert, read, report, root } from './wave13-verifier-lib.mjs';

const migrationDirectory = path.join(root, 'migrations');
const files = readdirSync(migrationDirectory)
  .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name))
  .sort();
assert(files.length === 28, 'repository requires migrations 0001-0028');
assert(files[26] === '0027_staff_auth_sessions.sql', 'Wave 13 migration must remain 0027');
assert(files[27] === '0028_buyer_amazon_order_date.sql', 'latest migration must be 0028');
const wave13Files = files.slice(0, 27);
for (const name of wave13Files.slice(0, 26)) {
  assert(!read(`migrations/${name}`).includes('staff_sessions'),
    `${name} must remain pre-Wave13`);
}

const database = new DatabaseSync(':memory:');
database.exec('PRAGMA foreign_keys=ON;');
for (const name of wave13Files) database.exec(read(`migrations/${name}`));
const schema = Number(database.prepare(`
  SELECT schema_version FROM app_schema_state WHERE singleton_id=1
`).get()?.schema_version);
assert(schema === 27, `schema version is ${schema}, expected 27`);
const tables = database.prepare(`
  SELECT name FROM sqlite_schema
  WHERE type='table' AND name NOT LIKE 'sqlite_%'
`).all().map((row) => String(row.name));
const triggers = database.prepare(`
  SELECT name FROM sqlite_schema WHERE type='trigger'
`).all().map((row) => String(row.name));
assert(tables.length === 117, `application tables ${tables.length}, expected 117`);
assert(triggers.length === 221, `triggers ${triggers.length}, expected 221`);
for (const table of [
  'staff_login_states','staff_sessions',
  'staff_auth_rate_limits','staff_auth_security_events',
]) assert(tables.includes(table), `missing ${table}`);
const staffColumns = database.prepare('PRAGMA table_info(staff_users)').all();
const sessionVersion = staffColumns.find((column) => column.name === 'session_version');
assert(sessionVersion?.type === 'INTEGER', 'staff_users.session_version must be INTEGER');
assert(Number(sessionVersion?.notnull) === 1, 'session_version must be NOT NULL');
assert(String(sessionVersion?.dflt_value) === '1', 'session_version default must be 1');
for (const trigger of [
  'trg_staff_login_states_transition_guard',
  'trg_staff_sessions_transition_guard',
  'trg_staff_auth_security_events_no_update',
  'trg_staff_auth_security_events_no_delete',
]) assert(triggers.includes(trigger), `missing ${trigger}`);
assert(database.prepare('PRAGMA integrity_check').get()?.integrity_check === 'ok',
  'integrity_check failed');
assert(database.prepare('PRAGMA foreign_key_check').all().length === 0,
  'foreign_key_check failed');
database.close();
report('wave13-migration', {
  migrations: wave13Files.length,
  schema_version: schema,
  application_tables: tables.length,
  triggers: triggers.length,
});
