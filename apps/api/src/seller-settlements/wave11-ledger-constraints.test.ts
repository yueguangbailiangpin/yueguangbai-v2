import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDirectory = path.join(process.cwd(), 'migrations');
const migrationFiles = readdirSync(migrationDirectory)
  .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name))
  .sort();

function ledgerDatabase(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON;');
  for (const migration of migrationFiles) {
    database.exec('BEGIN IMMEDIATE;');
    try {
      database.exec(readFileSync(path.join(migrationDirectory, migration), 'utf8'));
      database.exec('COMMIT;');
    } catch (error) {
      try { database.exec('ROLLBACK;'); } catch { /* no active tx */ }
      throw error;
    }
  }
  // These tests isolate the Wave 11 allocation/reversal triggers. Parent rows
  // are intentionally synthetic, so older aggregate source guards and FKs are
  // disabled only in this test database.
  database.exec('PRAGMA foreign_keys = OFF;');
  database.exec('DROP TRIGGER trg_seller_payable_source_guard;');
  database.exec('DROP TRIGGER trg_seller_payment_insert_guard;');
  database.exec(`
    INSERT INTO staff_users (
      id, display_name, status, authorization_version,
      version, created_at, updated_at, disabled_at
    ) VALUES ('staff-1', '测试员工', 'ACTIVE', 1, 1, 0, 0, NULL)
  `);
  return database;
}

function insertPayment(
  database: DatabaseSync,
  id: string,
  organizationId: string,
  amount: number,
): void {
  database.prepare(`
    INSERT INTO seller_payments (
      id, seller_organization_id, amount_cny_fen, paid_at,
      recorded_at, recorded_by_staff_id, version, created_at, updated_at
    ) VALUES (?, ?, ?, 100, 100, 'staff-1', 1, 100, 100)
  `).run(id, organizationId, amount);
}

function insertPayable(
  database: DatabaseSync,
  id: string,
  organizationId: string,
  formalOrderId: string,
  amount: number,
  type: 'SELLER_PRINCIPAL' | 'SELLER_SERVICE_FEE' = 'SELLER_PRINCIPAL',
): void {
  database.prepare(`
    INSERT INTO seller_payables (
      id, seller_organization_id, formal_order_id, payable_type,
      amount_cny_fen, financial_snapshot_id, source_type, source_id,
      due_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 100, 100)
  `).run(
    id,
    organizationId,
    formalOrderId,
    type,
    amount,
    `snapshot-${id}`,
    type === 'SELLER_PRINCIPAL' ? 'FORMAL_ORDER' : 'REVIEW_APPROVAL',
    type === 'SELLER_PRINCIPAL' ? formalOrderId : `review-${id}`,
  );
}

function allocate(
  database: DatabaseSync,
  id: string,
  paymentId: string,
  payableId: string,
  organizationId: string,
  amount: number,
): void {
  database.prepare(`
    INSERT INTO seller_payment_allocations (
      id, payment_id, payable_id, seller_organization_id,
      amount_cny_fen, allocated_by_staff_id, allocated_at, created_at
    ) VALUES (?, ?, ?, ?, ?, 'staff-1', 200, 200)
  `).run(id, paymentId, payableId, organizationId, amount);
}

function reverseAllocation(
  database: DatabaseSync,
  id: string,
  allocationId: string,
  paymentId: string,
  payableId: string,
  organizationId: string,
  amount: number,
): void {
  database.prepare(`
    INSERT INTO seller_payment_allocation_reversals (
      id, allocation_id, payment_id, payable_id, seller_organization_id,
      amount_cny_fen, reason, reversed_by_staff_id, reversed_at,
      idempotency_key, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'correction', 'staff-1', 300, ?, 300)
  `).run(
    id,
    allocationId,
    paymentId,
    payableId,
    organizationId,
    amount,
    `reverse-${id}`,
  );
}

