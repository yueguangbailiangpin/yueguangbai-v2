import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';

const root = path.resolve(import.meta.dirname, '..');
const migrationDirectory = path.join(root, 'migrations');
const migrations = readdirSync(migrationDirectory)
  .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name))
  .sort();
const marketplaceMigration = '0029_multi_marketplace_multicurrency_foundation.sql';
const marketplaceMigrationIndex = migrations.indexOf(marketplaceMigration);
if (marketplaceMigrationIndex !== 28) {
  throw new Error('0029 must remain the 29th consecutive migration');
}

const work = mkdtempSync(path.join(tmpdir(), 'ygb-v2-marketplace-money-'));
try {
  const database = open();
  apply(database, migrations.slice(0, marketplaceMigrationIndex));
  seedJpUpgradeFixture(database);
  const before = manifest(database);
  const beforeHash = hash(before);
  const preWriteBackup = path.join(work, 'pre-write.sqlite');
  await backup(database, preWriteBackup);

  runMigration(database, marketplaceMigration);
  assert(database.prepare(`
    SELECT schema_version FROM app_schema_state WHERE singleton_id=1
  `).get().schema_version === 29, 'schema version');
  assert(database.prepare('SELECT COUNT(*) AS count FROM marketplace_registry')
    .get().count === 3, 'marketplace seed count');
  assert(database.prepare('SELECT COUNT(*) AS count FROM currencies')
    .get().count === 4, 'currency seed count');
  assert(database.prepare(`
    SELECT status || ':' || adapter_status AS state
    FROM marketplace_registry WHERE code='COUPANG_KR'
  `).get().state === 'DISABLED:UNAVAILABLE', 'Korea fail-closed state');
  assert(database.prepare(`
    SELECT rate_value || ':' || rate_scale AS value
    FROM buyer_daily_currency_rate_versions WHERE legacy_rate_id='buyer-rate-jp'
  `).get().value === '4800000:100000000', 'buyer rate exact backfill');
  assert(database.prepare(`
    SELECT rate_value || ':' || rate_scale AS value
    FROM seller_agreement_currency_rate_versions
    WHERE legacy_rate_id='seller-rate-jp'
  `).get().value === '4700000:100000000', 'seller rate exact backfill');
  assert(database.prepare(`
    SELECT fee_amount_minor || ':' || fee_currency_code AS value
    FROM seller_service_fee_rule_versions WHERE legacy_fee_id='fee-jp'
  `).get().value === '1234:CNY', 'fee exact backfill');
  integrity(database, 'upgraded');

  database.exec(`
    INSERT INTO buyer_daily_currency_rate_versions (
      id, legacy_rate_id, business_date, source_currency_code,
      quote_currency_code, version_no, status, rate_value, rate_scale,
      rounding_rule, submitted_by_staff_id, submitted_at, decision_version,
      confirmed_by_staff_id, confirmed_at, rejected_by_staff_id, rejected_at,
      rejection_reason
    ) VALUES (
      'buyer-rate-usd',NULL,'2026-08-06','USD','CNY',1,'SUBMITTED',
      720000000,100000000,'HALF_UP','staff-owner',5000,1,
      NULL,NULL,NULL,NULL,NULL
    );
  `);
  const forwardBackup = path.join(work, 'forward-recovery.sqlite');
  await backup(database, forwardBackup);
  integrity(database, 'post-new-currency');
  database.close();

  const restoredPreWrite = new DatabaseSync(preWriteBackup, { readOnly: true });
  assert(hash(manifest(restoredPreWrite)) === beforeHash,
    'pre-write restore manifest mismatch');
  assert(restoredPreWrite.prepare(`
    SELECT schema_version FROM app_schema_state WHERE singleton_id=1
  `).get().schema_version === 28, 'pre-write restore schema');
  integrity(restoredPreWrite, 'pre-write-restore');
  restoredPreWrite.close();

  const restoredForward = new DatabaseSync(forwardBackup, { readOnly: true });
  assert(restoredForward.prepare(`
    SELECT COUNT(*) AS count FROM buyer_daily_currency_rate_versions
    WHERE source_currency_code='USD'
  `).get().count === 1, 'forward recovery lost USD fact');
  integrity(restoredForward, 'forward-restore');
  restoredForward.close();

  const source = readFileSync(
    path.join(migrationDirectory, marketplaceMigration), 'utf8',
  );
  assert(!/\b(?:REAL|FLOAT)\b/iu.test(source), 'floating SQL type');
  for (const file of [
    'packages/domain/src/money/currency.ts',
    'packages/contracts/src/marketplace-money.ts',
    'apps/api/src/pricing/currency-rate-foundation.ts',
    'apps/api/src/pricing/marketplace-service-fee.ts',
    'apps/api/src/order-evidence/approve-order-evidence.ts',
  ]) {
    const code = readFileSync(path.join(root, file), 'utf8');
    assert(!/\b(?:parseFloat|toFixed)\s*\(/u.test(code), `${file}: float API`);
  }

  console.log(JSON.stringify({
    status: 'PASS',
    migration: marketplaceMigration,
    jp_manifest_sha256: beforeHash,
    fresh_and_upgrade_integrity: 'ok',
    pre_write_restore: 'verified',
    post_new_currency_recovery: 'forward-only backup verified',
    korea: 'DISABLED/UNAVAILABLE',
    floating_finance: false,
  }, null, 2));
} finally {
  rmSync(work, { recursive: true, force: true });
}

function open() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys=ON;');
  return database;
}

