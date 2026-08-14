import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { InternalFinanceFilters } from '@ygb/contracts';
import { SqliteDatabase } from '@ygb/testkit';
import { readFinanceCashFlow } from './internal-finance/read-model';

const migrationPath = path.resolve(
  process.cwd(),
  'migrations/0066_advance_cash_integrity.sql',
);

let database: SqliteDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe('Migration 0066 advance cash integrity', () => {
  it('guards cumulative reversals and reports each real cash movement once', async () => {
    database = schema65Database();
    applyMigration0066(database);

    expect(await database.prepare(`
      SELECT schema_version FROM app_schema_state WHERE singleton_id=1
    `).first()).toEqual({ schema_version: 66 });

    database.exec(`
      INSERT INTO formal_orders(id,seller_organization_id)
      VALUES('formal-order-0066','seller-org-0066');
      INSERT INTO buyer_advance_principal_entries(
        id,formal_order_id,buyer_customer_id,entry_type,
        original_payment_entry_id,amount_cny_fen,paid_at,reversed_at,
        china_business_date,payment_channel,note,actor_staff_id,created_at
      ) VALUES(
        'advance-payment-0066','formal-order-0066','buyer-0066','PAYMENT',
        NULL,100,1000,NULL,'1970-01-01','WECHAT',NULL,'staff-0066',1000
      );
      INSERT INTO buyer_advance_principal_entries(
        id,formal_order_id,buyer_customer_id,entry_type,
        original_payment_entry_id,amount_cny_fen,paid_at,reversed_at,
        china_business_date,payment_channel,note,actor_staff_id,created_at
      ) VALUES(
        'advance-reversal-0066-a','formal-order-0066','buyer-0066','REVERSAL',
        'advance-payment-0066',40,NULL,2000,'1970-01-01','WECHAT',NULL,
        'staff-0066',2000
      );
    `);

    await expect(database.prepare(`
      INSERT INTO buyer_advance_principal_entries(
        id,formal_order_id,buyer_customer_id,entry_type,
        original_payment_entry_id,amount_cny_fen,paid_at,reversed_at,
        china_business_date,payment_channel,note,actor_staff_id,created_at
      ) VALUES(
        'advance-reversal-0066-b','formal-order-0066','buyer-0066','REVERSAL',
        'advance-payment-0066',61,NULL,3000,'1970-01-01','WECHAT',NULL,
        'staff-0066',3000
      )
    `).run()).rejects.toThrow('advance_principal_reversal_exceeds_payment');

    database.exec(`
      INSERT INTO seller_payments(
        id,seller_organization_id,amount_cny_fen,paid_at
      ) VALUES('seller-payment-0066','seller-org-0066',200,4000);
      INSERT INTO buyer_refund_obligations(id,formal_order_id)
      VALUES('refund-obligation-0066','formal-order-0066');
      INSERT INTO buyer_refund_payment_entries(
        id,obligation_id,entry_type,original_payment_entry_id,
        amount_cny_fen,paid_at,reversed_at,china_business_date
      ) VALUES
        ('manual-refund-0066','refund-obligation-0066','PAYMENT',NULL,
          30,5000,NULL,'1970-01-01'),
        ('advance-refund-0066','refund-obligation-0066','PAYMENT',NULL,
          60,1000,NULL,'1970-01-01'),
        ('advance-refund-reversal-0066','refund-obligation-0066','REVERSAL',
          'advance-refund-0066',10,NULL,6000,'1970-01-01');
      INSERT INTO buyer_advance_principal_settlements(
        id,advance_payment_entry_id,buyer_refund_obligation_id,
        buyer_refund_payment_entry_id,settled_amount_cny_fen,settled_at
      ) VALUES(
        'advance-settlement-0066','advance-payment-0066',
        'refund-obligation-0066','advance-refund-0066',60,7000
      );
    `);

    const movements = await database.prepare(`
      SELECT movement_type,movement_id
      FROM internal_finance_cash_movements
      ORDER BY movement_type,movement_id
    `).all<{ movement_type: string; movement_id: string }>();
    expect(movements.results).toEqual([
      {
        movement_type: 'BUYER_ADVANCE_PAYMENT',
        movement_id: 'advance-payment-0066',
      },
      {
        movement_type: 'BUYER_ADVANCE_REVERSAL',
        movement_id: 'advance-reversal-0066-a',
      },
      {
        movement_type: 'BUYER_REFUND_PAYMENT',
        movement_id: 'manual-refund-0066',
      },
      {
        movement_type: 'SELLER_PAYMENT',
        movement_id: 'seller-payment-0066',
      },
    ]);

    expect(await readFinanceCashFlow(database, cashFilters(), 8000))
      .toEqual({
        seller_cash_inflow_cny_fen: '200',
        seller_payment_reversal_cny_fen: '0',
        buyer_refund_outflow_cny_fen: '30',
        buyer_refund_reversal_cny_fen: '0',
        buyer_advance_outflow_cny_fen: '100',
        buyer_advance_reversal_cny_fen: '40',
        net_cash_flow_cny_fen: '110',
        from_date: '1970-01-01',
        to_date: '1970-01-01',
        data_as_of: 8000,
      });
  });

  it('refuses to bless a pre-existing over-reversed advance ledger', () => {
    database = schema65Database();
    database.exec(`
      INSERT INTO formal_orders(id,seller_organization_id)
      VALUES('formal-order-corrupt','seller-org-corrupt');
      INSERT INTO buyer_advance_principal_entries(
        id,formal_order_id,buyer_customer_id,entry_type,
        original_payment_entry_id,amount_cny_fen,paid_at,reversed_at,
        china_business_date,payment_channel,note,actor_staff_id,created_at
      ) VALUES
        ('advance-payment-corrupt','formal-order-corrupt','buyer-corrupt',
          'PAYMENT',NULL,100,1000,NULL,'1970-01-01','WECHAT',NULL,
          'staff-corrupt',1000),
        ('advance-reversal-corrupt-a','formal-order-corrupt','buyer-corrupt',
          'REVERSAL','advance-payment-corrupt',60,NULL,2000,'1970-01-01',
          'WECHAT',NULL,'staff-corrupt',2000),
        ('advance-reversal-corrupt-b','formal-order-corrupt','buyer-corrupt',
          'REVERSAL','advance-payment-corrupt',50,NULL,3000,'1970-01-01',
          'WECHAT',NULL,'staff-corrupt',3000);
    `);

    expect(() => applyMigration0066(database!)).toThrow();
    expect(database.raw.prepare(`
      SELECT schema_version FROM app_schema_state WHERE singleton_id=1
    `).get()).toEqual({ schema_version: 65 });
  });
});

