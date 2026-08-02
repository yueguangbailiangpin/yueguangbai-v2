import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = path.join(
  process.cwd(),
  'migrations/0023_seller_payables.sql',
);
const migrationSql = readFileSync(migrationPath, 'utf8');

function database(): DatabaseSync {
  const value = new DatabaseSync(':memory:');
  value.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE transaction_assertions (assertion_value INTEGER NOT NULL);
    CREATE TABLE app_schema_state (
      singleton_id INTEGER PRIMARY KEY,
      schema_version INTEGER NOT NULL,
      installed_at INTEGER NOT NULL
    );
    INSERT INTO app_schema_state VALUES (1, 22, 0);
    CREATE TABLE seller_organizations (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'ACTIVE'
    );
    CREATE TABLE formal_orders (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 200),
      seller_organization_id TEXT NOT NULL REFERENCES seller_organizations(id),
      status TEXT NOT NULL,
      confirmed_at INTEGER NOT NULL
    );
    CREATE TABLE formal_order_financial_snapshots (
      id TEXT PRIMARY KEY,
      formal_order_id TEXT NOT NULL REFERENCES formal_orders(id),
      seller_expected_principal_cny_fen INTEGER NOT NULL,
      service_fee_cny_fen INTEGER NOT NULL
    );
    CREATE TABLE review_cases (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 200),
      formal_order_id TEXT NOT NULL REFERENCES formal_orders(id),
      seller_organization_id TEXT NOT NULL REFERENCES seller_organizations(id),
      status TEXT NOT NULL
    );
    CREATE TABLE review_events (
      id TEXT PRIMARY KEY,
      review_case_id TEXT NOT NULL REFERENCES review_cases(id),
      formal_order_id TEXT NOT NULL REFERENCES formal_orders(id),
      event_type TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  return value;
}

function replayableReconciliationSql(): string {
  const start = migrationSql.indexOf('-- Record historical conflicts');
  const end = migrationSql.indexOf('CREATE VIEW seller_payable_balances');
  if (start < 0 || end <= start) throw new Error('0023 replay section missing');
  return migrationSql.slice(start, end);
}

