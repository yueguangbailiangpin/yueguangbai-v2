import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteDatabase } from '@ygb/testkit';

const migrationPath = path.resolve(process.cwd(), 'migrations/0067_advance_v1_full_payment.sql');
let database: SqliteDatabase | null = null;
afterEach(() => {
  database?.close();
  database = null;
});

describe('Migration 0067 Advance V1 full payment', () => {
  it('enforces one full payment, one full reversal and replacement after reversal', async () => {
    database = schema66Database();
    applyMigration0067(database);
    expect(await schemaVersion(database)).toBe(67);

    await expect(insertPayment(database, 'payment-wrong', 99)).rejects.toThrow(
      'advance_principal_payment_must_equal_snapshot',
    );
    await expect(insertPayment(database, 'payment-a', 100)).resolves.toMatchObject({
      meta: { changes: 1 },
    });
    await expect(insertPayment(database, 'payment-b', 100)).rejects.toThrow(
      'advance_principal_outstanding_payment_exists',
    );
    await expect(insertReversal(database, 'reversal-partial', 'payment-a', 40)).rejects.toThrow(
      'advance_principal_reversal_must_be_one_full_entry',
    );
    await expect(
      insertReversal(database, 'reversal-full', 'payment-a', 100),
    ).resolves.toMatchObject({ meta: { changes: 1 } });
    await expect(insertReversal(database, 'reversal-repeat', 'payment-a', 100)).rejects.toThrow(
      'advance_principal_reversal_must_be_one_full_entry',
    );
    await expect(insertPayment(database, 'payment-replacement', 100)).resolves.toMatchObject({
      meta: { changes: 1 },
    });
  });

  it('fails closed at schema 66 when immutable history contains a partial reversal', () => {
    database = schema66Database();
    database.exec(`
      INSERT INTO buyer_advance_principal_entries VALUES(
        'payment-dirty','order-1','buyer-1','PAYMENT',NULL,100,1000,NULL,
        '1970-01-01','WECHAT',NULL,'staff-1',1000
      );
      INSERT INTO buyer_advance_principal_entries VALUES(
        'reversal-dirty','order-1','buyer-1','REVERSAL','payment-dirty',40,
        NULL,2000,'1970-01-01','WECHAT',NULL,'staff-1',2000
      );
    `);
    expect(() => applyMigration0067(database!)).toThrow();
    expect(
      database.raw
        .prepare(`SELECT schema_version FROM app_schema_state WHERE singleton_id=1`)
        .get(),
    ).toEqual({ schema_version: 66 });
  });

  it('installs the full-payment guards after the real 0001-0066 chain', async () => {
    database = fullSchema66Database();
    database.exec(`
      PRAGMA foreign_keys=OFF;
      DROP TRIGGER trg_formal_order_financial_snapshot_guard;
      DROP TRIGGER trg_formal_order_financial_self_pay_guard;
      INSERT INTO formal_order_financial_snapshots(
        id,formal_order_id,snapshot_version,buyer_rate_version_id,
        buyer_rate_version_no,buyer_rate_business_date,buyer_rate_confirmed_at,
        buyer_cny_per_jpy_e8,seller_rate_version_id,seller_rate_version_no,
        seller_rate_effective_from,seller_rate_confirmed_at,seller_cny_per_jpy_e8,
        service_fee_version_id,service_fee_version_no,service_fee_effective_from,
        service_fee_confirmed_at,service_fee_cny_fen,
        buyer_expected_principal_cny_fen,seller_expected_principal_cny_fen,
        rounding_rule,created_at
      ) VALUES(
        'snapshot-full-chain','order-full-chain',1,'buyer-rate-full-chain',1,
        '1970-01-01',1,100000000,'seller-rate-full-chain',1,1,1,100000000,
        'fee-full-chain',1,1,1,0,100,100,'HALF_UP',1
      );
      INSERT INTO buyer_advance_principal_entries(
        id,formal_order_id,buyer_customer_id,entry_type,
        original_payment_entry_id,amount_cny_fen,paid_at,reversed_at,
        china_business_date,payment_channel,note,actor_staff_id,created_at
      ) VALUES(
        'payment-full-chain','order-full-chain','buyer-full-chain','PAYMENT',
        NULL,100,1000,NULL,'1970-01-01','WECHAT',NULL,'staff-full-chain',1000
      );
    `);
    applyMigration0067(database);
    expect(await schemaVersion(database)).toBe(67);
    await expect(
      insertReversal(
        database,
        'reversal-full-chain',
        'payment-full-chain',
        100,
        'order-full-chain',
        'buyer-full-chain',
      ),
    ).resolves.toMatchObject({ meta: { changes: 1 } });
    await expect(
      insertReversal(
        database,
        'reversal-full-chain-repeat',
        'payment-full-chain',
        100,
        'order-full-chain',
        'buyer-full-chain',
      ),
    ).rejects.toThrow('advance_principal_reversal_must_be_one_full_entry');
  });
});

