import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteDatabase } from '@ygb/testkit';

const migrationPath = path.resolve(process.cwd(), 'migrations/0070_buyer_refund_reminders.sql');
let database: SqliteDatabase | null = null;

afterEach(() => { database?.close(); database = null; });

describe('Migration 0070 buyer refund reminders', () => {
  it('advances only Schema 69 to 70, preserves prior facts, and creates guarded immutable reminder storage', async () => {
    database = schema69();
    applyMigration(database);
    expect(await schemaVersion(database)).toBe(70);
    expect(await database.prepare(`SELECT type FROM sqlite_schema WHERE name='idx_buyer_refund_reminders_obligation_recent'`).first()).toEqual({ type: 'index' });
    expect(await database.prepare(`SELECT type FROM sqlite_schema WHERE name='trg_buyer_refund_reminders_no_update'`).first()).toEqual({ type: 'trigger' });
    await expect(database.prepare(`
      INSERT INTO buyer_refund_reminders (
        id,obligation_id,buyer_customer_id,idempotency_key,reminded_at,created_at
      ) VALUES ('reminder-invalid','missing','reminder-buyer','buyer-reminder-invalid-0001',2000,2000)
    `).run()).rejects.toThrow(/source_invalid/u);
  });

  it('rejects wrong-order and repeat application without changing the dirty Schema 69 snapshot', async () => {
    database = schema69();
    const before = await snapshot(database);
    database.exec(`UPDATE app_schema_state SET schema_version=68 WHERE singleton_id=1`);
    expect(() => applyMigration(database!)).toThrow(/transaction_assertion_failed/u);
    expect(await schemaVersion(database)).toBe(68);
    database.exec(`UPDATE app_schema_state SET schema_version=69 WHERE singleton_id=1`);
    expect(await snapshot(database)).toBe(before);
    applyMigration(database);
    const afterFirst = await snapshot(database);
    expect(() => applyMigration(database!)).toThrow(/transaction_assertion_failed/u);
    expect(await snapshot(database)).toBe(afterFirst);
  });
});

function schema69(): SqliteDatabase {
  const value = new SqliteDatabase();
  const directory = path.resolve(process.cwd(), 'migrations');
  for (const file of readdirSync(directory).filter((name) => /^\d{4}_.+\.sql$/u.test(name)).sort().slice(0, 69)) {
    applySql(value, readFileSync(path.join(directory, file), 'utf8'));
  }
  return value;
}

function applyMigration(target: SqliteDatabase): void { applySql(target, readFileSync(migrationPath, 'utf8')); }
function applySql(target: SqliteDatabase, sql: string): void { target.exec('BEGIN IMMEDIATE;'); try { target.exec(sql); target.exec('COMMIT;'); } catch (error) { try { target.exec('ROLLBACK;'); } catch {} throw error; } }
async function schemaVersion(target: SqliteDatabase): Promise<number> { return Number((await target.prepare(`SELECT schema_version FROM app_schema_state WHERE singleton_id=1`).first<{schema_version:number}>())?.schema_version); }
async function snapshot(target: SqliteDatabase): Promise<string> { return JSON.stringify(await target.prepare(`SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name`).all()); }
