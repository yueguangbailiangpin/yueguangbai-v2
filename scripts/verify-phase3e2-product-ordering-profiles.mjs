import { DatabaseSync } from 'node:sqlite';
import {
  readFileSync,
  readdirSync,
} from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const migrationsDirectory = path.join(root, 'migrations');
const migrations = readdirSync(migrationsDirectory)
  .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name))
  .sort();
const migration19 = '0019_product_ordering_profiles.sql';

if (migrations.length !== 19 || migrations.at(-1) !== migration19) {
  throw new Error('expected exactly 19 ordered migrations');
}

function openDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON;');
  return database;
}

function runMigration(database, name) {
  database.exec('BEGIN IMMEDIATE;');
  try {
    database.exec(readFileSync(
      path.join(migrationsDirectory, name),
      'utf8',
    ));
    database.exec('COMMIT;');
  } catch (error) {
    try { database.exec('ROLLBACK;'); } catch { /* no open tx */ }
    throw error;
  }
}

function applyThrough(database, count) {
  for (const migration of migrations.slice(0, count)) {
    runMigration(database, migration);
  }
}

function value(database, sql, ...bindings) {
  return database.prepare(sql).get(...bindings);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertDatabaseHealthy(database, label) {
  const integrity = database.prepare('PRAGMA integrity_check').all();
  assert(
    integrity.length === 1 && integrity[0].integrity_check === 'ok',
    `${label}: integrity_check failed`,
  );
  const foreignKeys = database.prepare('PRAGMA foreign_key_check').all();
  assert(foreignKeys.length === 0, `${label}: foreign_key_check failed`);
}

function seedSchema18History(database) {
  database.exec(`
    INSERT INTO staff_users (
      id, display_name, status, authorization_version,
      version, created_at, updated_at, disabled_at
    ) VALUES (
      'staff-phase3e2', 'Phase 3E2', 'ACTIVE', 1,
      1, 1000, 1000, NULL
    );

    INSERT INTO seller_organizations (
      id, marketplace_code, seller_code,
      origin_channel_id, current_channel_id, seller_sequence,
      organization_name, status, version,
      created_at, updated_at, activated_at, disabled_at
    ) VALUES (
      'org-phase3e2', 'JP', 'ido-phase3e2',
      'seller-channel-ido-mango', 'seller-channel-ido-mango', 9001,
      'Phase 3E2 Seller', 'ACTIVE', 1,
      1000, 1000, 1000, NULL
    );

    INSERT INTO seller_stores (
      id, organization_id, marketplace_code, display_name,
      normalized_name, status, version,
      created_at, updated_at, disabled_at
    ) VALUES (
      'store-phase3e2', 'org-phase3e2', 'JP', 'Phase 3E2 Store',
      'phase 3e2 store', 'ACTIVE', 1,
      1000, 1000, NULL
    );

    INSERT INTO products (
      id, organization_id, store_id, marketplace_code,
      asin_display, asin_normalized, status,
      current_version_no, version,
      created_at, updated_at, disabled_at
    ) VALUES (
      'product-phase3e2', 'org-phase3e2', 'store-phase3e2', 'JP',
      'B0P3E20001', 'B0P3E20001', 'ACTIVE',
      1, 1, 1000, 1000, NULL
    );

    INSERT INTO product_versions (
      id, product_id, version_no, product_name,
      search_keywords_json, product_url,
      buyer_visible_notes, internal_notes,
      created_by_staff_id, created_at
    ) VALUES (
      'product-version-phase3e2', 'product-phase3e2', 1,
      'Historical Product', '["keyword-a","keyword-a","keyword-b"]',
      'https://www.amazon.co.jp/dp/B0P3E20001',
      'buyer note', 'internal note',
      'staff-phase3e2', 1000
    );

    INSERT INTO file_upload_intents (
      id, owner_actor_type, owner_actor_id, purpose, visibility,
      status, requested_file_count, manifest_hash, version,
      expires_at, failure_code, created_at, updated_at, completed_at
    ) VALUES (
      'intent-phase3e2', 'STAFF', 'staff-phase3e2',
      'SUPPORT_ATTACHMENT', 'INTERNAL_ONLY',
      'ISSUED', 1, '${'a'.repeat(64)}', 1,
      20000, NULL, 1000, 1000, NULL
    );

    INSERT INTO file_objects (
      id, upload_intent_id, slot_no, purpose, visibility,
      object_key, client_file_name, extension, declared_mime,
      expected_byte_size, status, upload_token_hash,
      upload_expires_at, uploaded_byte_size, detected_mime,
      uploaded_sha256, failure_code, delete_attempt_count,
      next_delete_at, version, created_at, updated_at,
      uploaded_at, verified_at, deleted_at
    ) VALUES (
      'file-phase3e2', 'intent-phase3e2', 1,
      'SUPPORT_ATTACHMENT', 'INTERNAL_ONLY',
      'files/v1/2026/08/${'f'.repeat(40)}', 'support.png',
      'png', 'image/png', 128, 'RESERVED', '${'b'.repeat(64)}',
      20000, NULL, NULL, NULL, NULL, 0,
      NULL, 1, 1000, 1000, NULL, NULL, NULL
    );

    UPDATE file_upload_intents
    SET status='VERIFIED', completed_at=1100, updated_at=1100
    WHERE id='intent-phase3e2';

    UPDATE file_objects
    SET status='VERIFIED', uploaded_byte_size=128,
        detected_mime='image/png', uploaded_sha256='${'c'.repeat(64)}',
        uploaded_at=1100, verified_at=1100, updated_at=1100
    WHERE id='file-phase3e2';

    INSERT INTO file_entity_links (
      id, file_object_id, entity_type, entity_id, purpose, visibility,
      linked_by_actor_type, linked_by_actor_id, created_at,
      authorization_mode, expires_at, revoked_at
    ) VALUES (
      'link-phase3e2', 'file-phase3e2', 'SUPPORT_CASE',
      'support-case-phase3e2', 'SUPPORT_ATTACHMENT', 'INTERNAL_ONLY',
      'STAFF', 'staff-phase3e2', 1200,
      'EXPLICIT_AUDIENCES', NULL, NULL
    );

    INSERT INTO file_entity_audience_grants (
      id, file_entity_link_id, subject_type,
      buyer_customer_id, seller_organization_id,
      staff_permission_code, staff_scope_type, staff_team_id,
      granted_by_actor_type, granted_by_actor_id,
      created_at, expires_at, revoked_at
    ) VALUES (
      'grant-phase3e2', 'link-phase3e2', 'STAFF_INTERNAL',
      NULL, NULL, 'PRODUCT_VIEW', 'GLOBAL', NULL,
      'STAFF', 'staff-phase3e2', 1200, NULL, NULL
    );

    INSERT INTO file_audience_events (
      id, file_entity_link_id, grant_id, event_type,
      file_object_id, entity_type, entity_id,
      subject_type, subject_authority_id,
      actor_type, actor_id, effective_at, created_at
    ) VALUES (
      'audience-event-phase3e2', 'link-phase3e2',
      'grant-phase3e2', 'AUDIENCE_GRANT_CREATED',
      'file-phase3e2', 'SUPPORT_CASE', 'support-case-phase3e2',
      'STAFF_INTERNAL', 'PRODUCT_VIEW:GLOBAL',
      'STAFF', 'staff-phase3e2', 1200, 1200
    );

    INSERT INTO file_read_intents (
      id, file_object_id, actor_type, actor_id,
      token_hash, status, use_count, expires_at,
      created_at, updated_at, consumed_at, revoked_at,
      file_entity_link_id
    ) VALUES (
      'read-phase3e2', 'file-phase3e2', 'STAFF', 'staff-phase3e2',
      '${'d'.repeat(64)}', 'ISSUED', 0, 5000,
      1300, 1300, NULL, NULL, 'link-phase3e2'
    );

    INSERT INTO file_events (
      id, upload_intent_id, file_object_id, event_type,
      actor_type, actor_id, previous_status, next_status,
      metadata_json, idempotency_key, created_at
    ) VALUES (
      'file-event-phase3e2', 'intent-phase3e2', 'file-phase3e2',
      'FILE_OBJECT_LINKED', 'STAFF', 'staff-phase3e2',
      'VERIFIED', 'VERIFIED', '{}', 'phase3e2-file-event', 1200
    );
  `);
}

function verifyUpgrade() {
  const database = openDatabase();
  applyThrough(database, 18);
  seedSchema18History(database);
  runMigration(database, migration19);

  assert(value(database, `
    SELECT schema_version AS value FROM app_schema_state WHERE singleton_id=1
  `).value === 19, 'schema_version must be 19');

  const history = value(database, `
    SELECT search_keywords_json,
           ordering_guide_expected_amount_jpy,
           color_spec_mode
    FROM product_versions
    WHERE id='product-version-phase3e2'
  `);
  assert(
    history.search_keywords_json
      === '["keyword-a","keyword-a","keyword-b"]',
    'historical keyword order changed',
  );
  assert(
    history.ordering_guide_expected_amount_jpy === null
      && history.color_spec_mode === null,
    'historical product profile must stay nullable',
  );

  for (const [table, expected] of [
    ['file_upload_intents', 1],
    ['file_objects', 1],
    ['file_entity_links', 1],
    ['file_read_intents', 1],
    ['file_events', 1],
    ['file_entity_audience_grants', 1],
    ['file_audience_events', 1],
  ]) {
    assert(
      Number(value(database, `SELECT COUNT(*) AS value FROM ${table}`).value)
        === expected,
      `${table} history was not preserved`,
    );
  }

  const backupCount = Number(value(database, `
    SELECT COUNT(*) AS value
    FROM sqlite_schema
    WHERE name LIKE 'phase3e2_backup_%'
  `).value);
  assert(backupCount === 0, 'temporary migration backup tables remain');

  const fileSchema = database.prepare(`
    SELECT name, sql FROM sqlite_schema
    WHERE type='table' AND name IN (
      'file_upload_intents', 'file_objects',
      'file_entity_links', 'file_audience_events'
    )
  `).all().map((row) => String(row.sql)).join('\n');
  assert(fileSchema.includes('PRODUCT_IMAGE'), 'PRODUCT_IMAGE missing');
  assert(fileSchema.includes('PRODUCT_VERSION'), 'PRODUCT_VERSION missing');

  database.exec(`
    INSERT INTO product_versions (
      id, product_id, version_no, product_name,
      search_keywords_json,
      ordering_guide_expected_amount_jpy, color_spec_mode,
      product_url, buyer_visible_notes, internal_notes,
      created_by_staff_id, created_at
    ) VALUES (
      'product-version-phase3e2-v2', 'product-phase3e2', 2,
      'New Product Version', '["keyword-a","keyword-a","keyword-b"]',
      1980, 'MAIN_IMAGE_VARIANT',
      NULL, NULL, NULL, 'staff-phase3e2', 2000
    );
  `);

  const validAmountType = database.prepare(`
    SELECT typeof(ordering_guide_expected_amount_jpy) AS value_type
    FROM product_versions
    WHERE id='product-version-phase3e2-v2'
  `).get();
  assert(validAmountType?.value_type === 'integer',
    'valid amount is not stored as INTEGER');

  // SQLite applies INTEGER affinity before CHECK/trigger evaluation, so a
  // losslessly coercible SQL text literal such as '1980' becomes INTEGER.
  // JavaScript string rejection is therefore enforced in domain/service tests;
  // this database guard verifies stored type, range, and non-fractional values.
  for (const invalid of [
    'NULL',
    '-1',
    '9007199254740992',
    '1.5',
  ]) {
    let rejected = false;
    try {
      database.exec(`
        INSERT INTO product_versions (
          id, product_id, version_no, product_name,
          search_keywords_json,
          ordering_guide_expected_amount_jpy, color_spec_mode,
          product_url, buyer_visible_notes, internal_notes,
          created_by_staff_id, created_at
        ) VALUES (
          'invalid-${invalid.replace(/[^a-z0-9]/giu, '')}',
          'product-phase3e2', 99, 'Invalid', '[]',
          ${invalid}, 'ANY_VARIANT',
          NULL, NULL, NULL, 'staff-phase3e2', 3000
        );
      `);
    } catch {
      rejected = true;
    }
    assert(rejected, `invalid amount accepted: ${invalid}`);
  }

  database.exec(`
    INSERT INTO file_upload_intents (
      id, owner_actor_type, owner_actor_id, purpose, visibility,
      status, requested_file_count, manifest_hash, version,
      expires_at, failure_code, created_at, updated_at, completed_at
    ) VALUES (
      'intent-product-image', 'STAFF', 'staff-phase3e2',
      'PRODUCT_IMAGE', 'SELLER_VISIBLE',
      'ISSUED', 1, '${'e'.repeat(64)}', 1,
      10000, NULL, 4000, 4000, NULL
    );

    INSERT INTO file_objects (
      id, upload_intent_id, slot_no, purpose, visibility,
      object_key, client_file_name, extension, declared_mime,
      expected_byte_size, status, upload_token_hash,
      upload_expires_at, uploaded_byte_size, detected_mime,
      uploaded_sha256, failure_code, delete_attempt_count,
      next_delete_at, version, created_at, updated_at,
      uploaded_at, verified_at, deleted_at
    ) VALUES (
      'file-product-image', 'intent-product-image', 1,
      'PRODUCT_IMAGE', 'SELLER_VISIBLE',
      'files/v1/2026/08/${'p'.repeat(40)}', 'product.webp',
      'webp', 'image/webp', 128, 'RESERVED', '${'f'.repeat(64)}',
      10000, NULL, NULL, NULL, NULL, 0,
      NULL, 1, 4000, 4000, NULL, NULL, NULL
    );

    UPDATE file_upload_intents
    SET status='VERIFIED', completed_at=4100, updated_at=4100
    WHERE id='intent-product-image';

    UPDATE file_objects
    SET status='VERIFIED', uploaded_byte_size=128,
        detected_mime='image/webp', uploaded_sha256='${'1'.repeat(64)}',
        uploaded_at=4100, verified_at=4100, updated_at=4100
    WHERE id='file-product-image';

    INSERT INTO file_entity_links (
      id, file_object_id, entity_type, entity_id, purpose, visibility,
      linked_by_actor_type, linked_by_actor_id, created_at,
      authorization_mode, expires_at, revoked_at
    ) VALUES (
      'link-product-image', 'file-product-image', 'PRODUCT_VERSION',
      'product-version-phase3e2-v2', 'PRODUCT_IMAGE', 'SELLER_VISIBLE',
      'STAFF', 'staff-phase3e2', 4200,
      'EXPLICIT_AUDIENCES', NULL, NULL
    );

    INSERT INTO file_entity_audience_grants (
      id, file_entity_link_id, subject_type,
      buyer_customer_id, seller_organization_id,
      staff_permission_code, staff_scope_type, staff_team_id,
      granted_by_actor_type, granted_by_actor_id,
      created_at, expires_at, revoked_at
    ) VALUES (
      'grant-product-image', 'link-product-image',
      'SELLER_ORGANIZATION', NULL, 'org-phase3e2',
      NULL, NULL, NULL,
      'STAFF', 'staff-phase3e2', 4200, NULL, NULL
    );

    INSERT INTO file_entity_audience_grants (
      id, file_entity_link_id, subject_type,
      buyer_customer_id, seller_organization_id,
      staff_permission_code, staff_scope_type, staff_team_id,
      granted_by_actor_type, granted_by_actor_id,
      created_at, expires_at, revoked_at
    ) VALUES (
      'grant-product-image-staff', 'link-product-image',
      'STAFF_INTERNAL', NULL, NULL,
      'PRODUCT_VIEW', 'GLOBAL', NULL,
      'STAFF', 'staff-phase3e2', 4200, NULL, NULL
    );

    INSERT INTO product_version_main_images (
      product_version_id, file_entity_link_id,
      created_by_staff_id, created_at
    ) VALUES (
      'product-version-phase3e2-v2', 'link-product-image',
      'staff-phase3e2', 4200
    );
  `);

  const mainImageGrantCount = database.prepare(`
    SELECT COUNT(*) AS count
    FROM file_entity_audience_grants
    WHERE file_entity_link_id='link-product-image'
      AND revoked_at IS NULL
  `).get();
  assert(Number(mainImageGrantCount?.count) === 2,
    'product image must have seller and staff grants');

  for (const mutation of [
    `UPDATE product_version_main_images
     SET created_at=4300
     WHERE product_version_id='product-version-phase3e2-v2'`,
    `DELETE FROM product_version_main_images
     WHERE product_version_id='product-version-phase3e2-v2'`,
    `UPDATE file_entity_links SET revoked_at=4300
     WHERE id='link-product-image'`,
  ]) {
    let rejected = false;
    try { database.exec(mutation); } catch { rejected = true; }
    assert(rejected, 'immutable product image fact was mutated');
  }

  assertDatabaseHealthy(database, 'phase3e2 upgrade');
  database.close();
}

function verifyLateFailureRollback() {
  const database = openDatabase();
  applyThrough(database, 18);
  const source = readFileSync(
    path.join(migrationsDirectory, migration19),
    'utf8',
  );
  database.exec('BEGIN IMMEDIATE;');
  let failed = false;
  try {
    database.exec(`${source}\nSELECT * FROM phase3e2_missing_table;`);
    database.exec('COMMIT;');
  } catch {
    failed = true;
    try { database.exec('ROLLBACK;'); } catch { /* no open tx */ }
  }
  assert(failed, 'forced migration failure did not fail');
  assert(value(database, `
    SELECT schema_version AS value FROM app_schema_state WHERE singleton_id=1
  `).value === 18, 'late failure did not roll back schema_version');
  const profileColumn = value(database, `
    SELECT COUNT(*) AS value
    FROM pragma_table_info('product_versions')
    WHERE name='ordering_guide_expected_amount_jpy'
  `);
  assert(Number(profileColumn.value) === 0, 'late failure kept ALTER TABLE');
  const fileSql = String(value(database, `
    SELECT sql AS value FROM sqlite_schema
    WHERE type='table' AND name='file_objects'
  `).value);
  assert(!fileSql.includes('PRODUCT_IMAGE'), 'late failure kept file enum');
  assertDatabaseHealthy(database, 'phase3e2 rollback');
  database.close();
}

verifyUpgrade();
verifyLateFailureRollback();

console.log(JSON.stringify({
  status: 'PASS',
  migrations: 19,
  schema_version: 19,
  d1_style_transaction: true,
  historical_product_versions_preserved: true,
  historical_file_graph_preserved: true,
  partial_ddl_rollback: true,
  foreign_key_check: 'PASS',
  integrity_check: 'PASS',
}, null, 2));
