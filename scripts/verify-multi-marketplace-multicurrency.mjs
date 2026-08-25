// Original verify-multi-marketplace-multicurrency asserted the legacy 0028→0029
// upgrade path. That mid-chain semantics retired with the old chain (D-054);
// this verifier now anchors the same protected business assertions on the
// stage 3 clean baseline: the merged three-marketplace registry (§3.3), the
// integer rate/fee models, the legacy 'JP' alias minimal form (removed
// atomically in stage 4), and the no-floating-point rule across schema and
// runtime.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(import.meta.dirname, '..');
const migrationDirectory = path.join(root, 'migrations');
const migrations = readdirSync(migrationDirectory)
  .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name))
  .sort();
if (migrations.length !== 19 || migrations.at(-1) !== '0019_read_model_views.sql') {
  throw new Error('expected the stage 3 clean baseline 0001-0019');
}
for (const file of migrations) {
  const source = readFileSync(path.join(migrationDirectory, file), 'utf8');
  if (/\b(?:REAL|FLOAT)\b/iu.test(source)) {
    throw new Error(`${file}: floating SQL type`);
  }
}

const database = new DatabaseSync(':memory:');
try {
  database.exec('PRAGMA foreign_keys=ON;');
  for (const file of migrations) {
    database.exec('BEGIN IMMEDIATE;');
    try {
      database.exec(readFileSync(path.join(migrationDirectory, file), 'utf8'));
      database.exec('COMMIT;');
    } catch (error) {
      try { database.exec('ROLLBACK;'); } catch { /* no open transaction */ }
      throw error;
    }
  }

  assert(database.prepare(`
    SELECT schema_version FROM app_schema_state WHERE singleton_id=1
  `).get().schema_version === 19, 'schema version');

  const registry = database.prepare(`
    SELECT code, status || ':' || adapter_status AS state
    FROM marketplace_registry ORDER BY code
  `).all();
  assert(JSON.stringify(registry) === JSON.stringify([
    { code: 'AMAZON_JP', state: 'ACTIVE:AVAILABLE' },
    { code: 'AMAZON_US', state: 'ACTIVE:AVAILABLE' },
    { code: 'COUPANG_KR', state: 'DISABLED:UNAVAILABLE' },
  ]), 'clean three-marketplace registry with COUPANG_KR fail-closed');
  assert(database.prepare('SELECT COUNT(*) AS count FROM marketplace_registry')
    .get().count === 3, 'marketplace seed count');
  assert(database.prepare('SELECT COUNT(*) AS count FROM currencies')
    .get().count === 4, 'currency seed count');

  const alias = database.prepare(`
    SELECT legacy_code, marketplace_code FROM marketplace_legacy_aliases
  `).all();
  assert(JSON.stringify(alias) === JSON.stringify(
    [{ legacy_code: 'JP', marketplace_code: 'AMAZON_JP' }],
  ), 'legacy JP alias minimal form');

  const runtimeConfig = database.prepare(`
    SELECT marketplace_code, legacy_order_code, business_timezone,
      reporting_timezone, currency_code, currency_exponent,
      seller_portal_status, buyer_portal_status
    FROM marketplace_runtime_config ORDER BY marketplace_code
  `).all();
  assert(JSON.stringify(runtimeConfig) === JSON.stringify([
    { marketplace_code: 'AMAZON_JP', legacy_order_code: 'JP',
      business_timezone: 'Asia/Tokyo', reporting_timezone: 'Asia/Shanghai',
      currency_code: 'JPY', currency_exponent: 0,
      seller_portal_status: 'ACTIVE', buyer_portal_status: 'ACTIVE' },
    { marketplace_code: 'AMAZON_US', legacy_order_code: 'US',
      business_timezone: 'America/Los_Angeles', reporting_timezone: 'Asia/Shanghai',
      currency_code: 'USD', currency_exponent: 2,
      seller_portal_status: 'PREPARED', buyer_portal_status: 'ACTIVE' },
    { marketplace_code: 'COUPANG_KR', legacy_order_code: 'KR',
      business_timezone: 'Asia/Seoul', reporting_timezone: 'Asia/Shanghai',
      currency_code: 'KRW', currency_exponent: 0,
      seller_portal_status: 'PREPARED', buyer_portal_status: 'PREPARED' },
  ]), 'runtime config minimal set');

  for (const table of [
    'buyer_daily_currency_rate_versions',
    'seller_service_fee_rule_versions',
    'order_evidence_marketplace_money',
    'formal_order_marketplace_money_snapshots',
    'buyer_marketplace_assignments',
    'seller_store_marketplaces',
  ]) {
    assert(database.prepare(
      `SELECT COUNT(*) AS count FROM sqlite_schema WHERE name='${table}'`,
    ).get().count === 1, `table ${table}`);
  }
  for (const trigger of [
    'trg_buyer_daily_currency_rate_legacy_insert',
    'trg_buyer_daily_currency_rate_legacy_update',
    'trg_seller_service_fee_rule_legacy_insert',
    'trg_seller_service_fee_rule_legacy_update',
    'trg_buyer_customer_marketplace_default',
    'trg_seller_store_marketplace_default',
  ]) {
    assert(database.prepare(
      `SELECT COUNT(*) AS count FROM sqlite_schema WHERE name='${trigger}'`,
    ).get().count === 1, `trigger ${trigger}`);
  }
  for (const [table, column] of [
    ['buyer_daily_currency_rate_versions', 'rate_value'],
    ['buyer_daily_currency_rate_versions', 'rate_scale'],
    ['formal_order_marketplace_money_snapshots', 'payment_amount_minor'],
  ]) {
    const definition = database.prepare(`PRAGMA table_info(${table})`)
      .all().find((value) => value.name === column);
    assert(definition && String(definition.type).toUpperCase() === 'INTEGER',
      `${table}.${column} must be INTEGER`);
  }

  database.exec(`
    INSERT INTO staff_users (
      id, display_name, status, authorization_version,
      version, created_at, updated_at, disabled_at
    ) VALUES ('staff-owner','管理员','ACTIVE',1,1,1,1,NULL);
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
  assert(database.prepare(`
    SELECT COUNT(*) AS count FROM buyer_daily_currency_rate_versions
    WHERE source_currency_code='USD'
  `).get().count === 1, 'forward USD rate fact');
  integrity(database, 'baseline');

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
    baseline: 'stage3-clean-baseline-0001-0019',
    registry: ['AMAZON_JP', 'AMAZON_US', 'COUPANG_KR'],
    korea: 'DISABLED/UNAVAILABLE',
    legacy_jp_alias: 'MINIMAL_FORM_UNTIL_STAGE_4',
    forward_usd_rate: 'verified',
    floating_finance: false,
  }, null, 2));
} finally {
  database.close();
}

function integrity(database, label) {
  const result = database.prepare('PRAGMA integrity_check').all();
  if (result.length !== 1 || String(result[0].integrity_check) !== 'ok') {
    throw new Error(`${label}: integrity failed`);
  }
  if (database.prepare('PRAGMA foreign_key_check').all().length > 0) {
    throw new Error(`${label}: foreign key errors`);
  }
}

function assert(value, label) {
  if (!value) throw new Error(`marketplace registry verification failed: ${label}`);
}
