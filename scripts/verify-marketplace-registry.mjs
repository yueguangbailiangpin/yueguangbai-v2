// Stage 4 canonical verifier (D-054 §7 equivalence migration).
// Successor of verify:marketplace-money (verify-multi-marketplace-multicurrency.mjs).
// Stage 4 rewrote the asserted surface: the legacy JP alias layer is gone,
// storage carries canonical codes only, and the runtime definitions expose
// exactly the three registry codes.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(import.meta.dirname, '..');
const migrationDirectory = path.join(root, 'migrations');
const migrations = readdirSync(migrationDirectory)
  .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name))
  .sort();
if (migrations.length !== 23 || migrations.at(-1) !== '0023_retire_acquisition_machine_fields.sql') {
  throw new Error('expected the clean baseline 0001-0023');
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

  if (database.prepare('SELECT schema_version FROM app_schema_state WHERE singleton_id=1')
    .get().schema_version !== 23) throw new Error('schema version');

  const registry = database.prepare(`
    SELECT code, status || ':' || adapter_status AS state
    FROM marketplace_registry ORDER BY code
  `).all();
  if (JSON.stringify(registry) !== JSON.stringify([
    { code: 'AMAZON_JP', state: 'ACTIVE:AVAILABLE' },
    { code: 'AMAZON_US', state: 'ACTIVE:AVAILABLE' },
    { code: 'COUPANG_KR', state: 'DISABLED:UNAVAILABLE' },
  ])) throw new Error('three-marketplace registry with COUPANG_KR fail-closed');

  // The legacy alias layer is atomically gone.
  for (const retired of ['marketplaces', 'marketplace_legacy_aliases', 'acquisition_reporting_config']) {
    if (database.prepare(`SELECT COUNT(*) AS count FROM sqlite_schema WHERE name='${retired}'`).get().count !== 0) {
      throw new Error(`retired table still present: ${retired}`);
    }
  }
  const runtimeColumns = database.prepare('PRAGMA table_info(marketplace_runtime_config)')
    .all().map((column) => column.name);
  if (runtimeColumns.includes('legacy_order_code')) throw new Error('legacy_order_code survived');
  const formalColumns = database.prepare('PRAGMA table_info(formal_orders)')
    .all().map((column) => column.name);
  if (formalColumns.includes('canonical_marketplace_code')) throw new Error('dual marketplace column survived');

  const integrity = database.prepare('PRAGMA integrity_check').all();
  if (integrity.length !== 1 || String(integrity[0].integrity_check) !== 'ok') {
    throw new Error('integrity failed');
  }
  if (database.prepare('PRAGMA foreign_key_check').all().length > 0) {
    throw new Error('foreign key errors');
  }
} finally {
  database.close();
}

// Runtime contract surfaces: exactly three codes, integer money, no float APIs.
const contracts = readFileSync(path.join(root, 'packages/contracts/src/customer.ts'), 'utf8');
if (!/export const MARKETPLACE_CODES = \[\n  'AMAZON_JP',\n  'AMAZON_US',\n  'COUPANG_KR',\n\] as const;/u.test(contracts)) {
  throw new Error('MARKETPLACE_CODES must publish exactly the three canonical codes');
}
if (contracts.includes('LEGACY_MARKETPLACE_CODES')) throw new Error('legacy alias types survived');
for (const file of [
  'packages/domain/src/money/currency.ts',
  'packages/contracts/src/marketplace-money.ts',
  'apps/api/src/pricing/currency-rate-foundation.ts',
  'apps/api/src/pricing/marketplace-service-fee.ts',
  'apps/api/src/order-evidence/approve-order-evidence.ts',
]) {
  const code = readFileSync(path.join(root, file), 'utf8');
  if (/\b(?:parseFloat|toFixed)\s*\(/u.test(code)) throw new Error(`${file}: float API`);
}

console.log(JSON.stringify({
  status: 'PASS',
  baseline: 'clean-baseline-0001-0023',
  registry: ['AMAZON_JP', 'AMAZON_US', 'COUPANG_KR'],
  korea: 'DISABLED/UNAVAILABLE',
  legacy_jp_alias: 'REMOVED_STAGE_4',
  floating_finance: false,
}, null, 2));
