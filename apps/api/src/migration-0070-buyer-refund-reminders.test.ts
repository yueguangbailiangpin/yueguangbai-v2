import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteDatabase } from '@ygb/testkit';

const migrationPath = path.resolve(process.cwd(), 'migrations/0070_buyer_refund_reminders.sql');
let database: SqliteDatabase | null = null;

afterEach(() => { database?.close(); database = null; });

describe('Migration 0070 buyer refund reminders', () => {
  it('advances a real non-empty Schema 69 database to 70 and preserves representative immutable facts', async () => {
    database = schema69();
    await seedRepresentativeFacts(database);
    const beforeFacts = await representativeFacts(database);

    applyMigration(database);

    expect(await schemaVersion(database)).toBe(70);
    expect(await representativeFacts(database)).toEqual(beforeFacts);
    expect(await database.prepare(`SELECT type FROM sqlite_schema WHERE name='idx_buyer_refund_reminders_obligation_recent'`).first()).toEqual({ type: 'index' });
    expect(await database.prepare(`SELECT type FROM sqlite_schema WHERE name='trg_buyer_refund_reminders_no_update'`).first()).toEqual({ type: 'trigger' });
    await expect(database.prepare(`
      INSERT INTO buyer_refund_reminders (
        id,obligation_id,buyer_customer_id,idempotency_key,reminded_at,created_at
      ) VALUES ('reminder-invalid','missing','reminder-buyer','buyer-reminder-invalid-0001',2000,2000)
    `).run()).rejects.toThrow(/source_invalid/u);
    await assertHealthy(database);
  });

  it('rejects wrong-order application with the complete non-empty Schema 69 snapshot unchanged', async () => {
    database = schema69();
    await seedRepresentativeFacts(database);
    database.exec(`UPDATE app_schema_state SET schema_version=68 WHERE singleton_id=1`);
    const before = await snapshot(database);

    expect(() => applyMigration(database!)).toThrow(/transaction_assertion_failed/u);

    await expectUnchangedAndHealthy(database, before, 68);
  });

  it('rejects repeated application with the complete Schema 70 snapshot unchanged', async () => {
    database = schema69();
    await seedRepresentativeFacts(database);
    applyMigration(database);
    const before = await snapshot(database);

    expect(() => applyMigration(database!)).toThrow(/transaction_assertion_failed/u);

    await expectUnchangedAndHealthy(database, before, 70);
  });

  it('fails closed on an explicitly non-empty partial-0070 reminder table without calling it an empty database', async () => {
    database = schema69();
    await seedRepresentativeFacts(database);
    database.exec(`
      CREATE TABLE buyer_refund_reminders (
        id TEXT PRIMARY KEY,
        dirty_marker TEXT NOT NULL
      ) STRICT;
      INSERT INTO buyer_refund_reminders (id,dirty_marker)
      VALUES ('partial-0070-reminder','non-empty-preexisting-stock');
    `);
    const before = await snapshot(database);

    expect(() => applyMigration(database!)).toThrow(/buyer_refund_reminders.*already exists/iu);

    await expectUnchangedAndHealthy(database, before, 69);
    expect(await database.prepare(`SELECT * FROM buyer_refund_reminders`).first())
      .toEqual({ id: 'partial-0070-reminder', dirty_marker: 'non-empty-preexisting-stock' });
  });
});

function schema69(): SqliteDatabase {
  const value = new SqliteDatabase();
  const directory = path.resolve(process.cwd(), 'migrations');
  for (const file of readdirSync(directory)
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort()
    .slice(0, 69)) {
    applySql(value, readFileSync(path.join(directory, file), 'utf8'));
  }
  return value;
}

function applyMigration(target: SqliteDatabase): void {
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

async function seedRepresentativeFacts(target: SqliteDatabase): Promise<void> {
  await target.prepare(`
    INSERT INTO buyer_channels (
      id,code,name,status,next_sequence,version,created_at,updated_at,disabled_at
    ) VALUES (
      'migration-0070-channel','M0070','Migration 0070 preservation channel',
      'ACTIVE',2,1,1000,1000,NULL
    )
  `).run();
  await target.prepare(`
    INSERT INTO command_idempotency_records (
      actor_type,actor_id,idempotency_key,action,target_type,target_id,
      request_hash,status,lease_token,lease_expires_at,attempt_count,
      response_json,result_references_json,error_code,created_at,updated_at,
      completed_at
    ) VALUES (
      'SYSTEM','migration-0070-preservation','migration-0070-preserve-key',
      'MIGRATION_0070_TEST','MIGRATION','0070','${'a'.repeat(64)}',
      'COMMITTED','command-lease:migration-0070',2000,1,
      '{"preserved":true}','{}',NULL,1000,1000,1000
    )
  `).run();
  await target.prepare(`
    INSERT INTO audit_events (
      id,aggregate_type,aggregate_id,event_type,actor_type,actor_id,
      actor_roles_json,request_id,idempotency_key,previous_state_json,
      next_state_json,reason,metadata_json,created_at
    ) VALUES (
      'migration-0070-audit','MIGRATION_TEST','0070',
      'MIGRATION_0070_PRESERVATION','SYSTEM','migration-0070-preservation',
      '[]','request:migration-0070','migration-0070-preserve-key',NULL,
      '{"preserved":true}',NULL,'{}',1000
    )
  `).run();
}

async function schemaVersion(target: SqliteDatabase): Promise<number> {
  return Number((await target.prepare(`
    SELECT schema_version FROM app_schema_state WHERE singleton_id=1
  `).first<{ schema_version: number }>())?.schema_version);
}

async function representativeFacts(target: SqliteDatabase): Promise<unknown> {
  const buyerChannel = await target.prepare(`
    SELECT id,code,name,status,next_sequence,version,created_at,updated_at,disabled_at
    FROM buyer_channels WHERE id='migration-0070-channel'
  `).all();
  const command = await target.prepare(`
    SELECT actor_type,actor_id,idempotency_key,action,target_type,target_id,
      request_hash,status,lease_token,lease_expires_at,attempt_count,
      response_json,result_references_json,error_code,created_at,updated_at,
      completed_at
    FROM command_idempotency_records
    WHERE actor_id='migration-0070-preservation'
  `).all();
  const audit = await target.prepare(`
    SELECT id,aggregate_type,aggregate_id,event_type,actor_type,actor_id,
      actor_roles_json,request_id,idempotency_key,previous_state_json,
      next_state_json,reason,metadata_json,created_at
    FROM audit_events WHERE id='migration-0070-audit'
  `).all();
  return {
    buyerChannel: buyerChannel.results,
    command: command.results,
    audit: audit.results,
  };
}

async function snapshot(target: SqliteDatabase): Promise<string> {
  const schema = await target.prepare(`
    SELECT type,name,tbl_name,sql FROM sqlite_schema
    WHERE name NOT LIKE 'sqlite_%'
    ORDER BY type,name
  `).all();
  return JSON.stringify({
    schema: schema.results,
    facts: await representativeFacts(target),
  });
}

async function assertHealthy(target: SqliteDatabase): Promise<void> {
  expect(await target.prepare('PRAGMA integrity_check').first())
    .toEqual({ integrity_check: 'ok' });
  expect((await target.prepare('PRAGMA foreign_key_check').all()).results)
    .toEqual([]);
}

async function expectUnchangedAndHealthy(
  target: SqliteDatabase,
  before: string,
  expectedSchema: number,
): Promise<void> {
  expect(await snapshot(target)).toBe(before);
  expect(await schemaVersion(target)).toBe(expectedSchema);
  await assertHealthy(target);
}