function value(
  database: DatabaseSync,
  sql: string,
  ...bindings: SQLInputValue[]
): Record<string, unknown> {
  return database.prepare(sql).get(...bindings) as Record<string, unknown>;
}

describe('Wave 11 seller ledger database constraints', () => {
  it('supports one payment across multiple payables and partial payment', () => {
    const database = ledgerDatabase();
    insertPayment(database, 'payment-1', 'seller-1', 100);
    insertPayable(database, 'principal-1', 'seller-1', 'order-1', 80);
    insertPayable(
      database,
      'service-1',
      'seller-1',
      'order-2',
      50,
      'SELLER_SERVICE_FEE',
    );
    allocate(database, 'allocation-1', 'payment-1', 'principal-1', 'seller-1', 60);
    allocate(database, 'allocation-2', 'payment-1', 'service-1', 'seller-1', 40);

    expect(value(database, `
      SELECT allocated_amount_cny_fen, unallocated_amount_cny_fen, derived_status
      FROM seller_payment_balances WHERE payment_id='payment-1'
    `)).toMatchObject({
      allocated_amount_cny_fen: 100,
      unallocated_amount_cny_fen: 0,
      derived_status: 'FULLY_ALLOCATED',
    });
    expect(value(database, `
      SELECT paid_amount_cny_fen, outstanding_amount_cny_fen, derived_status
      FROM seller_payable_balances WHERE payable_id='principal-1'
    `)).toMatchObject({
      paid_amount_cny_fen: 60,
      outstanding_amount_cny_fen: 20,
      derived_status: 'PARTIALLY_PAID',
    });
    database.close();
  });

  it('supports multiple payments against one payable', () => {
    const database = ledgerDatabase();
    insertPayment(database, 'payment-1', 'seller-1', 30);
    insertPayment(database, 'payment-2', 'seller-1', 70);
    insertPayable(database, 'principal-1', 'seller-1', 'order-1', 100);
    allocate(database, 'allocation-1', 'payment-1', 'principal-1', 'seller-1', 30);
    allocate(database, 'allocation-2', 'payment-2', 'principal-1', 'seller-1', 70);
    expect(value(database, `
      SELECT paid_amount_cny_fen, outstanding_amount_cny_fen, derived_status
      FROM seller_payable_balances WHERE payable_id='principal-1'
    `)).toMatchObject({
      paid_amount_cny_fen: 100,
      outstanding_amount_cny_fen: 0,
      derived_status: 'PAID',
    });
    database.close();
  });

  it('rejects cross-organization and over-allocation facts', () => {
    const database = ledgerDatabase();
    insertPayment(database, 'payment-1', 'seller-1', 100);
    insertPayable(database, 'payable-1', 'seller-1', 'order-1', 80);
    insertPayable(database, 'payable-2', 'seller-2', 'order-2', 80);
    expect(() => allocate(
      database,
      'allocation-cross',
      'payment-1',
      'payable-2',
      'seller-1',
      10,
    )).toThrow(/seller_allocation_exceeds_available_balance/u);
    expect(() => allocate(
      database,
      'allocation-over-payable',
      'payment-1',
      'payable-1',
      'seller-1',
      81,
    )).toThrow(/seller_allocation_exceeds_available_balance/u);
    allocate(database, 'allocation-1', 'payment-1', 'payable-1', 'seller-1', 80);
    insertPayable(database, 'payable-3', 'seller-1', 'order-3', 30);
    expect(() => allocate(
      database,
      'allocation-over-payment',
      'payment-1',
      'payable-3',
      'seller-1',
      21,
    )).toThrow(/seller_allocation_exceeds_available_balance/u);
    database.close();
  });

  it('restores available and outstanding balances after partial reversal', () => {
    const database = ledgerDatabase();
    insertPayment(database, 'payment-1', 'seller-1', 100);
    insertPayable(database, 'payable-1', 'seller-1', 'order-1', 100);
    allocate(database, 'allocation-1', 'payment-1', 'payable-1', 'seller-1', 70);
    reverseAllocation(
      database,
      'reversal-1',
      'allocation-1',
      'payment-1',
      'payable-1',
      'seller-1',
      20,
    );
    expect(value(database, `
      SELECT allocated_amount_cny_fen, unallocated_amount_cny_fen
      FROM seller_payment_balances WHERE payment_id='payment-1'
    `)).toMatchObject({
      allocated_amount_cny_fen: 50,
      unallocated_amount_cny_fen: 50,
    });
    expect(value(database, `
      SELECT paid_amount_cny_fen, outstanding_amount_cny_fen
      FROM seller_payable_balances WHERE payable_id='payable-1'
    `)).toMatchObject({
      paid_amount_cny_fen: 50,
      outstanding_amount_cny_fen: 50,
    });
    expect(() => reverseAllocation(
      database,
      'reversal-over',
      'allocation-1',
      'payment-1',
      'payable-1',
      'seller-1',
      51,
    )).toThrow(/seller_allocation_reversal_exceeds_allocation/u);
    database.close();
  });

  it('requires active allocations to be reversed before payment reversal', () => {
    const database = ledgerDatabase();
    insertPayment(database, 'payment-1', 'seller-1', 100);
    insertPayable(database, 'payable-1', 'seller-1', 'order-1', 100);
    allocate(database, 'allocation-1', 'payment-1', 'payable-1', 'seller-1', 60);
    const insertPaymentReversal = () => database.prepare(`
      INSERT INTO seller_payment_reversals (
        id, payment_id, seller_organization_id, amount_cny_fen,
        reason, reversed_by_staff_id, reversed_at,
        idempotency_key, created_at
      ) VALUES (
        'payment-reversal-1', 'payment-1', 'seller-1', 100,
        'duplicate payment', 'staff-1', 400,
        'reverse-payment-1', 400
      )
    `).run();
    expect(insertPaymentReversal)
      .toThrow(/seller_payment_reversal_has_active_allocations/u);
    reverseAllocation(
      database,
      'allocation-reversal-1',
      'allocation-1',
      'payment-1',
      'payable-1',
      'seller-1',
      60,
    );
    insertPaymentReversal();
    expect(value(database, `
      SELECT effective_amount_cny_fen, allocated_amount_cny_fen,
             unallocated_amount_cny_fen, derived_status
      FROM seller_payment_balances WHERE payment_id='payment-1'
    `)).toMatchObject({
      effective_amount_cny_fen: 0,
      allocated_amount_cny_fen: 0,
      unallocated_amount_cny_fen: 0,
      derived_status: 'REVERSED',
    });
    database.close();
  });

  it('allows only paid_at, version and updated_at to change', () => {
    const database = ledgerDatabase();
    insertPayment(database, 'payment-1', 'seller-1', 100);
    expect(() => database.exec(`
      UPDATE seller_payments SET amount_cny_fen=101 WHERE id='payment-1'
    `)).toThrow(/seller_payment_invalid_update/u);
    expect(() => database.exec(`
      UPDATE seller_payments SET recorded_at=101 WHERE id='payment-1'
    `)).toThrow(/seller_payment_invalid_update/u);
    database.exec(`
      UPDATE seller_payments
      SET paid_at=90, version=2, updated_at=101
      WHERE id='payment-1'
    `);
    expect(value(database, `
      SELECT amount_cny_fen, paid_at, recorded_at, version
      FROM seller_payments WHERE id='payment-1'
    `)).toMatchObject({
      amount_cny_fen: 100,
      paid_at: 90,
      recorded_at: 100,
      version: 2,
    });
    expect(() => database.exec(`
      DELETE FROM seller_payments WHERE id='payment-1'
    `)).toThrow(/seller_payments_are_immutable/u);
    database.close();
  });
});
