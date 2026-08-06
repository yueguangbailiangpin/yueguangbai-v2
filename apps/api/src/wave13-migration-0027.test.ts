import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createMigratedTestDatabase,
  SqliteDatabase,
} from '@ygb/testkit';

let database: SqliteDatabase | null = null;
afterEach(() => {
  database?.close();
  database = null;
});

const migrationDirectory = path.resolve(process.cwd(), 'migrations');
const migrations = readdirSync(migrationDirectory)
  .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name))
  .sort();

function applyMigration(target: SqliteDatabase, name: string): void {
  target.exec(readFileSync(path.join(migrationDirectory, name), 'utf8'));
}
function applyThrough(target: SqliteDatabase, count: number): void {
  for (const name of migrations.slice(0, count)) applyMigration(target, name);
}
function seedStaff(target: SqliteDatabase, id = 'staff-wave13-owner'): void {
  target.exec(`
    INSERT INTO staff_users (
      id, display_name, status, authorization_version, version,
      created_at, updated_at, disabled_at
    ) VALUES (
      '${id}', 'Wave 13 Owner', 'ACTIVE', 1, 1, 1, 1, NULL
    );
  `);
}

describe('Migration 0027 Staff authentication persistence', () => {
  it('migrates an empty database through schema 27 with expected objects', async () => {
    database = new SqliteDatabase();
    applyThrough(database, 27);
    const state = await database.prepare(`
      SELECT schema_version FROM app_schema_state WHERE singleton_id=1
    `).first<{ schema_version: number }>();
    expect(Number(state?.schema_version)).toBe(27);
    const tables = await database.prepare(`
      SELECT name FROM sqlite_schema
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
    `).all<{ name: string }>();
    const triggers = await database.prepare(`
      SELECT name FROM sqlite_schema WHERE type='trigger'
    `).all<{ name: string }>();
    expect(tables.results).toHaveLength(117);
    expect(triggers.results).toHaveLength(221);
    for (const name of [
      'staff_login_states',
      'staff_sessions',
      'staff_auth_rate_limits',
      'staff_auth_security_events',
    ]) {
      expect(tables.results.some((row) => row.name === name)).toBe(true);
    }
  });

  it('upgrades schema 26 and defaults existing Staff session_version to one', async () => {
    database = new SqliteDatabase();
    applyThrough(database, 26);
    seedStaff(database);
    const customerAuthBefore = database.raw.prepare(`
      SELECT name, sql FROM sqlite_schema
      WHERE type='table' AND name IN (
        'customer_login_rate_limits','customer_auth_security_events'
      ) ORDER BY name
    `).all();
    applyMigration(database, '0027_staff_auth_sessions.sql');
    expect(database.raw.prepare(`
      SELECT schema_version FROM app_schema_state WHERE singleton_id=1
    `).get()).toEqual({ schema_version: 27 });
    expect(database.raw.prepare(`
      SELECT session_version FROM staff_users WHERE id='staff-wave13-owner'
    `).get()).toEqual({ session_version: 1 });
    expect(database.raw.prepare(`
      SELECT name, sql FROM sqlite_schema
      WHERE type='table' AND name IN (
        'customer_login_rate_limits','customer_auth_security_events'
      ) ORDER BY name
    `).all()).toEqual(customerAuthBefore);
  });

  it('rejects duplicate state and session token hashes', async () => {
    database = createMigratedTestDatabase();
    seedStaff(database);
    const stateHash = 'a'.repeat(64);
    await database.prepare(`
      INSERT INTO staff_login_states (
        id,state_hash,provider,tenant_key,callback_purpose,return_to,status,
        origin_hash,network_source_hash,request_id,expires_at,consumed_at,
        cancelled_at,created_at,updated_at
      ) VALUES (
        'login-state-wave13-01',?,'FEISHU','tenant','STAFF_LOGIN','/staff',
        'ISSUED',NULL,NULL,NULL,1000,NULL,NULL,1,1
      )
    `).bind(stateHash).run();
    await expect(database.prepare(`
      INSERT INTO staff_login_states (
        id,state_hash,provider,tenant_key,callback_purpose,return_to,status,
        origin_hash,network_source_hash,request_id,expires_at,consumed_at,
        cancelled_at,created_at,updated_at
      ) VALUES (
        'login-state-wave13-02',?,'FEISHU','tenant','STAFF_LOGIN','/staff',
        'ISSUED',NULL,NULL,NULL,1000,NULL,NULL,1,1
      )
    `).bind(stateHash).run()).rejects.toThrow();

    const tokenHash = 'b'.repeat(64);
    await database.prepare(`
      INSERT INTO staff_sessions (
        id,token_hash,staff_id,issued_session_version,
        issued_authorization_version,status,expires_at,revoked_at,
        revoked_reason,created_at,updated_at
      ) VALUES (
        'staff-session-wave13-01',?,'staff-wave13-owner',1,1,
        'ACTIVE',2000,NULL,NULL,1,1
      )
    `).bind(tokenHash).run();
    await expect(database.prepare(`
      INSERT INTO staff_sessions (
        id,token_hash,staff_id,issued_session_version,
        issued_authorization_version,status,expires_at,revoked_at,
        revoked_reason,created_at,updated_at
      ) VALUES (
        'staff-session-wave13-02',?,'staff-wave13-owner',1,1,
        'ACTIVE',2000,NULL,NULL,1,1
      )
    `).bind(tokenHash).run()).rejects.toThrow();
  });

  it('rejects illegal lifecycle, time ordering, and missing Staff foreign keys', async () => {
    database = createMigratedTestDatabase();
    seedStaff(database);
    await expect(database.prepare(`
      INSERT INTO staff_login_states (
        id,state_hash,provider,tenant_key,callback_purpose,return_to,status,
        expires_at,created_at,updated_at
      ) VALUES (
        'login-state-bad-time',?,'FEISHU','tenant','STAFF_LOGIN','/staff',
        'ISSUED',10,10,10
      )
    `).bind('c'.repeat(64)).run()).rejects.toThrow();
    await database.prepare(`
      INSERT INTO staff_login_states (
        id,state_hash,provider,tenant_key,callback_purpose,return_to,status,
        expires_at,created_at,updated_at
      ) VALUES (
        'login-state-transition',?,'FEISHU','tenant','STAFF_LOGIN','/staff',
        'ISSUED',1000,1,1
      )
    `).bind('d'.repeat(64)).run();
    await expect(database.prepare(`
      UPDATE staff_login_states SET updated_at=2
      WHERE id='login-state-transition'
    `).run()).rejects.toThrow();
    await expect(database.prepare(`
      INSERT INTO staff_sessions (
        id,token_hash,staff_id,issued_session_version,
        issued_authorization_version,status,expires_at,created_at,updated_at
      ) VALUES (
        'staff-session-missing',?,'missing-staff',1,1,'ACTIVE',1000,1,1
      )
    `).bind('e'.repeat(64)).run()).rejects.toThrow();
  });

  it('keeps Staff authentication security events immutable', async () => {
    database = createMigratedTestDatabase();
    await database.prepare(`
      INSERT INTO staff_auth_security_events (
        id,event_type,outcome,provider,metadata_json,created_at
      ) VALUES (
        'staff-security-event-01','STATE_INVALID','REJECTED','FEISHU','{}',1
      )
    `).run();
    await expect(database.prepare(`
      UPDATE staff_auth_security_events SET metadata_json='{"x":1}'
      WHERE id='staff-security-event-01'
    `).run()).rejects.toThrow();
    await expect(database.prepare(`
      DELETE FROM staff_auth_security_events
      WHERE id='staff-security-event-01'
    `).run()).rejects.toThrow();
  });
});
