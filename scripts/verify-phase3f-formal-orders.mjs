import { DatabaseSync } from 'node:sqlite';
import {
  readFileSync,
  readdirSync,
} from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const migrationsDirectory = path.join(root, 'migrations');
const migrationFiles = readdirSync(migrationsDirectory)
  .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name))
  .sort();
const expectedLastMigration = '0014_formal_orders.sql';

if (migrationFiles.length !== 14
  || migrationFiles.at(-1) !== expectedLastMigration) {
  throw new Error(
    `Phase 3F requires exactly 0001-0014; got ${migrationFiles.join(', ')}`,
  );
}

function readMigration(name) {
  return readFileSync(path.join(migrationsDirectory, name), 'utf8');
}

function openDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON;');
  return database;
}

function applyFiles(database, names) {
  for (const name of names) database.exec(readMigration(name));
}

function schemaVersion(database) {
  return Number(database.prepare(`
    SELECT schema_version
    FROM app_schema_state
    WHERE singleton_id=1
  `).get()?.schema_version);
}

function expectGuardFailure(database, label) {
  let failed = false;
  try {
    database.exec(readMigration(expectedLastMigration));
  } catch (error) {
    failed = true;
    if (!String(error).includes('transaction_assertion_failed')) {
      throw new Error(`${label}: unexpected failure: ${String(error)}`);
    }
  }
  if (!failed) throw new Error(`${label}: migration should have failed`);
}

function assertIntegrity(database, label) {
  const integrity = database.prepare('PRAGMA integrity_check').all()
    .map((row) => String(row.integrity_check));
  if (integrity.length !== 1 || integrity[0] !== 'ok') {
    throw new Error(`${label}: integrity_check failed`);
  }
  const foreignKeys = database.prepare('PRAGMA foreign_key_check').all();
  if (foreignKeys.length > 0) {
    throw new Error(`${label}: foreign_key_check=${foreignKeys.length}`);
  }
}

function schemaObjects(database, type) {
  return new Set(database.prepare(`
    SELECT name
    FROM sqlite_schema
    WHERE type=?
  `).all(type).map((row) => String(row.name)));
}

function tableColumns(database, table) {
  return new Map(database.prepare(`PRAGMA table_info(${table})`).all()
    .map((column) => [
      String(column.name),
      String(column.type).toUpperCase(),
    ]));
}

// Fresh database and structural invariants.
{
  const database = openDatabase();
  applyFiles(database, migrationFiles);
  if (schemaVersion(database) !== 14) {
    throw new Error(`fresh schema must be 14; got ${schemaVersion(database)}`);
  }
  assertIntegrity(database, 'fresh');

  const tables = schemaObjects(database, 'table');
  const triggers = schemaObjects(database, 'trigger');
  for (const table of [
    'formal_orders',
    'formal_order_financial_snapshots',
    'formal_order_events',
  ]) {
    if (!tables.has(table)) throw new Error(`missing table ${table}`);
  }
  for (const trigger of [
    'trg_formal_order_source_guard',
    'trg_formal_orders_no_update',
    'trg_formal_orders_no_delete',
    'trg_formal_order_financial_snapshot_guard',
    'trg_formal_order_financial_snapshots_no_update',
    'trg_formal_order_financial_snapshots_no_delete',
    'trg_formal_order_event_identity_guard',
    'trg_formal_order_events_no_update',
    'trg_formal_order_events_no_delete',
  ]) {
    if (!triggers.has(trigger)) throw new Error(`missing trigger ${trigger}`);
  }

  const formalOrderColumns = tableColumns(database, 'formal_orders');
  const snapshotColumns = tableColumns(
    database,
    'formal_order_financial_snapshots',
  );
  for (const column of ['final_paid_jpy']) {
    if (formalOrderColumns.get(column) !== 'INTEGER') {
      throw new Error(`formal_orders.${column} must be INTEGER`);
    }
  }
  for (const column of [
    'buyer_cny_per_jpy_e8',
    'seller_cny_per_jpy_e8',
    'service_fee_cny_fen',
    'buyer_expected_principal_cny_fen',
    'seller_expected_principal_cny_fen',
  ]) {
    if (snapshotColumns.get(column) !== 'INTEGER') {
      throw new Error(
        `formal_order_financial_snapshots.${column} must be INTEGER`,
      );
    }
  }

  const forbiddenFacts = [
    'profit_cny_fen',
    'realized_profit_cny_fen',
    'buyer_refund_status',
    'buyer_refund_amount_cny_fen',
    'seller_settlement_status',
    'seller_settlement_amount_cny_fen',
    'review_status',
  ];
  for (const column of forbiddenFacts) {
    if (formalOrderColumns.has(column) || snapshotColumns.has(column)) {
      throw new Error(`Phase 3F forbidden fact: ${column}`);
    }
  }

  const amazonUniqueIndexes = database.prepare(`
    SELECT name, sql
    FROM sqlite_schema
    WHERE type='index'
      AND tbl_name='formal_orders'
      AND sql IS NOT NULL
      AND upper(sql) LIKE '%UNIQUE%'
      AND sql LIKE '%amazon_order_number_normalized%'
  `).all();
  if (amazonUniqueIndexes.length > 0) {
    throw new Error('Amazon order number must not be globally unique');
  }

  const uniqueSources = database.prepare(`
    SELECT sql
    FROM sqlite_schema
    WHERE type='table' AND name='formal_orders'
  `).get();
  const formalOrderSql = String(uniqueSources?.sql ?? '');
  if (!formalOrderSql.includes('order_evidence_submission_id TEXT NOT NULL UNIQUE')
    || !formalOrderSql.includes('reservation_id TEXT NOT NULL UNIQUE')) {
    throw new Error('formal order source uniqueness is missing');
  }
  database.close();
}

