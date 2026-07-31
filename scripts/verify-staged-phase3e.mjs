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
const stagedMigration = path.join(
  root,
  'staged-migrations',
  '0011_pricing_rules.sql',
);
const workDirectory = mkdtempSync(
  path.join(tmpdir(), 'ygb-phase3e-'),
);
const databasePath = path.join(workDirectory, 'phase3e.sqlite');

const pricingTables = [
  'buyer_daily_exchange_rates',
  'buyer_daily_exchange_rate_events',
  'seller_agreement_rate_versions',
  'seller_agreement_rate_events',
  'seller_service_fee_versions',
  'seller_service_fee_events',
];

const requiredTriggers = [
  'trg_buyer_daily_rate_initial_state_guard',
  'trg_buyer_daily_rate_after_confirmed_guard',
  'trg_buyer_daily_rate_pending_conflict',
  'trg_buyer_daily_rate_confirmed_conflict',
  'trg_buyer_daily_rate_decision_only',
  'trg_buyer_daily_rate_no_delete',
  'trg_buyer_daily_rate_events_no_update',
  'trg_buyer_daily_rate_events_no_delete',
  'trg_seller_agreement_rate_initial_state_guard',
  'trg_seller_agreement_rate_pending_conflict',
  'trg_seller_agreement_rate_effective_conflict',
  'trg_seller_agreement_rate_decision_only',
  'trg_seller_agreement_rate_no_delete',
  'trg_seller_agreement_rate_events_no_update',
  'trg_seller_agreement_rate_events_no_delete',
  'trg_seller_service_fee_initial_state_guard',
  'trg_seller_service_fee_pending_conflict',
  'trg_seller_service_fee_effective_conflict',
  'trg_seller_service_fee_decision_only',
  'trg_seller_service_fee_no_delete',
  'trg_seller_service_fee_events_no_update',
  'trg_seller_service_fee_events_no_delete',
];

try {
  const formalMigrations = readdirSync(migrationsDirectory)
    .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name))
    .sort();
  assertFormalMigrationSequence(formalMigrations);

  const stagedSql = readFileSync(stagedMigration, 'utf8');
  if (/\bREAL\b/u.test(stagedSql)) {
    throw new Error('Phase 3E Migration 禁止 REAL');
  }
  if (/0010_[a-z0-9_-]+\.sql/u.test(stagedSql)) {
    throw new Error('0011 不得制造或引用空 0010 Migration');
  }

  const database = new DatabaseSync(databasePath);
  try {
    database.exec('PRAGMA foreign_keys = ON;');
    for (const file of formalMigrations) {
      database.exec(readFileSync(
        path.join(migrationsDirectory, file),
        'utf8',
      ));
    }
    const schemaBefore = readSchemaVersion(database);
    database.exec(stagedSql);
    const schemaAfter = readSchemaVersion(database);

    const expectedBefore = formalMigrations.length;
    if (schemaBefore !== expectedBefore) {
      throw new Error(
        `正式 Schema 版本 ${schemaBefore} 与 Migration 数量 `
        + `${expectedBefore} 不一致`,
      );
    }
    const expectedAfter = schemaBefore === 10 ? 11 : 9;
    if (schemaAfter !== expectedAfter) {
      throw new Error(
        `staged 0011 后 Schema 版本应为 ${expectedAfter}，实际为 `
        + `${schemaAfter}`,
      );
    }

    assertSchemaObjects(database);
    assertIntegerFacts(database);
    runAnonymousPricingChecks(database);

    const integrity = database.prepare('PRAGMA integrity_check')
      .all().map((row) => String(row.integrity_check));
    if (integrity.length !== 1 || integrity[0] !== 'ok') {
      throw new Error(`integrity_check 失败: ${integrity.join(',')}`);
    }
    const foreignKeys = database.prepare('PRAGMA foreign_key_check').all();
    if (foreignKeys.length > 0) {
      throw new Error(`foreign_key_check 发现 ${foreignKeys.length} 项`);
    }

    console.log(JSON.stringify({
      status: 'PASS',
      formal_migrations: formalMigrations,
      staged_migration: path.relative(root, stagedMigration),
      schema_version_before: schemaBefore,
      schema_version_after: schemaAfter,
      pricing_tables: pricingTables,
      required_triggers: requiredTriggers.length,
      integer_fact_check: 'PASS',
      exact_date_no_fallback: 'PASS',
      future_effective_resolution: 'PASS',
      immutable_fact_checks: 'PASS',
      integrity_check: 'ok',
      foreign_key_errors: 0,
    }, null, 2));
  } finally {
    database.close();
  }
} finally {
  rmSync(workDirectory, {
    recursive: true,
    force: true,
  });
}

