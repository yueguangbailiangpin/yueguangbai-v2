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
const workDirectory = mkdtempSync(
  path.join(tmpdir(), 'ygb-v2-phase3c2-file-audiences-'),
);
const databasePath = path.join(workDirectory, 'verification.sqlite');

try {
  const migrationFiles = readdirSync(migrationsDirectory)
    .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name))
    .sort();
  if (migrationFiles.length !== 15
    || migrationFiles.at(-1) !== '0015_file_audience_grants.sql') {
    throw new Error('正式 Migration 必须连续为 0001-0015');
  }

  const migration = readFileSync(
    path.join(migrationsDirectory, '0015_file_audience_grants.sql'),
    'utf8',
  );
  assertContains(migration, 'schema_version=14');
  assertContains(migration, 'schema_version=15');
  assertContains(migration, "DEFAULT 'LEGACY_VISIBILITY'");
  assertContains(migration, 'file_entity_audience_grants');

  const sourceText = [
    'apps/api/src/files/explicit-audience-links.ts',
    'apps/api/src/files/file-audience-authorization.ts',
    'apps/api/src/files/file-read-service.ts',
    'packages/contracts/src/file-storage.ts',
  ].map((name) => readFileSync(path.join(root, name), 'utf8')).join('\n');
  for (const forbidden of [
    "'BOTH'",
    "'CUSTOMER_VISIBLE'",
    "'PUBLIC_CUSTOMER'",
    'object_key AS url',
    'signed_url',
    'reviewPurposeOverride',
  ]) {
    if (sourceText.includes(forbidden)) {
      throw new Error(`禁止实现内容: ${forbidden}`);
    }
  }
  for (const required of [
    'authorizeExplicitAudienceRead',
    'createExplicitAudienceFileLinkStatements',
    "=== 'LEGACY_VISIBILITY'",
    "link.authorization_mode='EXPLICIT_AUDIENCES'",
    "account.status='ACTIVE'",
    "member.status='ACTIVE'",
    "organization.status='ACTIVE'",
    "staff?.status !== 'ACTIVE'",
  ]) {
    assertContains(sourceText, required);
  }

  const database = new DatabaseSync(databasePath);
  try {
    database.exec('PRAGMA foreign_keys = ON;');
    for (const file of migrationFiles) {
      database.exec(readFileSync(
        path.join(migrationsDirectory, file),
        'utf8',
      ));
    }

    const requiredTables = [
      'file_entity_audience_grants',
      'file_audience_events',
    ];
    const requiredTriggers = [
      'trg_file_audience_grant_link_guard',
      'trg_file_audience_grants_revoke_only',
      'trg_file_audience_grants_no_delete',
      'trg_explicit_file_link_revoke_only',
      'trg_file_read_intent_link_guard',
      'trg_file_audience_events_no_update',
      'trg_file_audience_events_no_delete',
    ];
    const objects = new Set(database.prepare(`
      SELECT name FROM sqlite_schema
      WHERE type IN ('table', 'trigger')
    `).all().map((row) => String(row.name)));
    for (const name of [...requiredTables, ...requiredTriggers]) {
      if (!objects.has(name)) throw new Error(`缺少数据库对象: ${name}`);
    }

    const linkColumns = new Set(database.prepare(
      'PRAGMA table_info(file_entity_links)',
    ).all().map((row) => String(row.name)));
    for (const name of [
      'authorization_mode',
      'expires_at',
      'revoked_at',
    ]) {
      if (!linkColumns.has(name)) throw new Error(`链接缺少列: ${name}`);
    }
    const readColumns = new Set(database.prepare(
      'PRAGMA table_info(file_read_intents)',
    ).all().map((row) => String(row.name)));
    if (!readColumns.has('file_entity_link_id')) {
      throw new Error('read intent 未绑定 file_entity_link_id');
    }

    seed(database);
    const legacy = database.prepare(`
      SELECT authorization_mode
      FROM file_entity_links
      WHERE id='legacy-link'
    `).get();
    if (legacy?.authorization_mode !== 'LEGACY_VISIBILITY') {
      throw new Error('旧链接未保持 LEGACY_VISIBILITY');
    }
    const legacyGrantCount = database.prepare(`
      SELECT COUNT(*) AS count
      FROM file_entity_audience_grants
      WHERE file_entity_link_id='legacy-link'
    `).get();
    if (Number(legacyGrantCount?.count) !== 0) {
      throw new Error('旧链接不得生成猜测性 grant');
    }

    expectFailure(() => database.exec(`
      INSERT INTO file_entity_audience_grants (
        id, file_entity_link_id, subject_type,
        buyer_customer_id, seller_organization_id,
        staff_permission_code, staff_scope_type, staff_team_id,
        granted_by_actor_type, granted_by_actor_id,
        created_at, expires_at, revoked_at
      ) VALUES (
        'invalid-columns', 'explicit-link', 'BUYER',
        'verify-buyer', 'verify-seller-org',
        NULL, NULL, NULL,
        'STAFF', 'verify-staff', 1500, NULL, NULL
      );
    `), 'CHECK constraint failed');

    expectFailure(() => database.exec(`
      INSERT INTO file_entity_audience_grants (
        id, file_entity_link_id, subject_type,
        buyer_customer_id, seller_organization_id,
        staff_permission_code, staff_scope_type, staff_team_id,
        granted_by_actor_type, granted_by_actor_id,
        created_at, expires_at, revoked_at
      ) VALUES (
        'duplicate-buyer', 'explicit-link', 'BUYER',
        'verify-buyer', NULL, NULL, NULL, NULL,
        'STAFF', 'verify-staff', 1500, NULL, NULL
      );
    `), 'UNIQUE constraint failed');

    database.exec(`
      UPDATE file_entity_audience_grants
      SET revoked_at=1600
      WHERE id='buyer-grant';
    `);
    const revoked = database.prepare(`
      SELECT revoked_at
      FROM file_entity_audience_grants
      WHERE id='buyer-grant'
    `).get();
    if (Number(revoked?.revoked_at) !== 1600) {
      throw new Error('grant revoke 未记录');
    }
    expectFailure(() => database.exec(`
      UPDATE file_entity_audience_grants
      SET buyer_customer_id='verify-buyer-2'
      WHERE id='buyer-grant';
    `), 'file_audience_grant_is_immutable');

    database.exec(`
      INSERT INTO file_audience_events (
        id, file_entity_link_id, grant_id, event_type,
        file_object_id, entity_type, entity_id,
        subject_type, subject_authority_id,
        actor_type, actor_id, effective_at, created_at
      ) VALUES (
        'verify-event', 'explicit-link', 'seller-grant',
        'AUDIENCE_GRANT_CREATED', 'verify-object',
        'ORDER', 'verify-order-explicit',
        'SELLER_ORGANIZATION', 'verify-seller-org',
        'STAFF', 'verify-staff', 1500, 1500
      );
    `);
    expectFailure(() => database.exec(`
      DELETE FROM file_audience_events WHERE id='verify-event';
    `), 'file_audience_events_are_immutable');

    const state = database.prepare(`
      SELECT schema_version FROM app_schema_state WHERE singleton_id=1
    `).get();
    if (Number(state?.schema_version) !== 15) {
      throw new Error(`Schema 版本错误: ${String(state?.schema_version)}`);
    }
    const integrity = database.prepare('PRAGMA integrity_check').get();
    if (String(integrity?.integrity_check) !== 'ok') {
      throw new Error('integrity_check 失败');
    }
    if (database.prepare('PRAGMA foreign_key_check').all().length !== 0) {
      throw new Error('foreign_key_check 失败');
    }

    console.log(JSON.stringify({
      status: 'PASS',
      migration: '0015_file_audience_grants.sql',
      formal_migrations: '0001-0015',
      schema_version: 15,
      legacy_visibility: 'PRESERVED',
      explicit_buyer: 'EXACT_SESSION_SUBJECT',
      explicit_seller: 'EXACT_ACTIVE_ORGANIZATION',
      staff_internal: 'ACTIVE_PERMISSION_AND_SCOPE',
      revoke: 'GRANT_AND_LINK_ENFORCED',
      immutable_events: true,
      permanent_urls: false,
      review_special_case: false,
    }, null, 2));
  } finally {
    database.close();
  }
} finally {
  rmSync(workDirectory, { recursive: true, force: true });
}