function apply(database, files) {
  for (const file of files) runMigration(database, file);
}

function runMigration(database, file) {
  database.exec('BEGIN IMMEDIATE;');
  try {
    database.exec(readFileSync(path.join(migrationDirectory, file), 'utf8'));
    database.exec('COMMIT;');
  } catch (error) {
    try { database.exec('ROLLBACK;'); } catch { /* no open transaction */ }
    throw error;
  }
}

function seedJpUpgradeFixture(database) {
  database.exec(`
    INSERT INTO staff_users (
      id, display_name, status, authorization_version,
      version, created_at, updated_at, disabled_at
    ) VALUES ('staff-owner','管理员','ACTIVE',1,1,1,1,NULL);
    INSERT INTO buyer_channels (
      id, code, name, status, next_sequence, version,
      created_at, updated_at, disabled_at
    ) VALUES ('buyer-channel','B','买家渠道','ACTIVE',1,1,1,1,NULL);
    INSERT INTO customer_identity_subjects (id, subject_type, created_at)
    VALUES ('buyer-subject','BUYER_CUSTOMER',1);
    INSERT INTO buyer_customers (
      id, identity_subject_id, marketplace_code, buyer_channel_id,
      buyer_customer_no, buyer_sequence, first_valid_order_business_date,
      display_name, access_status, identity_review_status, version,
      created_at, updated_at, activated_at, disabled_at
    ) VALUES (
      'buyer-jp','buyer-subject','JP','buyer-channel',NULL,NULL,NULL,
      '日本站买家','ACTIVE','CLEAR',1,1,1,1,NULL
    );
    INSERT INTO seller_organizations (
      id, marketplace_code, seller_code, origin_channel_id,
      current_channel_id, seller_sequence, organization_name, status,
      version, created_at, updated_at, activated_at, disabled_at,
      next_member_number
    ) VALUES (
      'seller-org','JP','ido-mango-990001','seller-channel-ido-mango',
      'seller-channel-ido-mango',990001,'日本站卖家','ACTIVE',1,1,1,1,NULL,2
    );
    INSERT INTO seller_stores (
      id, organization_id, marketplace_code, display_name,
      normalized_name, status, version, created_at, updated_at, disabled_at
    ) VALUES (
      'store-jp','seller-org','JP','日本店','日本店','ACTIVE',1,1,1,NULL
    );
    INSERT INTO buyer_daily_exchange_rates (
      id, business_date, version_no, status, cny_per_jpy_e8,
      submitted_by_staff_id, submitted_at, decision_version,
      confirmed_by_staff_id, confirmed_at, rejected_by_staff_id,
      rejected_at, rejection_reason
    ) VALUES (
      'buyer-rate-jp','2026-08-06',1,'SUBMITTED',4800000,
      'staff-owner',1000,1,NULL,NULL,NULL,NULL,NULL
    );
    INSERT INTO seller_agreement_rate_versions (
      id, organization_id, review_type, version_no, status, cny_per_jpy_e8,
      effective_from, submitted_by_staff_id, submitted_at, decision_version,
      confirmed_by_staff_id, confirmed_at, rejected_by_staff_id,
      rejected_at, rejection_reason
    ) VALUES (
      'seller-rate-jp','seller-org',NULL,1,'SUBMITTED',4700000,10000,
      'staff-owner',1000,1,NULL,NULL,NULL,NULL,NULL
    );
    INSERT INTO seller_service_fee_versions (
      id, organization_id, review_type, version_no, status, fee_cny_fen,
      effective_from, submitted_by_staff_id, submitted_at, decision_version,
      confirmed_by_staff_id, confirmed_at, rejected_by_staff_id,
      rejected_at, rejection_reason
    ) VALUES (
      'fee-jp','seller-org','TEXT',1,'SUBMITTED',1234,10000,
      'staff-owner',1000,1,NULL,NULL,NULL,NULL,NULL
    );
  `);
}

function manifest(database) {
  const tables = [
    'buyer_customers', 'seller_stores', 'buyer_daily_exchange_rates',
    'seller_agreement_rate_versions', 'seller_service_fee_versions',
    'formal_orders', 'formal_order_financial_snapshots',
  ];
  return {
    schema_version: database.prepare(`
      SELECT schema_version FROM app_schema_state WHERE singleton_id=1
    `).get().schema_version,
    tables: Object.fromEntries(tables.map((table) => {
      const rows = database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
      return [table, { row_count: rows.length, sha256: hash(rows) }];
    })),
  };
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function integrity(database, label) {
  const result = database.prepare('PRAGMA integrity_check').all();
  assert(result.length === 1 && result[0].integrity_check === 'ok',
    `${label}: integrity`);
  assert(database.prepare('PRAGMA foreign_key_check').all().length === 0,
    `${label}: foreign keys`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