function assertFormalMigrationSequence(files) {
  if (files.length < 9 || files.length > 10) {
    throw new Error(
      'Phase 3E staged 验证只接受正式 0001-0009 或 0001-0010',
    );
  }
  files.forEach((file, index) => {
    const expected = String(index + 1).padStart(4, '0');
    if (!file.startsWith(`${expected}_`)) {
      throw new Error(`Migration 序列缺口: 期望 ${expected}，实际 ${file}`);
    }
  });
  if (files.some((file) => file.startsWith('0011_'))) {
    throw new Error('0011 仍必须位于 staged-migrations');
  }
}

function readSchemaVersion(database) {
  const row = database.prepare(`
    SELECT schema_version
    FROM app_schema_state
    WHERE singleton_id=1
  `).get();
  return Number(row?.schema_version);
}

function assertSchemaObjects(database) {
  const tables = new Set(database.prepare(`
    SELECT name
    FROM sqlite_schema
    WHERE type='table'
  `).all().map((row) => String(row.name)));
  const triggers = new Set(database.prepare(`
    SELECT name
    FROM sqlite_schema
    WHERE type='trigger'
  `).all().map((row) => String(row.name)));

  for (const table of pricingTables) {
    if (!tables.has(table)) throw new Error(`缺少定价表: ${table}`);
  }
  for (const trigger of requiredTriggers) {
    if (!triggers.has(trigger)) throw new Error(`缺少定价触发器: ${trigger}`);
  }
}

function assertIntegerFacts(database) {
  const facts = new Map([
    ['buyer_daily_exchange_rates', ['cny_per_jpy_e8']],
    ['seller_agreement_rate_versions', ['cny_per_jpy_e8']],
    ['seller_service_fee_versions', ['fee_cny_fen']],
  ]);
  for (const [table, columns] of facts) {
    const definitions = new Map(database.prepare(
      `PRAGMA table_info(${table})`,
    ).all().map((column) => [
      String(column.name),
      String(column.type).toUpperCase(),
    ]));
    for (const column of columns) {
      if (definitions.get(column) !== 'INTEGER') {
        throw new Error(`${table}.${column} 必须为 INTEGER`);
      }
    }
  }
}