function seed(database) {
  database.exec(`
    INSERT INTO staff_users (
      id, display_name, status, authorization_version,
      version, created_at, updated_at, disabled_at
    ) VALUES (
      'verify-staff', 'Verify Staff', 'ACTIVE', 1,
      1, 1000, 1000, NULL
    );

    INSERT INTO seller_organizations (
      id, marketplace_code, seller_code,
      origin_channel_id, current_channel_id,
      seller_sequence, organization_name, status,
      version, created_at, updated_at,
      activated_at, disabled_at, next_member_number
    ) VALUES (
      'verify-seller-org', 'JP', 'ido-mango-9601',
      'seller-channel-ido-mango', 'seller-channel-ido-mango',
      9601, 'Verify Seller', 'ACTIVE', 1,
      1000, 1000, 1000, NULL, 2
    );

    INSERT INTO customer_identity_subjects (
      id, subject_type, created_at
    ) VALUES
      ('verify-buyer-subject', 'BUYER_CUSTOMER', 1000),
      ('verify-buyer-subject-2', 'BUYER_CUSTOMER', 1000);

    INSERT INTO buyer_channels (
      id, code, name, status, next_sequence, version,
      created_at, updated_at, disabled_at
    ) VALUES (
      'verify-buyer-channel', 'V', 'Verify',
      'ACTIVE', 1, 1, 1000, 1000, NULL
    );

    INSERT INTO buyer_customers (
      id, identity_subject_id, marketplace_code,
      buyer_channel_id, buyer_customer_no,
      buyer_sequence, first_valid_order_business_date,
      display_name, access_status, identity_review_status,
      version, created_at, updated_at, activated_at, disabled_at
    ) VALUES
      ('verify-buyer', 'verify-buyer-subject', 'JP',
        'verify-buyer-channel', NULL, NULL, NULL,
        'Verify Buyer', 'ACTIVE', 'CLEAR', 1,
        1000, 1000, 1000, NULL),
      ('verify-buyer-2', 'verify-buyer-subject-2', 'JP',
        'verify-buyer-channel', NULL, NULL, NULL,
        'Verify Buyer 2', 'ACTIVE', 'CLEAR', 1,
        1000, 1000, 1000, NULL);

    INSERT INTO file_upload_intents (
      id, owner_actor_type, owner_actor_id,
      purpose, visibility, status,
      requested_file_count, manifest_hash,
      version, expires_at, failure_code,
      created_at, updated_at, completed_at
    ) VALUES (
      'verify-intent', 'STAFF', 'verify-staff',
      'ORDER_EVIDENCE', 'BUYER_VISIBLE', 'ISSUED',
      1, '${'1'.repeat(64)}', 1, 3000, NULL,
      1000, 1000, NULL
    );

    INSERT INTO file_objects (
      id, upload_intent_id, slot_no,
      purpose, visibility, object_key,
      client_file_name, extension, declared_mime,
      expected_byte_size, status,
      upload_token_hash, upload_expires_at,
      uploaded_byte_size, detected_mime, uploaded_sha256,
      failure_code, delete_attempt_count, next_delete_at,
      version, created_at, updated_at,
      uploaded_at, verified_at, deleted_at
    ) VALUES (
      'verify-object', 'verify-intent', 1,
      'ORDER_EVIDENCE', 'BUYER_VISIBLE',
      'files/v1/2026/08/order-evidence/${'a'.repeat(64)}',
      'verify.png', 'png', 'image/png',
      11, 'UPLOADED', '${'2'.repeat(64)}', 3000,
      11, 'image/png', '${'3'.repeat(64)}',
      NULL, 0, NULL, 2, 1000, 1200, 1200, NULL, NULL
    );

    UPDATE file_upload_intents
    SET status='VERIFIED', version=2,
      updated_at=1300, completed_at=1300
    WHERE id='verify-intent';
    UPDATE file_objects
    SET status='VERIFIED', version=3,
      updated_at=1300, verified_at=1300
    WHERE id='verify-object';

    INSERT INTO file_entity_links (
      id, file_object_id, entity_type, entity_id,
      purpose, visibility,
      linked_by_actor_type, linked_by_actor_id, created_at
    ) VALUES (
      'legacy-link', 'verify-object', 'ORDER', 'verify-order-legacy',
      'ORDER_EVIDENCE', 'BUYER_VISIBLE',
      'STAFF', 'verify-staff', 1400
    );

    INSERT INTO file_entity_links (
      id, file_object_id, entity_type, entity_id,
      purpose, visibility,
      linked_by_actor_type, linked_by_actor_id, created_at,
      authorization_mode, expires_at, revoked_at
    ) VALUES (
      'explicit-link', 'verify-object', 'ORDER', 'verify-order-explicit',
      'ORDER_EVIDENCE', 'BUYER_VISIBLE',
      'STAFF', 'verify-staff', 1400,
      'EXPLICIT_AUDIENCES', NULL, NULL
    );

    INSERT INTO file_entity_audience_grants (
      id, file_entity_link_id, subject_type,
      buyer_customer_id, seller_organization_id,
      staff_permission_code, staff_scope_type, staff_team_id,
      granted_by_actor_type, granted_by_actor_id,
      created_at, expires_at, revoked_at
    ) VALUES
      ('buyer-grant', 'explicit-link', 'BUYER',
        'verify-buyer', NULL, NULL, NULL, NULL,
        'STAFF', 'verify-staff', 1500, NULL, NULL),
      ('seller-grant', 'explicit-link', 'SELLER_ORGANIZATION',
        NULL, 'verify-seller-org', NULL, NULL, NULL,
        'STAFF', 'verify-staff', 1500, NULL, NULL);
  `);
}

function assertContains(value, expected) {
  if (!value.includes(expected)) throw new Error(`缺少内容: ${expected}`);
}

function expectFailure(action, expectedMessage) {
  try {
    action();
  } catch (error) {
    if (String(error).includes(expectedMessage)) return;
    throw error;
  }
  throw new Error(`预期失败未发生: ${expectedMessage}`);
}
