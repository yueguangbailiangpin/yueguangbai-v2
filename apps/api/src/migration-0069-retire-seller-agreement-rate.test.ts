import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createMigratedTestDatabase,
  SqliteDatabase,
} from '@ygb/testkit';
import { seedConfirmedColdArchiveOrder } from '../test-support/cold-archive-fixture';

const migrationPath = path.resolve(
  process.cwd(),
  'migrations/0069_retire_seller_agreement_rate_runtime.sql',
);
const zeroStockTables = [
  'seller_agreement_rate_versions',
  'seller_agreement_rate_events',
  'seller_agreement_currency_rate_versions',
  'formal_orders',
  'formal_order_financial_snapshots',
  'formal_order_marketplace_money_snapshots',
  'seller_principal_rate_snapshots',
  'formal_order_events',
  'review_cases',
  'review_events',
  'seller_payables',
  'buyer_refund_obligations',
  'buyer_advance_principal_entries',
  'order_archive_closures',
] as const;
let database: SqliteDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe('Migration 0069 Seller Agreement Rate retirement', () => {
  it('uses bounded checks that Cloudflare D1 accepts in a migration', () => {
    const source = readFileSync(migrationPath, 'utf8');

    expect(source).not.toMatch(
      /pragma_(?:integrity|quick)_check|PRAGMA\s+(?:integrity|quick)_check/iu,
    );
    expect(source.match(/pragma_foreign_key_check/giu)).toHaveLength(2);
    expect(source).toContain('exporting the D1 database');
    expect(source).toContain('reconstructing it in native');
  });

  it('enumerates every owner-confirmed dirty-stock table exactly once', () => {
    const source = readFileSync(migrationPath, 'utf8');
    const start = source.indexOf(
      '(SELECT COUNT(*) FROM seller_agreement_rate_versions)=0',
    );
    const end = source.indexOf('THEN 1 ELSE 0 END;', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const stockGuard = source.slice(start, end);
    const enumerated = [...stockGuard.matchAll(
      /\(SELECT COUNT\(\*\) FROM ([a-z_]+)\)=0/gu,
    )].map((match) => match[1]);

    expect(enumerated).toEqual(zeroStockTables);
    expect(stockGuard).toMatch(
      /aggregate_type IN \(\s*'SELLER_AGREEMENT_RATE',\s*'SELLER_AGREEMENT_CURRENCY_RATE'\s*\)/u,
    );
    expect(stockGuard).toMatch(
      /event_type LIKE 'SELLER_AGREEMENT_RATE_%'/u,
    );
    expect(stockGuard).toMatch(
      /action IN \(\s*'SUBMIT_SELLER_AGREEMENT_RATE'/u,
    );
  });

  it('builds fresh from 0001 through 0069 with exact health', async () => {
    database = schemaDatabase(69);

    expect(await schemaVersion(database)).toBe(69);
    expect(await database.prepare('PRAGMA integrity_check').first()).toEqual({
      integrity_check: 'ok',
    });
    expect((await database.prepare('PRAGMA foreign_key_check').all()).results)
      .toEqual([]);
  });

  it('advances an empty Schema 68 database and removes every legacy object', async () => {
    database = schemaDatabase(68);

    applyMigration0069(database);

    expect(await schemaVersion(database)).toBe(69);
    const legacyObjects = await database.prepare(`
      SELECT name FROM sqlite_schema
      WHERE name LIKE '%seller_agreement%'
      ORDER BY name
    `).all();
    expect(legacyObjects.results).toEqual([]);
    expect(await columns(database, 'formal_order_financial_snapshots')).not
      .toContain('seller_rate_version_id');
    expect(await columns(database, 'formal_order_financial_snapshots')).not
      .toContain('seller_cny_per_jpy_e8');
    expect(await columns(database, 'formal_order_marketplace_money_snapshots'))
      .not.toContain('seller_rate_value');
    expect(await database.prepare('PRAGMA integrity_check').first()).toEqual({
      integrity_check: 'ok',
    });
    expect((await database.prepare('PRAGMA foreign_key_check').all()).results)
      .toEqual([]);
  });

  it('rejects wrong-order and repeated application without partial changes', async () => {
    database = schemaDatabase(67);
    const wrongOrderBefore = await snapshot(database);
    expect(() => applyMigration0069(database!)).toThrow();
    expect(await snapshot(database)).toBe(wrongOrderBefore);
    expect(await schemaVersion(database)).toBe(67);
    database.close();

    database = schemaDatabase(68);
    applyMigration0069(database);
    const repeatBefore = await snapshot(database);
    expect(() => applyMigration0069(database!)).toThrow();
    expect(await snapshot(database)).toBe(repeatBefore);
    expect(await schemaVersion(database)).toBe(69);
  });

  it('rejects a dirty legacy rate definition and preserves Schema 68 exactly', async () => {
    database = schemaDatabase(68);
    seedLegacyAgreementRate(database);
    const before = await snapshot(database);

    expect(() => applyMigration0069(database!)).toThrow();

    expect(await snapshot(database)).toBe(before);
    expect(await schemaVersion(database)).toBe(68);
    expect(await database.prepare(`
      SELECT COUNT(*) AS count FROM seller_agreement_rate_versions
    `).first()).toEqual({ count: 1 });
    expect(await database.prepare('PRAGMA integrity_check').first()).toEqual({
      integrity_check: 'ok',
    });
    expect((await database.prepare('PRAGMA foreign_key_check').all()).results)
      .toEqual([]);
  });

  it.each([
    ['legacy Audit residue', seedLegacyAuditResidue],
    ['legacy Outbox residue', seedLegacyOutboxResidue],
    ['legacy idempotency residue', seedLegacyIdempotencyResidue],
  ] as const)('rejects %s independently and preserves Schema 68', async (
    _label,
    seed,
  ) => {
    database = schemaDatabase(68);
    seed(database);
    const before = await snapshot(database);

    expect(() => applyMigration0069(database!)).toThrow();

    expect(await snapshot(database)).toBe(before);
    expect(await schemaVersion(database)).toBe(68);
    expect(await database.prepare('PRAGMA integrity_check').first()).toEqual({
      integrity_check: 'ok',
    });
    expect((await database.prepare('PRAGMA foreign_key_check').all()).results)
      .toEqual([]);
  });

  it('rejects a complete healthy Schema 68 formal-order chain unchanged', async () => {
    database = schemaDatabase(68);
    await seedCompleteSchema68FormalOrderChain(database);
    const chain = await database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM formal_orders) AS orders,
        (SELECT COUNT(*) FROM formal_order_financial_snapshots) AS financial,
        (SELECT COUNT(*) FROM formal_order_marketplace_money_snapshots)
          AS marketplace_money,
        (SELECT COUNT(*) FROM seller_principal_rate_snapshots) AS principal,
        (SELECT COUNT(*) FROM seller_payables) AS payables,
        (SELECT COUNT(*) FROM formal_order_events) AS events
    `).first();
    expect(chain).toEqual({
      orders: 1,
      financial: 1,
      marketplace_money: 1,
      principal: 1,
      payables: 1,
      events: 1,
    });
    expect(await database.prepare('PRAGMA integrity_check').first()).toEqual({
      integrity_check: 'ok',
    });
    expect((await database.prepare('PRAGMA foreign_key_check').all()).results)
      .toEqual([]);
    const before = await snapshot(database);

    expect(() => applyMigration0069(database!)).toThrow();

    expect(await snapshot(database)).toBe(before);
    expect(await schemaVersion(database)).toBe(68);
    expect((await database.prepare('PRAGMA foreign_key_check').all()).results)
      .toEqual([]);
  });

  it('preserves every direct FK, trigger, index, and view not replaced', async () => {
    database = schemaDatabase(68);
    const preservedNames = [
      'review_events',
      'seller_payables',
      'trg_review_event_identity_guard',
      'trg_seller_payable_source_guard',
      'trg_seller_principal_rate_snapshot_confirmation_guard',
      'trg_advance_principal_full_payment_amount_guard',
      'trg_formal_order_financial_self_pay_guard',
      'trg_formal_order_financial_snapshots_no_update',
      'trg_formal_order_financial_snapshots_no_delete',
      'trg_buyer_marketplace_assignment_fact_guard',
      'trg_formal_order_marketplace_money_no_update',
      'trg_formal_order_marketplace_money_no_delete',
      'idx_formal_order_marketplace_money_buyer',
      'idx_formal_order_marketplace_money_seller',
      'internal_order_finance_positions',
      'internal_finance_exceptions',
    ] as const;
    const before = await objectSql(database, preservedNames);

    applyMigration0069(database);

    expect(await objectSql(database, preservedNames)).toEqual(before);
    expect(await foreignKeys(database, 'review_events')).toContainEqual({
      table: 'formal_order_financial_snapshots',
      from: 'formal_order_financial_snapshot_id',
      to: 'id',
    });
    expect(await foreignKeys(database, 'seller_payables')).toContainEqual({
      table: 'formal_order_financial_snapshots',
      from: 'financial_snapshot_id',
      to: 'id',
    });
  });

  it('installs principal-policy-only replacement guards', async () => {
    database = schemaDatabase(68);

    applyMigration0069(database);

    const guards = await objectSql(database, [
      'trg_formal_order_financial_snapshot_guard',
      'trg_formal_order_marketplace_money_source_guard',
    ]);
    expect(guards['trg_formal_order_financial_snapshot_guard'])
      .not.toContain('seller_agreement');
    expect(guards['trg_formal_order_marketplace_money_source_guard'])
      .toContain('seller_principal_rate_snapshots');
    expect(guards['trg_formal_order_marketplace_money_source_guard'])
      .not.toContain('seller_agreement');
  });
});

function schemaDatabase(count: number): SqliteDatabase {
  const value = new SqliteDatabase();
  const directory = path.resolve(process.cwd(), 'migrations');
  const files = readdirSync(directory)
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort()
    .slice(0, count);
  for (const file of files) {
    applySql(value, readFileSync(path.join(directory, file), 'utf8'));
  }
  return value;
}

function seedLegacyAgreementRate(target: SqliteDatabase): void {
  target.exec(`
    INSERT INTO staff_users (
      id,display_name,status,authorization_version,version,
      created_at,updated_at,disabled_at
    ) VALUES ('migration-69-owner','Owner','ACTIVE',1,1,1,1,NULL);
    INSERT INTO seller_organizations (
      id,marketplace_code,seller_code,origin_channel_id,current_channel_id,
      seller_sequence,organization_name,status,version,created_at,updated_at,
      activated_at,disabled_at,next_member_number
    ) VALUES (
      'migration-69-seller','JP','migration-69-seller-code',
      'seller-channel-ido-mango','seller-channel-ido-mango',
      69,'Migration 69 Seller','ACTIVE',1,1,1,1,NULL,2
    );
    INSERT INTO seller_agreement_rate_versions (
      id,organization_id,review_type,version_no,status,cny_per_jpy_e8,
      effective_from,submitted_by_staff_id,submitted_at,decision_version,
      confirmed_by_staff_id,confirmed_at,rejected_by_staff_id,rejected_at,
      rejection_reason
    ) VALUES (
      'migration-69-legacy-rate','migration-69-seller',NULL,1,'SUBMITTED',
      5000000,10000,'migration-69-owner',1000,1,NULL,NULL,NULL,NULL,NULL
    );
  `);
}

async function seedCompleteSchema68FormalOrderChain(
  target: SqliteDatabase,
): Promise<void> {
  const source = createMigratedTestDatabase();
  try {
    await seedConfirmedColdArchiveOrder(source, 'migration-69-chain');
    const triggers = target.raw.prepare(`
      SELECT name,sql FROM sqlite_schema
      WHERE type='trigger' ORDER BY name
    `).all() as Array<{ name: string; sql: string }>;
    target.exec('PRAGMA foreign_keys=OFF;');
    for (const trigger of triggers) {
      target.exec(`DROP TRIGGER "${trigger.name}";`);
    }

    const targetTables = target.raw.prepare(`
      SELECT name FROM sqlite_schema
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all().map((row) => String(row['name']));
    const sourceTables = new Set(source.raw.prepare(`
      SELECT name FROM sqlite_schema
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
    `).all().map((row) => String(row['name'])));
    const custom = new Set([
      'app_schema_state',
      'formal_order_financial_snapshots',
      'formal_order_marketplace_money_snapshots',
      'seller_agreement_rate_versions',
      'seller_agreement_rate_events',
      'seller_agreement_currency_rate_versions',
    ]);
    for (const table of targetTables) {
      if (table !== 'app_schema_state') target.exec(`DELETE FROM "${table}";`);
    }
    for (const table of targetTables) {
      if (!custom.has(table) && sourceTables.has(table)) {
        copyRows(source, target, table);
      }
    }

    target.exec(`
      INSERT INTO seller_agreement_rate_versions (
        id,organization_id,review_type,version_no,status,cny_per_jpy_e8,
        effective_from,submitted_by_staff_id,submitted_at,decision_version,
        confirmed_by_staff_id,confirmed_at,rejected_by_staff_id,rejected_at,
        rejection_reason
      ) VALUES (
        'migration-69-chain-rate','cold-seller-migration-69-chain',NULL,1,
        'CONFIRMED',6000000,3000,'cold-archive-owner',1000,2,
        'cold-archive-owner',2000,NULL,NULL,NULL
      );
      INSERT INTO seller_agreement_rate_events (
        id,version_id,organization_id,business_date,review_type,version_no,
        event_type,actor_staff_id,previous_status,next_status,cny_per_jpy_e8,
        fee_cny_fen,effective_from,reason,idempotency_key,created_at
      ) VALUES (
        'migration-69-chain-rate-event','migration-69-chain-rate',
        'cold-seller-migration-69-chain',NULL,NULL,1,
        'SELLER_AGREEMENT_RATE_CONFIRMED','cold-archive-owner','SUBMITTED',
        'CONFIRMED',6000000,NULL,3000,NULL,'migration-69-chain-rate',2000
      );
      INSERT INTO seller_agreement_currency_rate_versions (
        id,legacy_rate_id,seller_organization_id,source_currency_code,
        quote_currency_code,version_no,status,rate_value,rate_scale,
        rounding_rule,effective_from,submitted_by_staff_id,submitted_at,
        decision_version,confirmed_by_staff_id,confirmed_at,
        rejected_by_staff_id,rejected_at,rejection_reason
      ) VALUES (
        'currency-migration-69-chain-rate','migration-69-chain-rate',
        'cold-seller-migration-69-chain','JPY','CNY',1,'CONFIRMED',
        6000000,100000000,'HALF_UP',3000,'cold-archive-owner',1000,2,
        'cold-archive-owner',2000,NULL,NULL,NULL
      );
    `);
    copyRows(source, target, 'formal_order_financial_snapshots', {
      seller_rate_version_id: 'migration-69-chain-rate',
      seller_rate_version_no: 1,
      seller_rate_effective_from: 3000,
      seller_rate_confirmed_at: 2000,
      seller_cny_per_jpy_e8: 6000000,
    });
    copyRows(source, target, 'formal_order_marketplace_money_snapshots', {
      seller_rate_version_id: 'currency-migration-69-chain-rate',
      seller_rate_version_no: 1,
      seller_rate_effective_from: 3000,
      seller_rate_confirmed_at: 2000,
      seller_rate_value: 6000000,
      seller_rate_scale: 100000000,
    });
    for (const trigger of triggers) target.exec(`${trigger.sql};`);
    target.exec('PRAGMA foreign_keys=ON;');
  } finally {
    source.close();
  }
}

function copyRows(
  source: SqliteDatabase,
  target: SqliteDatabase,
  table: string,
  overrides: Record<string, SQLInputValue> = {},
): void {
  const targetColumns = target.raw.prepare(`PRAGMA table_info("${table}")`)
    .all().map((column) => String(column['name']));
  const sourceColumns = new Set(source.raw
    .prepare(`PRAGMA table_info("${table}")`).all()
    .map((column) => String(column['name'])));
  const columns = targetColumns.filter((column) =>
    sourceColumns.has(column) || Object.hasOwn(overrides, column));
  const rows = source.raw.prepare(`SELECT * FROM "${table}"`).all() as
    Array<Record<string, SQLInputValue>>;
  if (rows.length === 0) return;
  const quoted = columns.map((column) => `"${column}"`).join(',');
  const placeholders = columns.map(() => '?').join(',');
  const insert = target.raw.prepare(
    `INSERT INTO "${table}" (${quoted}) VALUES (${placeholders})`,
  );
  for (const row of rows) {
    insert.run(...columns.map((column) =>
      Object.hasOwn(overrides, column) ? overrides[column]! : row[column]!));
  }
}

function seedLegacyAuditResidue(target: SqliteDatabase): void {
  target.exec(`
    INSERT INTO audit_events (
      id,aggregate_type,aggregate_id,event_type,actor_type,actor_id,
      actor_roles_json,request_id,idempotency_key,previous_state_json,
      next_state_json,reason,metadata_json,created_at
    ) VALUES (
      'migration-69-legacy-audit','SELLER_AGREEMENT_RATE','legacy-rate',
      'SELLER_AGREEMENT_RATE_SUBMITTED','STAFF','owner','["owner"]',
      'migration-69-request','migration-69-audit-key',NULL,'{}',NULL,'{}',1
    );
  `);
}

function seedLegacyOutboxResidue(target: SqliteDatabase): void {
  target.exec(`
    INSERT INTO integration_outbox (
      id,dedup_key,event_type,aggregate_type,aggregate_id,payload_json,
      payload_hash,status,available_at,lease_token,lease_expires_at,
      attempt_count,last_error,created_at,updated_at,sent_at
    ) VALUES (
      'migration-69-legacy-outbox','migration-69-legacy-outbox-dedup',
      'SELLER_AGREEMENT_RATE_SUBMITTED','SELLER_AGREEMENT_RATE','legacy-rate',
      '{}','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'PENDING',1,NULL,NULL,0,NULL,1,1,NULL
    );
  `);
}

function seedLegacyIdempotencyResidue(target: SqliteDatabase): void {
  target.exec(`
    INSERT INTO command_idempotency_records (
      actor_type,actor_id,idempotency_key,action,target_type,target_id,
      request_hash,status,lease_token,lease_expires_at,attempt_count,
      response_json,result_references_json,error_code,created_at,updated_at,
      completed_at
    ) VALUES (
      'STAFF','owner','migration-69-legacy-idempotency',
      'SUBMIT_SELLER_AGREEMENT_RATE','SELLER_AGREEMENT_RATE','legacy-rate',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'PROCESSING','migration-69-lease-token',10000,1,NULL,NULL,NULL,1,1,NULL
    );
  `);
}

function applyMigration0069(target: SqliteDatabase): void {
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

async function columns(
  target: SqliteDatabase,
  table: string,
): Promise<string[]> {
  const result = await target.prepare(`PRAGMA table_info(${table})`).all<{
    name: string;
  }>();
  return result.results.map((row) => row.name);
}

async function objectSql(
  target: SqliteDatabase,
  names: readonly string[],
): Promise<Record<string, string>> {
  const placeholders = names.map(() => '?').join(',');
  const result = await target.prepare(`
    SELECT name,sql FROM sqlite_schema
    WHERE name IN (${placeholders}) ORDER BY name
  `).bind(...names).all<{ name: string; sql: string }>();
  return Object.fromEntries(result.results.map((row) => [row.name, row.sql]));
}

async function foreignKeys(
  target: SqliteDatabase,
  table: string,
): Promise<Array<{ table: string; from: string; to: string }>> {
  const result = await target.prepare(`PRAGMA foreign_key_list(${table})`)
    .all<{ table: string; from: string; to: string }>();
  return result.results.map((row) => ({
    table: row.table,
    from: row.from,
    to: row.to,
  }));
}

async function snapshot(target: SqliteDatabase): Promise<string> {
  const schema = await target.prepare(`
    SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name
  `).all();
  const tableNames = schema.results
    .filter((object) => object['type'] === 'table')
    .map((object) => String(object['name']));
  const tables = [];
  for (const name of tableNames) {
    const columns = (await target.prepare(
      `PRAGMA table_info(${quoteIdentifier(name)})`,
    ).all<{ name: string }>()).results.map((column) => String(column.name));
    const rows = (await target.prepare(
      `SELECT * FROM ${quoteIdentifier(name)}`,
    ).all<Record<string, unknown>>()).results.map((row) => columns.map(
      (column) => [column, serializeSnapshotValue(row[column])] as const,
    ));
    rows.sort((left, right) => JSON.stringify(left).localeCompare(
      JSON.stringify(right),
    ));
    tables.push({ name, columns, rows });
  }
  return JSON.stringify({ schema: schema.results, tables });
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function serializeSnapshotValue(value: unknown): readonly [string, string] {
  if (value === null) return ['null', ''];
  if (value instanceof Uint8Array) {
    return ['blob', Buffer.from(value).toString('hex')];
  }
  if (typeof value === 'number') {
    return ['number', Object.is(value, -0) ? '-0' : String(value)];
  }
  if (typeof value === 'bigint') return ['bigint', value.toString()];
  return [typeof value, String(value)];
}
