import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const migrationPath = join(root, 'migrations/0021_order_instructions.sql');
const sql = readFileSync(migrationPath, 'utf8');
const failures = [];
const requireMatch = (name, pattern) => {
  if (!pattern.test(sql)) failures.push(name);
};
const forbid = (name, pattern) => {
  if (pattern.test(sql)) failures.push(name);
};

const migrationNames = readdirSync(join(root, 'migrations'))
  .filter((name) => /^\d{4}_.+\.sql$/u.test(name));
if (migrationNames.some((name) => Number(name.slice(0, 4)) > 21)) {
  failures.push('migration_above_0021_present');
}
requireMatch('predecessor_schema_20', /schema_version\s*=\s*20/u);
requireMatch('target_schema_21', /schema_version\s*=\s*21/u);
requireMatch('order_instructions_table', /CREATE TABLE order_instructions\s*\(/u);
requireMatch('instruction_versions_table', /CREATE TABLE order_instruction_versions\s*\(/u);
requireMatch('asset_batches_table', /CREATE TABLE order_instruction_asset_batches\s*\(/u);
requireMatch('keyword_images_table', /CREATE TABLE order_instruction_keyword_images\s*\(/u);
requireMatch('number_claims_table', /CREATE TABLE formal_order_number_claims\s*\(/u);
requireMatch('number_conflicts_table', /CREATE TABLE formal_order_number_conflicts\s*\(/u);
requireMatch('claim_database_unique', /CREATE UNIQUE INDEX\s+uq_formal_order_number_claims_active[\s\S]+marketplace_code\s*,\s*amazon_order_number_normalized[\s\S]+WHERE status IN \('PROVISIONAL','FINAL'\)/u);
requireMatch('claim_at_evidence', /evidence_submission_id TEXT NOT NULL[\s\S]+current_evidence_version_id TEXT NOT NULL/u);
requireMatch('bps_integer_check', /buyer_self_pay_bps(?:_snapshot)?\s+INTEGER[\s\S]{0,300}BETWEEN\s+0\s+AND\s+10000/u);
requireMatch('keyword_png_check', /image_mime[^,\n]*CHECK\s*\(\s*image_mime='image\/png'\s*\)/u);
requireMatch('immutable_instruction_versions', /trg_order_instruction_versions_no_update/u);
requireMatch('immutable_keyword_images', /trg_order_instruction_keyword_images_no_update/u);
requireMatch('product_image_unique_narrowed', /uq_product_image_file_object[\s\S]{0,240}entity_type='PRODUCT_VERSION'/u);
forbid('real_financial_type', /\b(?:REAL|FLOAT|DOUBLE)\b/u);
forbid('schema_22_reference', /(?:schema_version\s*=\s*22|0022_)/u);
forbid('public_work_item', /\b(?:PUBLIC|CLAIMABLE|UNASSIGNED)\b/u);
forbid('breaking_formal_order_unique_index', /CREATE UNIQUE INDEX[^;]+ON formal_orders[^;]+amazon_order_number/su);

let historical = null;
if (failures.length === 0) {
  try {
    historical = verifyHistoricalUpgrade();
  } catch (error) {
    failures.push(`historical_upgrade:${String(error)}`);
  }
}

if (failures.length > 0) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({
  ok: true,
  migration: 'migrations/0021_order_instructions.sql',
  predecessor: 20,
  target: 21,
  historical,
}, null, 2));

function verifyHistoricalUpgrade() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys=ON;');
  for (const name of migrationNames
    .filter((candidate) => Number(candidate.slice(0, 4)) <= 20)
    .sort()) {
    database.exec(readFileSync(join(root, 'migrations', name), 'utf8'));
  }
  database.exec(`
    INSERT INTO staff_users (
      id, display_name, status, authorization_version,
      version, created_at, updated_at, disabled_at
    ) VALUES ('history-staff','History Staff','ACTIVE',1,1,1000,1000,NULL);
    INSERT INTO staff_role_assignments (
      staff_id, role_code, status, assigned_by_staff_id,
      assigned_at, revoked_at, created_at, updated_at
    ) VALUES ('history-staff','owner','ACTIVE',NULL,1000,NULL,1000,1000);
    INSERT INTO staff_permission_overrides (
      staff_id, permission_code, effect, status, reason,
      assigned_by_staff_id, assigned_at, revoked_at, created_at, updated_at
    ) VALUES ('history-staff','ORDER_VIEW','DENY','ACTIVE','history deny',
      'history-staff',1000,NULL,1000,1000);

    INSERT INTO seller_organizations (
      id, marketplace_code, seller_code, origin_channel_id,
      current_channel_id, seller_sequence, organization_name, status,
      version, created_at, updated_at, activated_at, disabled_at,
      next_member_number
    ) VALUES ('history-org','JP','ido-mango-7777','seller-channel-ido-mango',
      'seller-channel-ido-mango',7777,'History Org','ACTIVE',1,
      1000,1000,1000,NULL,2);
    INSERT INTO customer_identity_subjects (id, subject_type, created_at)
    VALUES
      ('history-seller-subject','SELLER_ORG_MEMBER',1000),
      ('history-buyer-subject-1','BUYER_CUSTOMER',1000),
      ('history-buyer-subject-2','BUYER_CUSTOMER',1000),
      ('history-buyer-subject-3','BUYER_CUSTOMER',1000);
    INSERT INTO seller_organization_members (
      id, identity_subject_id, organization_id, member_number,
      username_fallback, display_name, role, primary_owner, status,
      version, created_at, updated_at, activated_at, disabled_at
    ) VALUES ('history-member','history-seller-subject','history-org',1,
      'ido-mango-7777-1','History Owner','OWNER',1,'ACTIVE',1,
      1000,1000,1000,NULL);
    INSERT INTO buyer_channels (
      id, code, name, status, next_sequence, version,
      created_at, updated_at, disabled_at
    ) VALUES ('history-channel','H','History','ACTIVE',4,1,1000,1000,NULL);
    INSERT INTO buyer_customers (
      id, identity_subject_id, marketplace_code, buyer_channel_id,
      buyer_customer_no, buyer_sequence, first_valid_order_business_date,
      display_name, access_status, identity_review_status, version,
      created_at, updated_at, activated_at, disabled_at
    ) VALUES
      ('history-buyer-1','history-buyer-subject-1','JP','history-channel',
       '20260101H1',1,'2026-01-01','History Buyer 1','ACTIVE','CLEAR',1,
       1000,1000,1000,NULL),
      ('history-buyer-2','history-buyer-subject-2','JP','history-channel',
       '20260101H2',2,'2026-01-01','History Buyer 2','ACTIVE','CLEAR',1,
       1000,1000,1000,NULL),
      ('history-buyer-3','history-buyer-subject-3','JP','history-channel',
       '20260101H3',3,'2026-01-01','History Buyer 3','ACTIVE','CLEAR',1,
       1000,1000,1000,NULL);
    INSERT INTO seller_stores (
      id, organization_id, marketplace_code, display_name,
      normalized_name, status, version, created_at, updated_at, disabled_at
    ) VALUES ('history-store','history-org','JP','History Store',
      'history store','ACTIVE',1,1000,1000,NULL);
    INSERT INTO products (
      id, organization_id, store_id, marketplace_code, asin_display,
      asin_normalized, status, current_version_no, version,
      created_at, updated_at, disabled_at
    ) VALUES ('history-product','history-org','history-store','JP',
      'B0HIST0001','B0HIST0001','ACTIVE',1,1,1000,1000,NULL);
    INSERT INTO product_versions (
      id, product_id, version_no, product_name, search_keywords_json,
      product_url, buyer_visible_notes, internal_notes,
      created_by_staff_id, created_at,
      ordering_guide_expected_amount_jpy, color_spec_mode
    ) VALUES ('history-product-v1','history-product',1,'History Product',
      '["history"]',NULL,NULL,NULL,'history-staff',1000,
      1980,'MAIN_IMAGE_VARIANT');
    INSERT INTO demand_batches (
      id, organization_id, store_id, marketplace_code, product_id,
      product_version_no, submitted_by_member_id, task_type,
      target_quantity, buyer_visible_notes, seller_notes, open_at,
      reservation_deadline, order_deadline, status, review_reason,
      close_reason, reviewed_by_staff_id, closed_by_staff_id, version,
      submitted_at, updated_at, reviewed_at, published_at,
      withdrawn_at, closed_at, held_reservation_count,
      approved_reservation_count
    ) VALUES ('history-demand','history-org','history-store','JP',
      'history-product',1,'history-member','IMAGE',3,NULL,NULL,
      1000,2000,30000,'PUBLISHED',NULL,NULL,'history-staff',NULL,2,
      1000,1500,1500,1500,NULL,NULL,0,3);
    INSERT INTO product_reservations (
      id, demand_batch_id, buyer_customer_id, organization_id, store_id,
      product_id, product_version_no, marketplace_code, status,
      precheck_snapshot_json, hold_expires_at, order_deadline_snapshot,
      version, submitted_at, updated_at, decided_by_staff_id,
      decision_reason, decided_at, cancelled_at, expired_at, reopened_count
    ) VALUES
      ('history-reservation-1','history-demand','history-buyer-1','history-org',
       'history-store','history-product',1,'JP','APPROVED','{}',2000,30000,
       2,1600,1700,'history-staff',NULL,1700,NULL,NULL,0),
      ('history-reservation-2','history-demand','history-buyer-2','history-org',
       'history-store','history-product',1,'JP','APPROVED','{}',2000,30000,
       2,1600,1700,'history-staff',NULL,1700,NULL,NULL,0),
      ('history-reservation-3','history-demand','history-buyer-3','history-org',
       'history-store','history-product',1,'JP','APPROVED','{}',2000,30000,
       2,1600,1700,'history-staff',NULL,1700,NULL,NULL,0);
    INSERT INTO order_evidence_submissions (
      id, reservation_id, buyer_customer_id, marketplace_code, status,
      current_version_no, version, public_change_reason,
      internal_review_note, submitted_at, updated_at, verified_by_staff_id,
      verified_at, withdrawn_at, consumed_at, created_at
    ) VALUES
      ('history-evidence-1','history-reservation-1','history-buyer-1','JP',
       'PENDING_VERIFICATION',1,1,NULL,NULL,1800,1800,NULL,NULL,NULL,NULL,1800),
      ('history-evidence-2','history-reservation-2','history-buyer-2','JP',
       'PENDING_VERIFICATION',1,1,NULL,NULL,1800,1800,NULL,NULL,NULL,NULL,1800),
      ('history-evidence-3','history-reservation-3','history-buyer-3','JP',
       'PENDING_VERIFICATION',1,1,NULL,NULL,1800,1800,NULL,NULL,NULL,NULL,1800);
    INSERT INTO order_evidence_versions (
      id, submission_id, reservation_id, buyer_customer_id,
      marketplace_code, version_no, amazon_order_number_raw,
      amazon_order_number_normalized, final_paid_jpy,
      submitted_by_buyer_id, buyer_note, created_at
    ) VALUES
      ('history-evidence-v1','history-evidence-1','history-reservation-1',
       'history-buyer-1','JP',1,'111-1234567-1234567',
       '111-1234567-1234567',8880,'history-buyer-1',NULL,1800),
      ('history-evidence-v2','history-evidence-2','history-reservation-2',
       'history-buyer-2','JP',1,'111-1234567-1234567',
       '111-1234567-1234567',8880,'history-buyer-2',NULL,1800),
      ('history-evidence-v3','history-evidence-3','history-reservation-3',
       'history-buyer-3','JP',1,'222-1234567-1234567',
       '222-1234567-1234567',8880,'history-buyer-3',NULL,1800);
    UPDATE order_evidence_submissions
    SET status='VERIFIED', version=2, verified_by_staff_id='history-staff',
        verified_at=1900, updated_at=1900;
    INSERT INTO formal_orders (
      id, order_evidence_submission_id, order_evidence_version_id,
      reservation_id, demand_batch_id, buyer_customer_id, buyer_customer_no,
      seller_organization_id, store_id, marketplace_code, product_id,
      product_version_id, product_version_no, asin_display, asin_normalized,
      product_name_snapshot, review_type, amazon_order_number_raw,
      amazon_order_number_normalized, final_paid_jpy, status, version,
      confirmed_by_staff_id, confirmed_at, confirmed_business_date, created_at
    ) VALUES
      ('history-formal-1','history-evidence-1','history-evidence-v1',
       'history-reservation-1','history-demand','history-buyer-1','20260101H1',
       'history-org','history-store','JP','history-product','history-product-v1',
       1,'B0HIST0001','B0HIST0001','History Product','IMAGE',
       '111-1234567-1234567','111-1234567-1234567',8880,'CONFIRMED',1,
       'history-staff',2000,'2026-01-01',2000),
      ('history-formal-2','history-evidence-2','history-evidence-v2',
       'history-reservation-2','history-demand','history-buyer-2','20260101H2',
       'history-org','history-store','JP','history-product','history-product-v1',
       1,'B0HIST0001','B0HIST0001','History Product','IMAGE',
       '111-1234567-1234567','111-1234567-1234567',8880,'CONFIRMED',1,
       'history-staff',2100,'2026-01-01',2100),
      ('history-formal-3','history-evidence-3','history-evidence-v3',
       'history-reservation-3','history-demand','history-buyer-3','20260101H3',
       'history-org','history-store','JP','history-product','history-product-v1',
       1,'B0HIST0001','B0HIST0001','History Product','IMAGE',
       '222-1234567-1234567','222-1234567-1234567',8880,'CONFIRMED',1,
       'history-staff',2200,'2026-01-01',2200);
  `);

  database.exec(sql);
  const count = (table, where = '1=1') => Number(database.prepare(
    `SELECT COUNT(*) AS value FROM ${table} WHERE ${where}`,
  ).get().value);
  const result = {
    formal_orders_preserved: count('formal_orders') === 3,
    personal_denies_preserved: count(
      'staff_permission_overrides',
      "effect='DENY' AND status='ACTIVE'",
    ) === 1,
    unique_claims_created: count('formal_order_number_claims') === 1,
    duplicate_conflicts_created: count('formal_order_number_conflicts') === 1,
    historical_evidence_marked: count(
      'order_instruction_reconciliation_markers',
      "disposition='HISTORICAL_EVIDENCE_CONTEXT'",
    ) === 3,
  };
  if (Object.values(result).some((value) => value !== true)) {
    throw new Error(JSON.stringify(result));
  }
  database.close();
  return result;
}
