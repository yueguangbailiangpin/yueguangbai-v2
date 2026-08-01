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
const reviewsDirectory = path.join(root, 'apps/api/src/reviews');
const workDirectory = mkdtempSync(path.join(tmpdir(), 'ygb-phase5a-'));

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
  const row = database.prepare(`
    SELECT schema_version
    FROM app_schema_state
    WHERE singleton_id=1
  `).get();
  return Number(row?.schema_version);
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

  const requiredReviewFiles = [
    'index.ts',
    'review-events.ts',
    'review-records.ts',
    'review-shared.ts',
    'submit-review-evidence.ts',
    'decide-review.ts',
    'withdraw-review.ts',
    'review-workflow.test.ts',
  ];
  const actualReviewFiles = new Set(readdirSync(reviewsDirectory));
  for (const name of requiredReviewFiles) {
    if (!actualReviewFiles.has(name)) throw new Error(`missing reviews file: ${name}`);
  }

  const productionSource = requiredReviewFiles
    .filter((name) => !name.endsWith('.test.ts'))
    .map((name) => read(`apps/api/src/reviews/${name}`))
    .join('\n');
  const submitSource = read(
    'apps/api/src/reviews/submit-review-evidence.ts',
  );
  const decisionSource = read('apps/api/src/reviews/decide-review.ts');
  const explicitAudienceApiSource = read(
    'apps/api/src/files/explicit-audience-links.ts',
  );
  const migration = read('migrations/0016_review_workflow.sql');
  const contract = read('packages/contracts/src/review.ts');

  const submitIntegrationRequirements = [
    [
      /createExplicitAudienceFileLinkStatements\s*\(/u,
      'createExplicitAudienceFileLinkStatements call',
    ],
    [
      /row\.purpose\s*!==\s*['"]REVIEW_EVIDENCE['"]/u,
      'file object REVIEW_EVIDENCE purpose validation',
    ],
    [
      /row\.intent_purpose\s*!==\s*['"]REVIEW_EVIDENCE['"]/u,
      'upload intent REVIEW_EVIDENCE purpose validation',
    ],
    [/subjectType:\s*['"]BUYER['"]/u, 'buyer audience grant'],
    [
      /subjectType:\s*['"]SELLER_ORGANIZATION['"]/u,
      'seller organization audience grant',
    ],
    [
      /permissionCode:\s*['"]REVIEW_VIEW['"]/u,
      'staff REVIEW_VIEW audience grant',
    ],
  ];
  for (const [pattern, label] of submitIntegrationRequirements) {
    if (!pattern.test(submitSource)) {
      throw new Error(`review file integration missing: ${label}`);
    }
  }
  for (const required of [
    "authorizationMode: 'EXPLICIT_AUDIENCES'",
    "'EXPLICIT_AUDIENCES'",
    'INSERT INTO file_entity_audience_grants',
  ]) {
    if (!explicitAudienceApiSource.includes(required)) {
      throw new Error(`explicit audience file API missing: ${required}`);
    }
  }
  for (const forbidden of [
    'INSERT INTO file_entity_links',
    'INSERT INTO file_entity_audience_grants',
    "authorizationMode: 'LEGACY_VISIBILITY'",
    "authorizationMode: 'BOTH'",
  ]) {
    if (productionSource.includes(forbidden)) {
      throw new Error(`review production source bypasses file API: ${forbidden}`);
    }
  }
  for (const forbidden of [
    'resolveBuyerDailyExchangeRate',
    'resolveSellerAgreementRate',
    'resolveSellerServiceFee',
    'buyer_daily_exchange_rates',
    'seller_agreement_rate_versions',
    'seller_service_fee_versions',
  ]) {
    if (decisionSource.includes(forbidden)) {
      throw new Error(`approval re-reads current pricing: ${forbidden}`);
    }
  }
  for (const required of [
    'buyer_expected_principal_cny_fen',
    'service_fee_cny_fen',
    'BUYER_REFUND_BECAME_DUE',
    'SELLER_SERVICE_FEE_ACCRUED',
    'creates_actual_payment: false',
  ]) {
    if (!decisionSource.includes(required)) {
      throw new Error(`approval financial fact missing: ${required}`);
    }
  }
  for (const required of [
    'PENDING_REVIEW',
    'CHANGES_REQUESTED',
    'REJECTED',
    'WITHDRAWN',
    'APPROVED',
  ]) {
    if (!contract.includes(required) || !migration.includes(required)) {
      throw new Error(`review state missing: ${required}`);
    }
  }
  if (/amazon.{0,40}(login|scrap|crawl|auto.?approve|auto.?review|evasion)/iu
    .test(productionSource)) {
    throw new Error('Amazon automation is forbidden in Phase 5A');
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
      'review_cases',
      'review_evidence_versions',
      'review_evidence_version_files',
      'review_events',
    ]) {
      if (!tables.has(table)) throw new Error(`missing table: ${table}`);
    }
    for (const forbidden of [
      'buyer_refunds',
      'seller_settlements',
      'internal_settlements',
      'review_profits',
      'amazon_accounts',
      'amazon_review_automation',
    ]) {
      if (tables.has(forbidden)) throw new Error(`forbidden table: ${forbidden}`);
    }

    const triggers = new Set(fresh.prepare(`
      SELECT name FROM sqlite_schema WHERE type='trigger'
    `).all().map((row) => String(row.name)));
    for (const trigger of [
      'trg_review_case_source_guard',
      'trg_review_case_transition_guard',
      'trg_review_cases_no_delete',
      'trg_review_evidence_version_guard',
      'trg_review_evidence_versions_no_update',
      'trg_review_evidence_versions_no_delete',
      'trg_review_evidence_version_file_guard',
      'trg_review_evidence_version_files_no_update',
      'trg_review_evidence_version_files_no_delete',
      'trg_review_event_identity_guard',
      'trg_review_events_no_update',
      'trg_review_events_no_delete',
    ]) {
      if (!triggers.has(trigger)) throw new Error(`missing trigger: ${trigger}`);
    }

    const amountColumn = fresh.prepare(`
      PRAGMA table_info(review_events)
    `).all().find((column) => column.name === 'amount_cny_fen');
    if (String(amountColumn?.type).toUpperCase() !== 'INTEGER') {
      throw new Error('review_events.amount_cny_fen must be INTEGER');
    }
    const approvalIndex = fresh.prepare(`
      SELECT sql
      FROM sqlite_schema
      WHERE type='index' AND name='uq_review_approval_events_once'
    `).get();
    if (!String(approvalIndex?.sql).includes('UNIQUE INDEX')) {
      throw new Error('approval events must have a unique partial index');
    }
  } finally {
    fresh.close();
  }

  const wrongOrder = openDatabase('wrong-order.sqlite');
  try {
    apply(wrongOrder, migrationFiles.slice(0, 14));
    expectFailure(
      () => wrongOrder.exec(readMigration('0016_review_workflow.sql')),
      'transaction_assertion_failed',
      'schema14->0016',
    );
    if (schemaVersion(wrongOrder) !== 14) {
      throw new Error('wrong-order migration changed schema version');
    }
    const residual = wrongOrder.prepare(`
      SELECT 1 FROM sqlite_schema
      WHERE type='table' AND name='review_cases'
    `).get();
    if (residual) throw new Error('wrong-order migration left partial DDL');
  } finally {
    wrongOrder.close();
  }

  const repeated = openDatabase('repeated.sqlite');
  try {
    apply(repeated, migrationFiles);
    expectFailure(
      () => repeated.exec(readMigration('0016_review_workflow.sql')),
      'transaction_assertion_failed',
      'repeat0016@16',
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
    explicit_file_audiences: true,
    exact_buyer_seller_staff_grants: true,
    approval_events_once: true,
    snapshot_amounts_only: true,
    actual_payment_created: false,
    actual_settlement_created: false,
    profit_created: false,
    amazon_automation_created: false,
    wrong_order_rejected: true,
    repeat_rejected: true,
  }, null, 2));
} finally {
  rmSync(workDirectory, { recursive: true, force: true });
}
