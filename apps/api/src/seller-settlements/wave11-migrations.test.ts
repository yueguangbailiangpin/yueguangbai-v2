import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migrationDirectory = path.join(root, 'migrations');
const migrations = readdirSync(migrationDirectory)
  .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name))
  .sort();

function database(): DatabaseSync {
  const value = new DatabaseSync(':memory:');
  value.exec('PRAGMA foreign_keys = ON;');
  return value;
}

function runMigration(value: DatabaseSync, name: string): void {
  value.exec('BEGIN IMMEDIATE;');
  try {
    value.exec(readFileSync(path.join(migrationDirectory, name), 'utf8'));
    value.exec('COMMIT;');
  } catch (error) {
    try { value.exec('ROLLBACK;'); } catch { /* no active transaction */ }
    value.exec('PRAGMA foreign_keys = ON;');
    throw error;
  }
}

function applyThrough(value: DatabaseSync, count: number): void {
  for (const migration of migrations.slice(0, count)) {
    runMigration(value, migration);
  }
}

function schemaVersion(value: DatabaseSync): number {
  return Number(value.prepare(`
    SELECT schema_version
    FROM app_schema_state
    WHERE singleton_id=1
  `).get()?.schema_version);
}

function hasObject(
  value: DatabaseSync,
  type: 'table' | 'trigger' | 'view',
  name: string,
): boolean {
  return Number(value.prepare(`
    SELECT COUNT(*) AS count
    FROM sqlite_schema
    WHERE type=? AND name=?
  `).get(type, name)?.count) === 1;
}

describe('Wave 11 migration chain', () => {
  it('applies 0001 through 0024 and preserves older foundations', () => {
    const value = database();
    applyThrough(value, migrations.length);

    expect(migrations).toHaveLength(24);
    expect(migrations.at(-3)).toBe('0022_review_submission_metadata.sql');
    expect(migrations.at(-2)).toBe('0023_seller_payables.sql');
    expect(migrations.at(-1)).toBe('0024_seller_payments_allocations.sql');
    expect(schemaVersion(value)).toBe(24);

    for (const table of [
      'buyer_refund_obligations',
      'staff_permission_denials',
      'staff_resource_assignments',
      'file_entity_audience_grants',
      'formal_order_financial_snapshots',
      'order_instructions',
      'seller_payables',
      'seller_payments',
      'seller_payment_allocations',
      'seller_payment_allocation_reversals',
      'seller_payment_reversals',
    ]) {
      expect(hasObject(value, 'table', table), table).toBe(true);
    }
    for (const view of [
      'seller_allocation_net_amounts',
      'seller_payment_balances',
      'seller_payable_balances',
      'seller_organization_settlement_balances',
    ]) {
      expect(hasObject(value, 'view', view), view).toBe(true);
    }
    expect(value.prepare('PRAGMA integrity_check').get()?.integrity_check)
      .toBe('ok');
    expect(value.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    value.close();
  });

  it.each([
    [22, 20, 'idx_review_evidence_versions_current_url'],
    [23, 21, 'seller_payables'],
    [24, 22, 'seller_payments'],
  ] as const)(
    'rejects migration %i on schema %i without partial objects',
    (migrationNumber, prefixCount, sentinel) => {
      const value = database();
      applyThrough(value, prefixCount);
      const migration = migrations[migrationNumber - 1];
      expect(() => runMigration(value, migration))
        .toThrow(/transaction_assertion_failed/u);
      expect(schemaVersion(value)).toBe(prefixCount);
      const object = value.prepare(`
        SELECT COUNT(*) AS count
        FROM sqlite_schema
        WHERE name=?
      `).get(sentinel);
      expect(Number(object?.count)).toBe(0);
      expect(value.prepare('PRAGMA integrity_check').get()?.integrity_check)
        .toBe('ok');
      value.close();
    },
  );

  it('uses only INTEGER financial facts in the seller ledger', () => {
    const value = database();
    applyThrough(value, migrations.length);
    for (const table of [
      'seller_payables',
      'seller_payments',
      'seller_payment_allocations',
      'seller_payment_allocation_reversals',
      'seller_payment_reversals',
    ]) {
      const columns = value.prepare(`PRAGMA table_info('${table}')`).all() as {
        name: string;
        type: string;
      }[];
      expect(columns.some((column) => /^(?:REAL|FLOAT)$/iu.test(column.type)))
        .toBe(false);
      for (const column of columns.filter((candidate) =>
        candidate.name.endsWith('_cny_fen'))) {
        expect(column.type).toBe('INTEGER');
      }
    }
    value.close();
  });

  it('keeps immutable and source guards installed', () => {
    const value = database();
    applyThrough(value, migrations.length);
    for (const trigger of [
      'trg_review_evidence_version_url_guard',
      'trg_review_evidence_versions_no_update',
      'trg_seller_payable_source_guard',
      'trg_seller_payables_no_update',
      'trg_seller_payments_no_delete',
      'trg_seller_payment_update_guard',
      'trg_seller_payment_proof_guard',
      'trg_seller_allocation_guard',
      'trg_seller_allocation_reversal_guard',
      'trg_seller_payment_reversal_guard',
    ]) {
      expect(hasObject(value, 'trigger', trigger), trigger).toBe(true);
    }
    value.close();
  });

  it('enforces one unique proof per Payment and forbids file reuse', () => {
    const value = database();
    applyThrough(value, migrations.length);
    const schema = value.prepare(`
      SELECT sql
      FROM sqlite_schema
      WHERE type='table' AND name='seller_payment_proofs'
    `).get() as { sql: string };
    expect(schema.sql).toContain(
      'payment_id TEXT NOT NULL UNIQUE REFERENCES seller_payments(id)',
    );
    expect(schema.sql).toContain(
      'file_object_id TEXT NOT NULL UNIQUE REFERENCES file_objects(id)',
    );
    expect(schema.sql).toContain(
      'file_entity_link_id TEXT NOT NULL UNIQUE REFERENCES file_entity_links(id)',
    );
    expect(hasObject(value, 'trigger', 'trg_seller_payment_proof_guard'))
      .toBe(true);
    value.close();
  });
});