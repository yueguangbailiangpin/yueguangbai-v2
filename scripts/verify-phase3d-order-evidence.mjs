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
const migrationName = '0013_order_evidence.sql';
const migrationPath = path.join(migrationsDirectory, migrationName);
const workDirectory = mkdtempSync(
  path.join(tmpdir(), 'ygb-v2-phase3d-'),
);

const requiredTables = [
  'order_evidence_submissions',
  'order_evidence_versions',
  'order_evidence_version_files',
  'order_evidence_duplicate_signals',
  'order_evidence_events',
];
const requiredTriggers = [
  'trg_order_evidence_submission_reservation_guard',
  'trg_order_evidence_submission_identity_immutable',
  'trg_order_evidence_version_submission_guard',
  'trg_order_evidence_versions_no_update',
  'trg_order_evidence_versions_no_delete',
  'trg_order_evidence_version_file_guard',
  'trg_order_evidence_version_files_no_update',
  'trg_order_evidence_version_files_no_delete',
  'trg_order_evidence_duplicate_signal_after_version',
  'trg_order_evidence_duplicate_signals_no_update',
  'trg_order_evidence_duplicate_signals_no_delete',
  'trg_order_evidence_event_identity_guard',
  'trg_order_evidence_events_no_update',
  'trg_order_evidence_events_no_delete',
];

try {
  const migrationFiles = readdirSync(migrationsDirectory)
    .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name))
    .sort();
  if (migrationFiles.length !== 13
    || migrationFiles.at(-1) !== migrationName) {
    throw new Error(
      `Phase 3D 要求连续 Migration 0001-0013，实际: ${migrationFiles.join(', ')}`,
    );
  }

  const migrationSql = readFileSync(migrationPath, 'utf8');
  if (/\bREAL\b/iu.test(migrationSql)) {
    throw new Error('Phase 3D Migration 禁止 REAL 金额事实');
  }
  for (const forbidden of [
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?orders\b/iu,
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?order_financial/iu,
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?buyer_refunds\b/iu,
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?seller_settlements\b/iu,
  ]) {
    if (forbidden.test(migrationSql)) {
      throw new Error('Phase 3D Migration 越界创建正式订单或财务表');
    }
  }

  verifyFreshDatabase(migrationFiles);
  verifyWrongPredecessorRejected(migrationFiles);
  verifyRepeatRejected(migrationFiles);
  verifySourceBoundary();

  console.log(JSON.stringify({
    status: 'PASS',
    migration: migrationName,
    migrations: migrationFiles,
    schema_version: 13,
    required_tables: requiredTables,
    required_triggers: requiredTriggers,
    final_paid_jpy_storage: 'INTEGER',
    duplicate_order_behavior: 'SIGNAL_ONLY_NO_UNIQUE_REJECTION',
    file_binding: 'VERIFIED_ORDER_EVIDENCE_BUYER_OWNED_NOT_SELLER_VISIBLE',
    formal_order_generation: false,
    financial_snapshot_generation: false,
    remote_actions: false,
  }, null, 2));
} finally {
  rmSync(workDirectory, {
    recursive: true,
    force: true,
  });
}

function openDatabase(fileName) {
  const database = new DatabaseSync(fileName);
  database.exec('PRAGMA foreign_keys = ON;');
  return database;
}

function applyFiles(database, names) {
  for (const name of names) {
    database.exec(readFileSync(
      path.join(migrationsDirectory, name),
      'utf8',
    ));
  }
}

function schemaVersion(database) {
  const row = database.prepare(`
    SELECT schema_version
    FROM app_schema_state
    WHERE singleton_id=1
  `).get();
  return Number(row?.schema_version);
}