function schema66Database(): SqliteDatabase {
  const value = new SqliteDatabase();
  value.exec(`
    CREATE TABLE app_schema_state(singleton_id INTEGER PRIMARY KEY,schema_version INTEGER NOT NULL,installed_at INTEGER NOT NULL);
    INSERT INTO app_schema_state VALUES(1,66,0);
    CREATE TABLE transaction_assertions(assertion_value INTEGER NOT NULL CHECK(assertion_value=1));
    CREATE TABLE formal_order_financial_snapshots(formal_order_id TEXT PRIMARY KEY,buyer_expected_principal_cny_fen INTEGER NOT NULL);
    INSERT INTO formal_order_financial_snapshots VALUES('order-1',100);
    CREATE TABLE buyer_advance_principal_entries(
      id TEXT PRIMARY KEY,formal_order_id TEXT NOT NULL,buyer_customer_id TEXT NOT NULL,
      entry_type TEXT NOT NULL,original_payment_entry_id TEXT,
      amount_cny_fen INTEGER NOT NULL,paid_at INTEGER,reversed_at INTEGER,
      china_business_date TEXT NOT NULL,payment_channel TEXT NOT NULL,note TEXT,
      actor_staff_id TEXT NOT NULL,created_at INTEGER NOT NULL
    );
    CREATE TRIGGER trg_advance_principal_reversal_source_guard
    BEFORE INSERT ON buyer_advance_principal_entries
    WHEN NEW.entry_type='REVERSAL' AND NOT EXISTS(
      SELECT 1 FROM buyer_advance_principal_entries payment
      WHERE payment.id=NEW.original_payment_entry_id AND payment.entry_type='PAYMENT'
        AND payment.formal_order_id=NEW.formal_order_id
        AND payment.buyer_customer_id=NEW.buyer_customer_id
    ) BEGIN SELECT RAISE(ABORT,'advance_principal_reversal_source_mismatch'); END;
    CREATE TRIGGER trg_advance_principal_reversal_total_guard
    BEFORE INSERT ON buyer_advance_principal_entries
    WHEN NEW.entry_type='REVERSAL' AND EXISTS(
      SELECT 1 FROM buyer_advance_principal_entries payment
      WHERE payment.id=NEW.original_payment_entry_id AND payment.entry_type='PAYMENT'
        AND NEW.amount_cny_fen>payment.amount_cny_fen-COALESCE((
          SELECT SUM(reversal.amount_cny_fen)
          FROM buyer_advance_principal_entries reversal
          WHERE reversal.entry_type='REVERSAL'
            AND reversal.original_payment_entry_id=payment.id
        ),0)
    ) BEGIN SELECT RAISE(ABORT,'advance_principal_reversal_exceeds_payment'); END;
  `);
  return value;
}

function fullSchema66Database(): SqliteDatabase {
  const value = new SqliteDatabase(),
    directory = path.resolve(process.cwd(), 'migrations');
  const files = readdirSync(directory)
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort()
    .slice(0, 66);
  for (const file of files) applySql(value, readFileSync(path.join(directory, file), 'utf8'));
  return value;
}

function applyMigration0067(target: SqliteDatabase): void {
  applySql(target, readFileSync(migrationPath, 'utf8'));
}
function applySql(target: SqliteDatabase, sql: string): void {
  target.exec('BEGIN IMMEDIATE;');
  try {
    target.exec(sql);
    target.exec('COMMIT;');
  } catch (error) {
    try {
      target.exec('ROLLBACK;');
    } catch {}
    throw error;
  }
}
async function schemaVersion(target: SqliteDatabase): Promise<number> {
  const row = await target
    .prepare(`SELECT schema_version FROM app_schema_state WHERE singleton_id=1`)
    .first<{ schema_version: number }>();
  return Number(row?.schema_version);
}
function insertPayment(target: SqliteDatabase, id: string, amount: number) {
  return target
    .prepare(
      `INSERT INTO buyer_advance_principal_entries VALUES(?,'order-1','buyer-1','PAYMENT',NULL,?,1000,NULL,'1970-01-01','WECHAT',NULL,'staff-1',1000)`,
    )
    .bind(id, amount)
    .run();
}
function insertReversal(
  target: SqliteDatabase,
  id: string,
  paymentId: string,
  amount: number,
  orderId = 'order-1',
  buyerId = 'buyer-1',
) {
  return target
    .prepare(
      `INSERT INTO buyer_advance_principal_entries VALUES(?,?,?,'REVERSAL',?,?,NULL,2000,'1970-01-01','WECHAT',NULL,'staff-1',2000)`,
    )
    .bind(id, orderId, buyerId, paymentId, amount)
    .run();
}
