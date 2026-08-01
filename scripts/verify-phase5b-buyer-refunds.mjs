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
const refundDirectory = path.join(root, 'apps/api/src/buyer-refunds');
const workDirectory = mkdtempSync(path.join(tmpdir(), 'ygb-phase5b-'));

const migrationFiles = readdirSync(migrationsDirectory)
  .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name))
  .sort();

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function readMigration(name) {
  return readFileSync(path.join(migrationsDirectory, name), 'utf8');
}

function openDatabase(name) {
  const database = new DatabaseSync(path.join(workDirectory, name));
  database.exec('PRAGMA foreign_keys = ON;');
  return database;
}

function apply(database, names) {
  for (const name of names) database.exec(readMigration(name));
}

function schemaVersion(database) {
  return Number(database.prepare(`
    SELECT schema_version
    FROM app_schema_state
    WHERE singleton_id=1
  `).get()?.schema_version);
}

function expectFailure(operation, expected, label) {
  let error = null;
  try {
    operation();
  } catch (caught) {
    error = caught;
  }
  if (!error || !String(error).includes(expected)) {
    throw new Error(`${label}: expected ${expected}, received ${String(error)}`);
  }
}

try {
  if (migrationFiles.length !== 17
    || migrationFiles.at(-1) !== '0017_buyer_refunds.sql') {
    throw new Error(`expected migrations 0001-0017, got ${migrationFiles.join(', ')}`);
  }

  const requiredFiles = [
    'index.ts',
    'buyer-refund-events.ts',
    'buyer-refund-records.ts',
    'buyer-refund-shared.ts',
    'ensure-buyer-refund-obligation.ts',
    'get-buyer-refund-ledger.ts',
    'record-buyer-refund-payment.ts',
    'reverse-buyer-refund-payment.ts',
    'buyer-refund-ledger.test.ts',
  ];
  const actualFiles = new Set(readdirSync(refundDirectory));
  for (const name of requiredFiles) {
    if (!actualFiles.has(name)) throw new Error(`missing buyer refund file: ${name}`);
  }

  const productionSource = requiredFiles
    .filter((name) => !name.endsWith('.test.ts'))
    .map((name) => read(`apps/api/src/buyer-refunds/${name}`))
    .join('\n');
  const ensureSource = read(
    'apps/api/src/buyer-refunds/ensure-buyer-refund-obligation.ts',
  );
  const paymentSource = read(
    'apps/api/src/buyer-refunds/record-buyer-refund-payment.ts',
  );
  const reversalSource = read(
    'apps/api/src/buyer-refunds/reverse-buyer-refund-payment.ts',
  );
  const contract = read('packages/contracts/src/buyer-refund.ts');
  const migration = read('migrations/0017_buyer_refunds.sql');

  for (const required of [
    'BUYER_REFUND_BECAME_DUE',
    'source_review_event_id',
    'expectedVersion',
    'hashCanonicalJson',
    'completeIdempotencyStatement',
    'createAuditEventStatement',
    'prepareOutboxEvent',
  ]) {
    if (!ensureSource.includes(required)) {
      throw new Error(`obligation source requirement missing: ${required}`);
    }
  }

  if (!productionSource.includes(
    'source_event.amount_cny_fen AS due_amount_cny_fen',
  )) {
    throw new Error('obligation does not copy the due-event amount directly');
  }
  if (!read('packages/contracts/src/buyer-refund.test.ts').includes(
    'AUTO_TRANSFER',
  )) {
    throw new Error('buyer refund contract boundary test is missing');
  }

  for (const forbidden of [
    'buyer_daily_exchange_rates',
    'seller_agreement_rate_versions',
    'seller_service_fee_versions',
    'resolveBuyerDailyExchangeRate',
    'resolveSellerAgreementRate',
    'resolveSellerServiceFee',
  ]) {
    if (productionSource.includes(forbidden)) {
      throw new Error(`buyer refund re-reads mutable pricing: ${forbidden}`);
    }
  }

  for (const required of [
    'createExplicitAudienceFileLinkStatements',
    "row.purpose !== 'BUYER_REFUND_PROOF'",
    "row.intent_purpose !== 'BUYER_REFUND_PROOF'",
    "row.visibility !== 'INTERNAL_ONLY'",
    "subjectType: 'STAFF_INTERNAL'",
    "permissionCode: 'BUYER_REFUND_VIEW'",
    "scope: { type: 'GLOBAL' }",
    'preparedProofs.length',
  ]) {
    if (!paymentSource.includes(required)) {
      throw new Error(`payment proof boundary missing: ${required}`);
    }
  }
  for (const forbidden of [
    "subjectType: 'BUYER'",
    "subjectType: 'SELLER_ORGANIZATION'",
    'BUYER_VISIBLE',
    'SELLER_VISIBLE',
  ]) {
    if (paymentSource.includes(forbidden)) {
      throw new Error(`payment proof exposes customer audience: ${forbidden}`);
    }
  }

  for (const required of [
    'originalPaymentEntryId',
    'BUYER_REFUND_REVERSAL_EXCEEDS_PAYMENT',
    'remaining',
    'expectedVersion',
    'hashCanonicalJson',
  ]) {
    if (!reversalSource.includes(required)) {
      throw new Error(`reversal rule missing: ${required}`);
    }
  }

  for (const status of [
    'DUE',
    'PARTIALLY_PAID',
    'PAID',
    'OVERPAID',
  ]) {
    if (!contract.includes(status) || !migration.includes(status)) {
      throw new Error(`derived refund status missing: ${status}`);
    }
  }
  for (const channel of [
    'WECHAT',
    'ALIPAY',
    'BANK_TRANSFER',
    'OTHER_MANUAL',
  ]) {
    if (!contract.includes(channel) || !migration.includes(channel)) {
      throw new Error(`manual payment channel missing: ${channel}`);
    }
  }

  for (const forbidden of [
    /registerBuyerRefundRoutes/u,
    /app\.(get|post|put|patch|delete)\s*\(/u,
    /seller.?settlement/iu,
    /profit_cny_fen/iu,
    /wechat.{0,40}(api|secret|password|auto.?pay)/iu,
    /alipay.{0,40}(api|secret|password|auto.?pay)/iu,
    /bank.{0,40}(secret|password|auto.?pay)/iu,
  ]) {
    if (forbidden.test(productionSource)) {
      throw new Error(`Phase 5B scope violation: ${String(forbidden)}`);
    }
  }

  const fresh = openDatabase('fresh.sqlite');
  try {
    apply(fresh, migrationFiles);
    if (schemaVersion(fresh) !== 17) {
      throw new Error(`fresh schema expected 17, got ${schemaVersion(fresh)}`);
    }
    const integrity = fresh.prepare('PRAGMA integrity_check').all()
      .map((row) => String(row.integrity_check));
    if (integrity.length !== 1 || integrity[0] !== 'ok') {
      throw new Error(`integrity_check failed: ${integrity.join(',')}`);
    }
    const foreignKeys = fresh.prepare('PRAGMA foreign_key_check').all();
    if (foreignKeys.length > 0) {
      throw new Error(`foreign_key_check found ${foreignKeys.length}`);
    }

    const tables = new Set(fresh.prepare(`
      SELECT name FROM sqlite_schema WHERE type='table'
    `).all().map((row) => String(row.name)));
    for (const table of [
      'buyer_refund_obligations',
      'buyer_refund_payment_entries',
      'buyer_refund_payment_entry_files',
      'buyer_refund_events',
    ]) {
      if (!tables.has(table)) throw new Error(`missing table: ${table}`);
    }
    for (const forbidden of [
      'seller_settlements',
      'internal_settlements',
      'review_profits',
      'automatic_refund_transfers',
    ]) {
      if (tables.has(forbidden)) throw new Error(`forbidden table: ${forbidden}`);
    }

    const view = fresh.prepare(`
      SELECT sql
      FROM sqlite_schema
      WHERE type='view' AND name='buyer_refund_ledger_balances'
    `).get();
    const viewColumns = new Set(fresh.prepare(`
      PRAGMA table_info(buyer_refund_ledger_balances)
    `).all().map((column) => String(column.name)));
    const viewSql = String(view?.sql ?? '')
      .replace(/\s+/gu, ' ')
      .trim()
      .toUpperCase();
    const requiredViewColumns = [
      'obligation_id',
      'due_amount_cny_fen',
      'gross_paid_cny_fen',
      'reversed_cny_fen',
      'net_paid_cny_fen',
      'status',
      'version',
    ];
    const requiredStatusBranches = [
      /THEN\s+'DUE'/u,
      /THEN\s+'PARTIALLY_PAID'/u,
      /THEN\s+'PAID'/u,
      /(?:THEN|ELSE)\s+'OVERPAID'/u,
    ];
    if (!view
      || requiredViewColumns.some((column) => !viewColumns.has(column))
      || !viewSql.includes('END AS STATUS')
      || !viewSql.includes('DUE_AMOUNT_CNY_FEN')
      || !viewSql.includes('NET_PAID_CNY_FEN')
      || requiredStatusBranches.some((pattern) => !pattern.test(viewSql))) {
      throw new Error('derived buyer refund ledger view missing or invalid');
    }

    const triggers = new Set(fresh.prepare(`
      SELECT name FROM sqlite_schema WHERE type='trigger'
    `).all().map((row) => String(row.name)));
    for (const trigger of [
      'trg_buyer_refund_obligation_source_guard',
      'trg_buyer_refund_obligation_version_guard',
      'trg_buyer_refund_obligations_no_delete',
      'trg_buyer_refund_payment_entry_source_guard',
      'trg_buyer_refund_reversal_limit_guard',
      'trg_buyer_refund_payment_entries_no_update',
      'trg_buyer_refund_payment_entries_no_delete',
      'trg_buyer_refund_payment_entry_file_guard',
      'trg_buyer_refund_payment_entry_files_no_update',
      'trg_buyer_refund_payment_entry_files_no_delete',
      'trg_buyer_refund_event_identity_guard',
      'trg_buyer_refund_events_no_update',
      'trg_buyer_refund_events_no_delete',
    ]) {
      if (!triggers.has(trigger)) throw new Error(`missing trigger: ${trigger}`);
    }

    const obligationColumns = fresh.prepare(`
      PRAGMA table_info(buyer_refund_obligations)
    `).all();
    if (obligationColumns.some((column) => column.name === 'status')) {
      throw new Error('refund status must not be writable');
    }
    const integerColumns = [
      ['buyer_refund_obligations', 'due_amount_cny_fen'],
      ['buyer_refund_payment_entries', 'amount_cny_fen'],
      ['buyer_refund_events', 'amount_cny_fen'],
      ['buyer_refund_events', 'net_paid_after_cny_fen'],
    ];
    for (const [table, column] of integerColumns) {
      const definition = fresh.prepare(`PRAGMA table_info(${table})`).all()
        .find((candidate) => candidate.name === column);
      if (String(definition?.type).toUpperCase() !== 'INTEGER') {
        throw new Error(`${table}.${column} must be INTEGER`);
      }
    }
  } finally {
    fresh.close();
  }

  const wrongOrder = openDatabase('wrong-order.sqlite');
  try {
    apply(wrongOrder, migrationFiles.slice(0, 15));
    expectFailure(
      () => wrongOrder.exec(readMigration('0017_buyer_refunds.sql')),
      'transaction_assertion_failed',
      'schema15->0017',
    );
    if (schemaVersion(wrongOrder) !== 15) {
      throw new Error('wrong-order migration changed schema version');
    }
    const residual = wrongOrder.prepare(`
      SELECT 1 FROM sqlite_schema
      WHERE type='table' AND name='buyer_refund_obligations'
    `).get();
    if (residual) throw new Error('wrong-order migration left partial DDL');
  } finally {
    wrongOrder.close();
  }

  const repeated = openDatabase('repeated.sqlite');
  try {
    apply(repeated, migrationFiles);
    expectFailure(
      () => repeated.exec(readMigration('0017_buyer_refunds.sql')),
      'transaction_assertion_failed',
      'repeat0017@17',
    );
    if (schemaVersion(repeated) !== 17) {
      throw new Error('repeat migration changed schema version');
    }
  } finally {
    repeated.close();
  }

  console.log(JSON.stringify({
    status: 'PASS',
    schema_version: 17,
    migrations: '0001-0017',
    source_amount_only: true,
    immutable_payment_entries: true,
    append_only_reversals: true,
    overpayment_preserved: true,
    derived_status: true,
    internal_only_proofs: true,
    expected_version: true,
    idempotency: true,
    audit: true,
    outbox: true,
    seller_settlement_created: false,
    profit_created: false,
    automatic_payment_created: false,
    http_route_created: false,
    wrong_order_rejected: true,
    repeat_rejected: true,
  }, null, 2));
} finally {
  rmSync(workDirectory, { recursive: true, force: true });
}
