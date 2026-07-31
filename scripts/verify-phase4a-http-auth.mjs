import { DatabaseSync } from 'node:sqlite';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const migrationsDirectory = path.join(root, 'migrations');
const expectedBaseline = [
  '0001_foundation.sql',
  '0002_staff_identity_permissions.sql',
  '0003_customer_master_data.sql',
  '0004_customer_access_auth.sql',
  '0005_seller_stores_products.sql',
  '0006_seller_member_lifecycle.sql',
  '0007_product_applications.sql',
  '0008_demand_batches.sql',
  '0009_reservations.sql',
  '0010_file_storage.sql',
  '0011_pricing_rules.sql',
  '0012_customer_auth_security.sql',
];
const workDirectory = mkdtempSync(
  path.join(tmpdir(), 'ygb-v2-phase4a-'),
);
const databasePath = path.join(workDirectory, 'phase4a.sqlite');

try {
  const actualBaseline = readdirSync(migrationsDirectory)
    .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name))
    .sort();
  if (JSON.stringify(actualBaseline) !== JSON.stringify(expectedBaseline)) {
    throw new Error(
      'Phase 4A verifier requires the formal 0001-0012 sequence; '
      + `found: ${actualBaseline.join(', ')}`,
    );
  }

  const database = new DatabaseSync(databasePath);
  try {
    database.exec('PRAGMA foreign_keys = ON;');
    for (const file of expectedBaseline) {
      database.exec(readFileSync(
        path.join(migrationsDirectory, file),
        'utf8',
      ));
    }
    const integrity = database.prepare(
      'PRAGMA integrity_check',
    ).all().map((row) => String(row.integrity_check));
    if (integrity.length !== 1 || integrity[0] !== 'ok') {
      throw new Error(`integrity_check failed: ${integrity.join(',')}`);
    }
    const foreignKeys = database.prepare(
      'PRAGMA foreign_key_check',
    ).all();
    if (foreignKeys.length > 0) {
      throw new Error(`foreign_key_check found ${foreignKeys.length} rows`);
    }

    const names = new Set(database.prepare(`
      SELECT name FROM sqlite_schema
      WHERE type IN ('table', 'index', 'trigger')
    `).all().map((row) => String(row.name)));
    for (const required of [
      'customer_login_rate_limits',
      'customer_auth_security_events',
      'idx_customer_login_rate_limits_expiry',
      'idx_customer_login_rate_limits_blocked',
      'idx_customer_auth_security_events_account',
      'trg_customer_auth_security_events_no_update',
      'trg_customer_auth_security_events_no_delete',
    ]) {
      if (!names.has(required)) throw new Error(`Missing schema object: ${required}`);
    }

    const state = database.prepare(`
      SELECT schema_version
      FROM app_schema_state
      WHERE singleton_id=1
    `).get();
    if (Number(state?.schema_version) !== 12) {
      throw new Error(
        `Expected staged schema version 12, found ${String(state?.schema_version)}`,
      );
    }

    console.log(JSON.stringify({
      status: 'PASS',
      migrations: expectedBaseline,
      schema_version: 12,
      integrity_check: 'ok',
      foreign_key_errors: 0,
    }, null, 2));
  } finally {
    database.close();
  }
} finally {
  rmSync(workDirectory, { recursive: true, force: true });
}