describe('seller payable opaque identifiers', () => {
  it('migrates 200-character source ids without length failures', () => {
    const value = database();
    const formalOrderId = 'F'.repeat(200);
    const reviewCaseId = 'R'.repeat(200);
    const conflictFormalOrderId = 'C'.repeat(200);
    value.prepare(`
      INSERT INTO seller_organizations (id) VALUES ('seller-1')
    `).run();
    value.prepare(`
      INSERT INTO formal_orders (
        id, seller_organization_id, status, confirmed_at
      ) VALUES (?, 'seller-1', 'CONFIRMED', 100)
    `).run(formalOrderId);
    value.prepare(`
      INSERT INTO formal_orders (
        id, seller_organization_id, status, confirmed_at
      ) VALUES (?, 'seller-1', 'CONFIRMED', 110)
    `).run(conflictFormalOrderId);
    value.prepare(`
      INSERT INTO formal_order_financial_snapshots (
        id, formal_order_id,
        seller_expected_principal_cny_fen, service_fee_cny_fen
      ) VALUES ('snapshot-1', ?, 12345, 678)
    `).run(formalOrderId);
    value.prepare(`
      INSERT INTO review_cases (
        id, formal_order_id, seller_organization_id, status
      ) VALUES (?, ?, 'seller-1', 'APPROVED')
    `).run(reviewCaseId, formalOrderId);
    value.prepare(`
      INSERT INTO review_events (
        id, review_case_id, formal_order_id, event_type, created_at
      ) VALUES ('approval-1', ?, ?, 'REVIEW_APPROVED', 200)
    `).run(reviewCaseId, formalOrderId);

    value.exec(migrationSql);

    expect(value.prepare(`
      SELECT schema_version FROM app_schema_state WHERE singleton_id=1
    `).get()?.schema_version).toBe(23);
    const payables = value.prepare(`
      SELECT id, formal_order_id, source_id, payable_type
      FROM seller_payables
      ORDER BY payable_type
    `).all() as Array<{
      id: string;
      formal_order_id: string;
      source_id: string;
      payable_type: string;
    }>;
    expect(payables).toHaveLength(2);
    expect(payables.every((row) => /^[0-9a-f]{32}$/u.test(row.id))).toBe(true);
    expect(payables.find((row) => row.payable_type === 'SELLER_PRINCIPAL'))
      .toMatchObject({
        formal_order_id: formalOrderId,
        source_id: formalOrderId,
      });
    expect(payables.find((row) => row.payable_type === 'SELLER_SERVICE_FEE'))
      .toMatchObject({
        formal_order_id: formalOrderId,
        source_id: reviewCaseId,
      });

    const events = value.prepare(`
      SELECT id, payable_id FROM seller_payable_events
    `).all() as Array<{ id: string; payable_id: string }>;
    expect(events).toHaveLength(2);
    expect(events.every((row) => /^[0-9a-f]{32}$/u.test(row.id))).toBe(true);
    expect(events.every((row) => row.payable_id.length === 32)).toBe(true);

    const conflicts = value.prepare(`
      SELECT id, entity_id, reason_code
      FROM seller_payable_reconciliation_conflicts
    `).all() as Array<{
      id: string;
      entity_id: string;
      reason_code: string;
    }>;
    expect(conflicts).toEqual([expect.objectContaining({
      entity_id: conflictFormalOrderId,
      reason_code: 'FINANCIAL_SNAPSHOT_MISSING',
    })]);
    expect(conflicts[0]?.id).toMatch(/^[0-9a-f]{32}$/u);

    value.exec(replayableReconciliationSql());
    expect(value.prepare('SELECT COUNT(*) AS count FROM seller_payables')
      .get()?.count).toBe(2);
    expect(value.prepare('SELECT COUNT(*) AS count FROM seller_payable_events')
      .get()?.count).toBe(2);
    expect(value.prepare(`
      SELECT COUNT(*) AS count FROM seller_payable_reconciliation_conflicts
    `).get()?.count).toBe(1);
    expect(value.prepare('PRAGMA integrity_check').get()?.integrity_check)
      .toBe('ok');
    expect(value.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    value.close();
  });

  it('supports a maximum-length existing payable id without deriving event id from it', () => {
    const value = database();
    value.exec(migrationSql);
    const formalOrderId = 'O'.repeat(200);
    const payableId = 'P'.repeat(200);
    value.prepare(`
      INSERT INTO seller_organizations (id) VALUES ('seller-2')
    `).run();
    value.prepare(`
      INSERT INTO formal_orders (
        id, seller_organization_id, status, confirmed_at
      ) VALUES (?, 'seller-2', 'CONFIRMED', 300)
    `).run(formalOrderId);
    value.prepare(`
      INSERT INTO formal_order_financial_snapshots (
        id, formal_order_id,
        seller_expected_principal_cny_fen, service_fee_cny_fen
      ) VALUES ('snapshot-2', ?, 500, 0)
    `).run(formalOrderId);
    value.prepare(`
      INSERT INTO seller_payables (
        id, seller_organization_id, formal_order_id, payable_type,
        amount_cny_fen, financial_snapshot_id, source_type, source_id,
        due_at, created_at
      ) VALUES (?, 'seller-2', ?, 'SELLER_PRINCIPAL',
        500, 'snapshot-2', 'FORMAL_ORDER', ?, 300, 300)
    `).run(payableId, formalOrderId, formalOrderId);
    value.prepare(`
      INSERT INTO seller_payable_events (
        id, payable_id, event_type, actor_type, actor_id,
        amount_cny_fen, metadata_json, idempotency_key, created_at
      ) VALUES (
        lower(hex(randomblob(16))), ?, 'PAYABLE_RECONCILED',
        'SYSTEM', 'test-system', 500, '{}', 'test:opaque:event', 301
      )
    `).run(payableId);
    const event = value.prepare(`
      SELECT id, payable_id FROM seller_payable_events WHERE payable_id=?
    `).get(payableId) as { id: string; payable_id: string };
    expect(event.payable_id).toBe(payableId);
    expect(event.id).toMatch(/^[0-9a-f]{32}$/u);
    value.close();
  });
});