// Wrong predecessor: schema 12 -> 0014 must fail without partial DDL.
{
  const database = openDatabase();
  applyFiles(database, migrationFiles.slice(0, 12));
  expectGuardFailure(database, 'schema12->0014');
  if (schemaVersion(database) !== 12) {
    throw new Error('schema12->0014 changed schema version');
  }
  const residue = database.prepare(`
    SELECT 1
    FROM sqlite_schema
    WHERE name='formal_orders'
  `).get();
  if (residue) throw new Error('schema12->0014 left partial DDL');
  assertIntegrity(database, 'schema12->0014');
  database.close();
}

// Correct upgrade and repeated execution rejection.
{
  const database = openDatabase();
  applyFiles(database, migrationFiles.slice(0, 13));
  if (schemaVersion(database) !== 13) throw new Error('upgrade base is not 13');
  database.exec(readMigration(expectedLastMigration));
  if (schemaVersion(database) !== 14) throw new Error('upgrade did not reach 14');
  expectGuardFailure(database, 'repeat0014@14');
  if (schemaVersion(database) !== 14) {
    throw new Error('repeat0014 changed schema version');
  }
  assertIntegrity(database, 'repeat0014@14');
  database.close();
}

const implementationFiles = [
  path.join(root, 'apps/api/src/formal-orders/confirm-formal-order.ts'),
  path.join(root, 'migrations/0014_formal_orders.sql'),
];
const implementation = implementationFiles
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');
for (const forbidden of [
  'REAL',
  'parseFloat(',
  'profit_cny_fen',
  'realized_profit',
  'refund_completed',
  'settlement_completed',
]) {
  if (implementation.includes(forbidden)) {
    throw new Error(`forbidden implementation token: ${forbidden}`);
  }
}
for (const required of [
  "convertJpyToCnyFen(",
  "'HALF_UP'",
  'resolveBuyerDailyExchangeRate(',
  'resolveSellerAgreementRate(',
  'resolveSellerServiceFee(',
  "status='CONSUMED'",
]) {
  if (!implementation.includes(required)) {
    throw new Error(`required implementation token missing: ${required}`);
  }
}

console.log(JSON.stringify({
  status: 'PASS',
  migrations: '0001-0014 continuous',
  schema_version: 14,
  wrong_predecessor_rejected: true,
  repeat_0014_rejected: true,
  no_partial_ddl: true,
  immutable_tables: [
    'formal_orders',
    'formal_order_financial_snapshots',
    'formal_order_events',
  ],
  amazon_order_number_global_unique: false,
  fixed_point_rounding: 'HALF_UP',
  forbidden_phase_facts: 'absent',
}, null, 2));
