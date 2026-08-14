import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteDatabase } from '@ygb/testkit';

const migrationPath = path.resolve(
  process.cwd(),
  'migrations/0068_customer_security_deny_password_rate_limit.sql',
);
let database: SqliteDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe('Migration 0068 Customer security boundaries', () => {
  it('preserves existing counters and immutable security events', async () => {
    database = fullSchema67Database();
    const hash = 'a'.repeat(64);
    await database.prepare(`
      INSERT INTO customer_security_rate_limits (
        operation,scope_type,scope_hash,window_started_at,
        window_expires_at,attempt_count,blocked_until,created_at,updated_at
      ) VALUES ('INVITATION','TOKEN',?,0,900000,3,NULL,1000,2000)
    `).bind(hash).run();
    await database.prepare(`
      INSERT INTO customer_auth_security_events (
        id,event_type,outcome,account_id,login_identifier_hash,
        network_source_hash,request_id,metadata_json,created_at
      ) VALUES ('security-before-68','LOGIN_FAILED','FAILURE',NULL,?,NULL,
        'request-before-68','{}',1000)
    `).bind(hash).run();

    applyMigration0068(database);

    expect(await schemaVersion(database)).toBe(68);
    expect(await database.prepare(`
      SELECT operation,scope_type,scope_hash,attempt_count
      FROM customer_security_rate_limits
    `).first()).toEqual({
      operation: 'INVITATION',
      scope_type: 'TOKEN',
      scope_hash: hash,
      attempt_count: 3,
    });
    expect(await database.prepare(`
      SELECT id,event_type,outcome,login_identifier_hash
      FROM customer_auth_security_events
    `).first()).toEqual({
      id: 'security-before-68',
      event_type: 'LOGIN_FAILED',
      outcome: 'FAILURE',
      login_identifier_hash: hash,
    });
    expect(() => database!.exec(`
      UPDATE customer_auth_security_events
      SET outcome='BLOCKED' WHERE id='security-before-68'
    `)).toThrow(/immutable/iu);
  });

  it('accepts only the new password-change operation and account scope', async () => {
    database = fullSchema67Database();
    applyMigration0068(database);
    const accountHash = 'b'.repeat(64);
    const networkHash = 'c'.repeat(64);
    await expect(database.prepare(`
      INSERT INTO customer_security_rate_limits (
        operation,scope_type,scope_hash,window_started_at,
        window_expires_at,attempt_count,blocked_until,created_at,updated_at
      ) VALUES ('PASSWORD_CHANGE','ACCOUNT_ID',?,0,900000,1,NULL,1000,1000)
    `).bind(accountHash).run()).resolves.toMatchObject({ meta: { changes: 1 } });
    await expect(database.prepare(`
      INSERT INTO customer_auth_security_events (
        id,event_type,outcome,account_id,login_identifier_hash,
        network_source_hash,request_id,metadata_json,created_at
      ) VALUES ('password-change-limited','PASSWORD_CHANGE_RATE_LIMITED',
        'BLOCKED',NULL,NULL,?,'request-limited','{}',1000)
    `).bind(networkHash).run()).resolves.toMatchObject({ meta: { changes: 1 } });
    await expect(database.prepare(`
      INSERT INTO customer_security_rate_limits (
        operation,scope_type,scope_hash,window_started_at,
        window_expires_at,attempt_count,blocked_until,created_at,updated_at
      ) VALUES ('PASSWORD_CHANGE','RAW_ACCOUNT',?,0,900000,1,NULL,1000,1000)
    `).bind(accountHash).run()).rejects.toThrow();
  });

  it('rejects repeated application without changing Schema 68', async () => {
    database = fullSchema67Database();
    applyMigration0068(database);
    expect(() => applyMigration0068(database!)).toThrow();
    expect(await schemaVersion(database)).toBe(68);
  });
});

function fullSchema67Database(): SqliteDatabase {
  const value = new SqliteDatabase();
  const directory = path.resolve(process.cwd(), 'migrations');
  const files = readdirSync(directory)
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort()
    .slice(0, 67);
  for (const file of files) {
    applySql(value, readFileSync(path.join(directory, file), 'utf8'));
  }
  return value;
}

function applyMigration0068(target: SqliteDatabase): void {
  applySql(target, readFileSync(migrationPath, 'utf8'));
}

function applySql(target: SqliteDatabase, sql: string): void {
  target.exec('BEGIN IMMEDIATE;');
  try {
    target.exec(sql);
    target.exec('COMMIT;');
  } catch (error) {
    try { target.exec('ROLLBACK;'); } catch {}
    throw error;
  }
}

async function schemaVersion(target: SqliteDatabase): Promise<number> {
  const row = await target.prepare(`
    SELECT schema_version FROM app_schema_state WHERE singleton_id=1
  `).first<{ schema_version: number }>();
  return Number(row?.schema_version);
}