function schema65Database(): SqliteDatabase {
  const value = new SqliteDatabase();
  value.exec(`
    CREATE TABLE app_schema_state(
      singleton_id INTEGER PRIMARY KEY,
      schema_version INTEGER NOT NULL,
      installed_at INTEGER NOT NULL
    );
    INSERT INTO app_schema_state VALUES(1,65,0);
    CREATE TABLE transaction_assertions(
      assertion_value INTEGER NOT NULL CHECK(assertion_value=1)
    );
    CREATE TABLE seller_payments(
      id TEXT PRIMARY KEY,seller_organization_id TEXT,
      amount_cny_fen INTEGER,paid_at INTEGER
    );
    CREATE TABLE seller_payment_reversals(
      id TEXT PRIMARY KEY,seller_organization_id TEXT,
      amount_cny_fen INTEGER,reversed_at INTEGER
    );
    CREATE TABLE formal_orders(
      id TEXT PRIMARY KEY,seller_organization_id TEXT NOT NULL
    );
    CREATE TABLE buyer_refund_obligations(
      id TEXT PRIMARY KEY,formal_order_id TEXT NOT NULL
    );
    CREATE TABLE buyer_refund_payment_entries(
      id TEXT PRIMARY KEY,obligation_id TEXT NOT NULL,entry_type TEXT NOT NULL,
      original_payment_entry_id TEXT,amount_cny_fen INTEGER NOT NULL,
      paid_at INTEGER,reversed_at INTEGER,china_business_date TEXT NOT NULL
    );
    CREATE TABLE buyer_advance_principal_entries(
      id TEXT PRIMARY KEY,formal_order_id TEXT NOT NULL,
      buyer_customer_id TEXT NOT NULL,entry_type TEXT NOT NULL,
      original_payment_entry_id TEXT,amount_cny_fen INTEGER NOT NULL,
      paid_at INTEGER,reversed_at INTEGER,china_business_date TEXT NOT NULL,
      payment_channel TEXT NOT NULL,note TEXT,actor_staff_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE buyer_advance_principal_settlements(
      id TEXT PRIMARY KEY,advance_payment_entry_id TEXT NOT NULL UNIQUE,
      buyer_refund_obligation_id TEXT NOT NULL,
      buyer_refund_payment_entry_id TEXT NOT NULL UNIQUE,
      settled_amount_cny_fen INTEGER NOT NULL,settled_at INTEGER NOT NULL
    );
    CREATE VIEW internal_finance_cash_movements AS
    SELECT payment.id AS movement_id,'SELLER_PAYMENT' AS movement_type,
      payment.seller_organization_id,NULL AS formal_order_id,
      payment.paid_at AS occurred_at,'1970-01-01' AS cash_business_date,
      payment.amount_cny_fen
    FROM seller_payments payment;
  `);
  return value;
}

function applyMigration0066(target: SqliteDatabase): void {
  target.exec('BEGIN IMMEDIATE;');
  try {
    target.exec(readFileSync(migrationPath, 'utf8'));
    target.exec('COMMIT;');
  } catch (error) {
    target.exec('ROLLBACK;');
    throw error;
  }
}

function cashFilters(): InternalFinanceFilters {
  return {
    from_date: '1970-01-01',
    to_date: '1970-01-01',
    date_basis: 'CASH',
    seller_organization_id: null,
    store_id: null,
    product_id: null,
    asin: null,
    formal_order_id: null,
    amazon_order_number: null,
    review_type: null,
    finance_status: null,
  };
}
