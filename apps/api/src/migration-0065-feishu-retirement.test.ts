import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteDatabase } from '@ygb/testkit';

const migrationDirectory = path.resolve(process.cwd(), 'migrations');
const migrations = readdirSync(migrationDirectory)
  .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
  .sort();
const retirementMigration = readFileSync(
  path.join(migrationDirectory, '0065_retire_feishu_artifacts.sql'),
  'utf8',
);
let database: SqliteDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe('Migration 0065 Feishu retirement', () => {
  it('removes every retired object from the confirmed empty system', async () => {
    database = schema64Database();
    applyRetirement(database);

    await expect(database.prepare(`
      SELECT schema_version FROM app_schema_state WHERE singleton_id=1
    `).first()).resolves.toEqual({ schema_version: 65 });
    const retired = await database.prepare(`
      SELECT type,name FROM sqlite_schema
      WHERE lower(COALESCE(name,'')) LIKE '%feishu%'
         OR lower(COALESCE(sql,'')) LIKE '%feishu%'
    `).all();
    expect(retired.results).toEqual([]);
    for (const table of [
      'staff_login_states',
      'staff_auth_rate_limits',
      'staff_auth_security_events',
      'staff_binding_invitations',
      'staff_binding_login_states',
    ]) {
      expect(await database.prepare(`
        SELECT name FROM sqlite_schema WHERE type='table' AND name=?
      `).bind(table).first()).toBeNull();
    }
    await expect(database.prepare(`
      INSERT INTO scheduled_job_states(job_name,updated_at)
      VALUES ('feishu_sync',1)
    `).run()).rejects.toThrow();
    await expect(database.prepare(`
      INSERT INTO scheduled_job_states(job_name,updated_at)
      VALUES ('staff_auth_cleanup',1)
    `).run()).rejects.toThrow();
    expect(database.raw.prepare('PRAGMA integrity_check').get())
      .toEqual({ integrity_check: 'ok' });
    expect(database.raw.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('refuses cleanup when the empty-system premise is false', async () => {
    database = schema64Database();
    database.exec(`
      INSERT INTO scheduled_job_states(job_name,updated_at)
      VALUES ('outbox_delivery',1)
    `);
    expect(() => applyRetirement(database as SqliteDatabase)).toThrow();
    expect(database.raw.prepare(`
      SELECT schema_version FROM app_schema_state WHERE singleton_id=1
    `).get()).toEqual({ schema_version: 64 });
    expect(database.raw.prepare(`
      SELECT job_name FROM scheduled_job_states
    `).all()).toEqual([{ job_name: 'outbox_delivery' }]);
  });
});

function schema64Database(): SqliteDatabase {
  const result = new SqliteDatabase();
  for (const name of migrations.slice(0, 64)) {
    result.exec(readFileSync(path.join(migrationDirectory, name), 'utf8'));
  }
  return result;
}

function applyRetirement(target: SqliteDatabase): void {
  target.exec('BEGIN IMMEDIATE;');
  try {
    target.exec(retirementMigration);
    target.exec('COMMIT;');
  } catch (error) {
    target.exec('ROLLBACK;');
    throw error;
  }
}