function verifyFreshDatabase(migrationFiles) {
  const database = openDatabase(
    path.join(workDirectory, 'fresh.sqlite'),
  );
  try {
    applyFiles(database, migrationFiles);
    if (schemaVersion(database) !== 13) {
      throw new Error('Fresh Phase 3D schema_version 必须为 13');
    }

    const tables = new Set(database.prepare(`
      SELECT name
      FROM sqlite_schema
      WHERE type='table'
    `).all().map((row) => String(row.name)));
    const triggers = new Map(database.prepare(`
      SELECT name, sql
      FROM sqlite_schema
      WHERE type='trigger'
    `).all().map((row) => [
      String(row.name),
      String(row.sql ?? ''),
    ]));
    for (const table of requiredTables) {
      if (!tables.has(table)) throw new Error(`缺少表: ${table}`);
    }
    for (const trigger of requiredTriggers) {
      if (!triggers.has(trigger)) throw new Error(`缺少触发器: ${trigger}`);
    }

    const versionColumns = new Map(database.prepare(`
      PRAGMA table_info(order_evidence_versions)
    `).all().map((column) => [
      String(column.name),
      String(column.type).toUpperCase(),
    ]));
    if (versionColumns.get('final_paid_jpy') !== 'INTEGER') {
      throw new Error('order_evidence_versions.final_paid_jpy 必须为 INTEGER');
    }
    for (const forbiddenColumn of [
      'buyer_number',
      'business_order_number',
      'buyer_rate_snapshot',
      'seller_rate_snapshot',
      'service_fee_snapshot',
      'profit_cny_fen',
      'refund_amount',
      'settlement_amount',
      'public_url',
      'signed_url',
    ]) {
      if (versionColumns.has(forbiddenColumn)) {
        throw new Error(`Phase 3D 禁止字段: ${forbiddenColumn}`);
      }
    }

    const duplicateIndex = database.prepare(`
      SELECT sql
      FROM sqlite_schema
      WHERE type='index'
        AND name='idx_order_evidence_version_normalized_order'
    `).get();
    if (!duplicateIndex) {
      throw new Error('缺少规范化订单号冲突查询索引');
    }
    const uniqueOrderIndex = database.prepare(`
      SELECT name, sql
      FROM sqlite_schema
      WHERE type='index'
        AND tbl_name='order_evidence_versions'
        AND sql IS NOT NULL
        AND upper(sql) LIKE '%UNIQUE%AMAZON_ORDER_NUMBER_NORMALIZED%'
    `).all();
    if (uniqueOrderIndex.length > 0) {
      throw new Error('Amazon订单号不得建立全局唯一约束');
    }

    const fileGuard = triggers.get(
      'trg_order_evidence_version_file_guard',
    ) ?? '';
    for (const requiredText of [
      "object.status='VERIFIED'",
      "intent.status='VERIFIED'",
      "object.purpose='ORDER_EVIDENCE'",
      "intent.owner_actor_type='BUYER_CUSTOMER'",
      "intent.owner_actor_id=NEW.buyer_customer_id",
      "NEW.visibility<>'SELLER_VISIBLE'",
    ]) {
      if (!fileGuard.includes(requiredText)) {
        throw new Error(`文件绑定门禁缺少: ${requiredText}`);
      }
    }

    const integrity = database.prepare('PRAGMA integrity_check').all()
      .map((row) => String(row.integrity_check));
    if (integrity.length !== 1 || integrity[0] !== 'ok') {
      throw new Error('Phase 3D integrity_check 失败');
    }
    const foreignKeys = database.prepare('PRAGMA foreign_key_check').all();
    if (foreignKeys.length > 0) {
      throw new Error(`Phase 3D foreign_key_check: ${foreignKeys.length}`);
    }
  } finally {
    database.close();
  }
}

function verifyWrongPredecessorRejected(migrationFiles) {
  const database = openDatabase(
    path.join(workDirectory, 'wrong-predecessor.sqlite'),
  );
  try {
    applyFiles(database, migrationFiles.slice(0, 11));
    expectMigrationFailure(database, migrationName, 'schema11->0013');
    if (schemaVersion(database) !== 11) {
      throw new Error('失败后 schema_version 必须保持 11');
    }
    assertObjectAbsent(database, 'table', 'order_evidence_submissions');
  } finally {
    database.close();
  }
}

function verifyRepeatRejected(migrationFiles) {
  const database = openDatabase(
    path.join(workDirectory, 'repeat.sqlite'),
  );
  try {
    applyFiles(database, migrationFiles);
    expectMigrationFailure(database, migrationName, 'repeat0013@13');
    if (schemaVersion(database) !== 13) {
      throw new Error('重复 0013 后 schema_version 必须保持 13');
    }
  } finally {
    database.close();
  }
}

function expectMigrationFailure(database, name, label) {
  let failed = false;
  try {
    database.exec(readFileSync(
      path.join(migrationsDirectory, name),
      'utf8',
    ));
  } catch (error) {
    failed = true;
    if (!String(error).includes('transaction_assertion_failed')) {
      throw new Error(`${label}: 非前置断言失败: ${String(error)}`);
    }
  }
  if (!failed) throw new Error(`${label}: 应失败但成功`);
}

function assertObjectAbsent(database, type, name) {
  const row = database.prepare(`
    SELECT 1
    FROM sqlite_schema
    WHERE type=? AND name=?
  `).get(type, name);
  if (row) throw new Error(`${type} ${name} 不应残留`);
}

function verifySourceBoundary() {
  const sourceDirectory = path.join(
    root,
    'apps/api/src/order-evidence',
  );
  const source = readdirSync(sourceDirectory)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => readFileSync(
      path.join(sourceDirectory, name),
      'utf8',
    ))
    .join('\n');
  if (/consumeOrderEvidence|createFormalOrder|financialSnapshot/iu.test(source)) {
    throw new Error('Phase 3D 源码包含禁止的正式订单或消费命令');
  }
  for (const requiredExport of [
    'submitOrderEvidence',
    'requestOrderEvidenceChanges',
    'verifyOrderEvidence',
    'withdrawOrderEvidence',
    'readBuyerOrderEvidence',
    'readStaffOrderEvidence',
  ]) {
    if (!source.includes(requiredExport)) {
      throw new Error(`缺少命令或读取能力: ${requiredExport}`);
    }
  }
}
