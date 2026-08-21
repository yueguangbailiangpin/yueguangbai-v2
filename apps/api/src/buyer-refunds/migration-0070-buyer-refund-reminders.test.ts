import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteDatabase } from '@ygb/testkit';

const migrationPath = path.resolve(process.cwd(), 'migrations/0070_buyer_refund_reminders.sql');
let database: SqliteDatabase | null = null;

afterEach(() => { database?.close(); database = null; });

describe('Migration 0070 buyer refund reminders', () => {
  it('uses Cloudflare D1-compatible trigger RAISE syntax', () => {
    const source = readFileSync(migrationPath, 'utf8');

    expect(source).toContain(
      "SELECT RAISE(ABORT, 'buyer_refund_reminder_source_invalid')",
    );
    expect(source).toContain('WHERE NOT EXISTS (');
    expect(source).not.toMatch(
      /SELECT\s+CASE\s+WHEN[\s\S]{0,500}THEN\s+RAISE\s*\(/iu,
    );
  });

  it('advances a real non-empty Schema 69 database to 70 and preserves every preexisting user-table schema and row', async () => {
    database = schema69();
    await seedRepresentativeFacts(database);
    const before = await canonicalSnapshot(database, {
      normalizeSchemaVersion: true,
    });

    applyMigration(database);

    expect(await schemaVersion(database)).toBe(70);
    expect(await canonicalSnapshot(database, {
      schemaObjectKeys: new Set(before.schema.map(schemaObjectKey)),
      tableNames: new Set(before.tables.map((table) => table.name)),
      normalizeSchemaVersion: true,
    })).toEqual(before);
    expect(await database.prepare(`SELECT type FROM sqlite_schema WHERE name='idx_buyer_refund_reminders_obligation_recent'`).first()).toEqual({ type: 'index' });
    expect(await database.prepare(`SELECT type FROM sqlite_schema WHERE name='trg_buyer_refund_reminders_no_update'`).first()).toEqual({ type: 'trigger' });
    await assertHealthy(database);
  });

  it('preserves absent, mismatched-Buyer, and exact-match source behavior', async () => {
    database = schema69();
    applyMigration(database);

    await expect(database.prepare(`
      INSERT INTO buyer_refund_reminders (
        id,obligation_id,buyer_customer_id,idempotency_key,reminded_at,created_at
      ) VALUES ('reminder-invalid','missing','reminder-buyer','buyer-reminder-invalid-0001',2000,2000)
    `).run()).rejects.toThrow(/source_invalid/u);

    const obligationGuard = await database.prepare(`
      SELECT sql FROM sqlite_schema
      WHERE type='trigger' AND name='trg_buyer_refund_obligation_source_guard'
    `).first<{ sql: string }>();
    expect(obligationGuard?.sql).toBeTruthy();
    database.exec('PRAGMA foreign_keys=OFF;');
    database.exec('BEGIN IMMEDIATE;');
    try {
      database.exec('DROP TRIGGER trg_buyer_refund_obligation_source_guard;');
      database.exec(`
        INSERT INTO buyer_refund_obligations (
          id,source_review_event_id,review_case_id,formal_order_id,
          buyer_customer_id,due_amount_cny_fen,version,created_at,updated_at
        ) VALUES (
          'reminder-obligation','reminder-event','reminder-case',
          'reminder-order','reminder-buyer',100,1,2000,2000
        );
      `);
      database.exec(`${obligationGuard!.sql};`);

      await expect(database.prepare(`
        INSERT INTO buyer_refund_reminders (
          id,obligation_id,buyer_customer_id,idempotency_key,reminded_at,created_at
        ) VALUES (
          'reminder-wrong-buyer','reminder-obligation','different-buyer',
          'buyer-reminder-wrong-0001',2001,2001
        )
      `).run()).rejects.toThrow(/source_invalid/u);
      await expect(database.prepare(`
        INSERT INTO buyer_refund_reminders (
          id,obligation_id,buyer_customer_id,idempotency_key,reminded_at,created_at
        ) VALUES (
          'reminder-valid','reminder-obligation','reminder-buyer',
          'buyer-reminder-valid-0001',2002,2002
        )
      `).run()).resolves.toBeTruthy();
      expect(await database.prepare(`
        SELECT obligation_id,buyer_customer_id
        FROM buyer_refund_reminders WHERE id='reminder-valid'
      `).first()).toEqual({
        obligation_id: 'reminder-obligation',
        buyer_customer_id: 'reminder-buyer',
      });
      database.exec('ROLLBACK;');
    } catch (error) {
      try { database.exec('ROLLBACK;'); } catch {}
      throw error;
    } finally {
      database.exec('PRAGMA foreign_keys=ON;');
    }
    await assertHealthy(database);
  });

  it('rejects wrong-order application with the complete non-empty Schema 69 snapshot unchanged', async () => {
    database = schema69();
    await seedRepresentativeFacts(database);
    database.exec(`UPDATE app_schema_state SET schema_version=68 WHERE singleton_id=1`);
    const before = await canonicalSnapshot(database);

    expect(() => applyMigration(database!)).toThrow(/transaction_assertion_failed/u);

    await expectUnchangedAndHealthy(database, before, 68);
  });

  it('rejects repeated application with the complete Schema 70 snapshot unchanged', async () => {
    database = schema69();
    await seedRepresentativeFacts(database);
    applyMigration(database);
    const before = await canonicalSnapshot(database);

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
    const before = await canonicalSnapshot(database);

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

interface CanonicalSchemaObject {
  type: string;
  name: string;
  table: string;
  sql: string | null;
}

interface CanonicalColumn {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

type CanonicalValue = readonly [kind: string, value: string];

interface CanonicalTable {
  name: string;
  columns: readonly CanonicalColumn[];
  rows: readonly (readonly [column: string, value: CanonicalValue])[][];
}

interface CanonicalSnapshot {
  schema: readonly CanonicalSchemaObject[];
  tables: readonly CanonicalTable[];
}

interface SnapshotScope {
  schemaObjectKeys?: ReadonlySet<string>;
  tableNames?: ReadonlySet<string>;
  normalizeSchemaVersion?: boolean;
}

async function canonicalSnapshot(
  target: SqliteDatabase,
  scope: SnapshotScope = {},
): Promise<CanonicalSnapshot> {
  const schemaRows = await target.prepare(`
    SELECT type,name,tbl_name,sql FROM sqlite_schema
    WHERE name NOT LIKE 'sqlite_%'
    ORDER BY type,name
  `).all<{
    type: string;
    name: string;
    tbl_name: string;
    sql: string | null;
  }>();
  const schema = schemaRows.results
    .map((row): CanonicalSchemaObject => ({
      type: String(row.type),
      name: String(row.name),
      table: String(row.tbl_name),
      sql: row.sql === null ? null : String(row.sql),
    }))
    .filter((object) => !scope.schemaObjectKeys
      || scope.schemaObjectKeys.has(schemaObjectKey(object)));
  const tableNames = schema
    .filter((object) => object.type === 'table')
    .map((object) => object.name)
    .filter((name) => !scope.tableNames || scope.tableNames.has(name));
  const tables = await Promise.all(tableNames.map(async (name) => {
    const columns = (await target.prepare(
      `PRAGMA table_info(${quoteIdentifier(name)})`,
    ).all<{
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }>()).results.map((column): CanonicalColumn => ({
      cid: Number(column.cid),
      name: String(column.name),
      type: String(column.type),
      notnull: Number(column.notnull),
      dflt_value: column.dflt_value === null ? null : String(column.dflt_value),
      pk: Number(column.pk),
    }));
    const rows = (await target.prepare(
      `SELECT * FROM ${quoteIdentifier(name)}`,
    ).all<Record<string, unknown>>()).results.map((row) => columns.map(
      (column): readonly [string, CanonicalValue] => [
        column.name,
        serializeValue(
          scope.normalizeSchemaVersion
            && name === 'app_schema_state'
            && column.name === 'schema_version'
            ? '__CURRENT_SCHEMA_VERSION__'
            : row[column.name],
        ),
      ],
    ));
    rows.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    return { name, columns, rows } satisfies CanonicalTable;
  }));
  return { schema, tables };
}

function schemaObjectKey(object: CanonicalSchemaObject): string {
  return `${object.type}\u0000${object.name}`;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function serializeValue(value: unknown): CanonicalValue {
  if (value === null) return ['null', ''];
  if (value instanceof Uint8Array) return ['blob', Buffer.from(value).toString('hex')];
  if (typeof value === 'number') {
    return ['number', Object.is(value, -0) ? '-0' : String(value)];
  }
  if (typeof value === 'bigint') return ['bigint', value.toString()];
  return [typeof value, String(value)];
}

async function assertHealthy(target: SqliteDatabase): Promise<void> {
  expect(await target.prepare('PRAGMA integrity_check').first())
    .toEqual({ integrity_check: 'ok' });
  expect((await target.prepare('PRAGMA foreign_key_check').all()).results)
    .toEqual([]);
}

async function expectUnchangedAndHealthy(
  target: SqliteDatabase,
  before: CanonicalSnapshot,
  expectedSchema: number,
): Promise<void> {
  expect(await canonicalSnapshot(target)).toEqual(before);
  expect(await schemaVersion(target)).toBe(expectedSchema);
  await assertHealthy(target);
}