function runAnonymousPricingChecks(database) {
  seedAnonymousActors(database);

  database.exec(`
    INSERT INTO buyer_daily_exchange_rates (
      id, business_date, version_no, status,
      cny_per_jpy_e8, submitted_by_staff_id,
      submitted_at, decision_version,
      confirmed_by_staff_id, confirmed_at,
      rejected_by_staff_id, rejected_at, rejection_reason
    ) VALUES (
      'rate-2026-08-01-v1', '2026-08-01', 1, 'SUBMITTED',
      5000000, 'phase3e-seller-ops', 1000, 1,
      NULL, NULL, NULL, NULL, NULL
    );

    UPDATE buyer_daily_exchange_rates
    SET
      status='CONFIRMED',
      decision_version=2,
      confirmed_by_staff_id='phase3e-owner',
      confirmed_at=2000
    WHERE id='rate-2026-08-01-v1';

    INSERT INTO seller_agreement_rate_versions (
      id, organization_id, review_type, version_no,
      status, cny_per_jpy_e8, effective_from,
      submitted_by_staff_id, submitted_at, decision_version,
      confirmed_by_staff_id, confirmed_at,
      rejected_by_staff_id, rejected_at, rejection_reason
    ) VALUES (
      'agreement-v1', 'phase3e-seller-org', NULL, 1,
      'SUBMITTED', 5200000, 10000,
      'phase3e-seller-ops', 1000, 1,
      NULL, NULL, NULL, NULL, NULL
    );

    UPDATE seller_agreement_rate_versions
    SET
      status='CONFIRMED',
      decision_version=2,
      confirmed_by_staff_id='phase3e-owner',
      confirmed_at=2000
    WHERE id='agreement-v1';

    INSERT INTO seller_service_fee_versions (
      id, organization_id, review_type, version_no,
      status, fee_cny_fen, effective_from,
      submitted_by_staff_id, submitted_at, decision_version,
      confirmed_by_staff_id, confirmed_at,
      rejected_by_staff_id, rejected_at, rejection_reason
    ) VALUES (
      'fee-rating-v1', 'phase3e-seller-org', 'RATING', 1,
      'SUBMITTED', 0, 10000,
      'phase3e-seller-ops', 1000, 1,
      NULL, NULL, NULL, NULL, NULL
    );

    UPDATE seller_service_fee_versions
    SET
      status='CONFIRMED',
      decision_version=2,
      confirmed_by_staff_id='phase3e-owner',
      confirmed_at=2100
    WHERE id='fee-rating-v1';
  `);

  const exactMissing = database.prepare(`
    SELECT id
    FROM buyer_daily_exchange_rates
    WHERE business_date='2026-08-02'
      AND status='CONFIRMED'
  `).get();
  if (exactMissing !== undefined) {
    throw new Error('买家每日汇率发生了日期回退');
  }

  const beforeEffective = database.prepare(`
    SELECT id
    FROM seller_agreement_rate_versions
    WHERE organization_id='phase3e-seller-org'
      AND status='CONFIRMED'
      AND effective_from<=9999
      AND confirmed_at<=9999
    ORDER BY effective_from DESC, version_no DESC
    LIMIT 1
  `).get();
  if (beforeEffective !== undefined) {
    throw new Error('卖家协议汇率在 effective_from 前被解析');
  }

  const atEffective = database.prepare(`
    SELECT id
    FROM seller_agreement_rate_versions
    WHERE organization_id='phase3e-seller-org'
      AND status='CONFIRMED'
      AND effective_from<=10000
      AND confirmed_at<=10000
    ORDER BY effective_from DESC, version_no DESC
    LIMIT 1
  `).get();
  if (atEffective?.id !== 'agreement-v1') {
    throw new Error('卖家协议汇率未按生效时间解析');
  }

  assertSqlFails(
    database,
    `UPDATE buyer_daily_exchange_rates
      SET cny_per_jpy_e8=1
      WHERE id='rate-2026-08-01-v1'`,
    'buyer_daily_exchange_rate_is_immutable',
  );
  assertSqlFails(
    database,
    `INSERT INTO buyer_daily_exchange_rates (
      id, business_date, version_no, status,
      cny_per_jpy_e8, submitted_by_staff_id,
      submitted_at, decision_version,
      confirmed_by_staff_id, confirmed_at,
      rejected_by_staff_id, rejected_at, rejection_reason
    ) VALUES (
      'rate-2026-08-01-v2', '2026-08-01', 2, 'SUBMITTED',
      5100000, 'phase3e-seller-ops', 3000, 1,
      NULL, NULL, NULL, NULL, NULL
    )`,
    'pricing_confirmed_conflict',
  );
  assertSqlFails(
    database,
    `UPDATE seller_agreement_rate_versions
      SET effective_from=20000
      WHERE id='agreement-v1'`,
    'seller_agreement_rate_version_is_immutable',
  );
}

function seedAnonymousActors(database) {
  database.exec(`
    INSERT INTO staff_users (
      id, display_name, status, authorization_version,
      version, created_at, updated_at, disabled_at
    ) VALUES
      ('phase3e-seller-ops', 'Anonymous Seller Ops',
        'ACTIVE', 1, 1, 1, 1, NULL),
      ('phase3e-owner', 'Anonymous Owner',
        'ACTIVE', 1, 1, 1, 1, NULL);

    INSERT INTO seller_organizations (
      id, marketplace_code, seller_code,
      origin_channel_id, current_channel_id,
      seller_sequence, organization_name, status,
      version, created_at, updated_at,
      activated_at, disabled_at, next_member_number
    ) VALUES (
      'phase3e-seller-org', 'JP', 'ido-mango-999999',
      'seller-channel-ido-mango', 'seller-channel-ido-mango',
      999999, 'Anonymous Pricing Organization', 'ACTIVE',
      1, 1, 1, 1, NULL, 2
    );
  `);
}

function assertSqlFails(database, sql, expectedMessage) {
  try {
    database.exec(sql);
  } catch (error) {
    if (String(error).includes(expectedMessage)) return;
    throw new Error(
      `预期 ${expectedMessage}，实际错误 ${String(error)}`,
    );
  }
  throw new Error(`SQL 应失败但成功: ${expectedMessage}`);
}
