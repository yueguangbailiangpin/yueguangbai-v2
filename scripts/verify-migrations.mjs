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
  path.join(tmpdir(), 'ygb-v2-migrations-'),
);
const databasePath = path.join(workDirectory, 'verification.sqlite');

const requiredTables = [
  'app_schema_state',
  'transaction_assertions',
  'command_idempotency_records',
  'audit_events',
  'integration_outbox',
  'staff_departments',
  'staff_teams',
  'staff_users',
  'feishu_staff_identities',
  'staff_team_memberships',
  'staff_role_assignments',
  'staff_role_consolidation_cutovers',
  'staff_role_consolidation_mappings',
  'staff_permission_overrides',
  'staff_team_leaders',
  'staff_authorization_events',
  'marketplaces',
  'customer_identity_subjects',
  'buyer_channels',
  'seller_channels',
  'buyer_customers',
  'seller_organizations',
  'seller_organization_members',
  'wechat_identity_claims',
  'customer_identity_claim_events',
  'seller_organization_channel_events',
  'buyer_number_allocation_events',
  'customer_login_accounts',
  'customer_password_credentials',
  'customer_access_events',
  'seller_stores',
  'seller_store_events',
  'seller_member_store_scopes',
  'seller_member_store_scope_events',
  'products',
  'product_versions',
  'product_version_main_images',
  'product_events',
  'seller_member_events',
  'product_applications',
  'product_application_events',
  'demand_batches',
  'demand_batch_events',
  'product_reservations',
  'reservation_events',
  'file_upload_intents',
  'file_objects',
  'file_entity_links',
  'file_read_intents',
  'file_events',
  'buyer_daily_exchange_rates',
  'buyer_daily_exchange_rate_events',
  'seller_agreement_rate_versions',
  'seller_agreement_rate_events',
  'seller_service_fee_versions',
  'seller_service_fee_events',
  'customer_login_rate_limits',
  'customer_auth_security_events',
  'buyer_preorder_number_allocations',
  'buyer_registration_rate_limits',
  'buyer_registration_attempts',
  'buyer_registration_conflicts',
  'buyer_registration_conflict_events',
  'buyer_registration_session_issuances',
  'buyer_auth_recovery_events',
  'order_evidence_submissions',
  'order_evidence_versions',
  'order_evidence_version_files',
  'order_evidence_duplicate_signals',
  'order_evidence_events',
  'formal_orders',
  'formal_order_financial_snapshots',
  'formal_order_events',
  'file_entity_audience_grants',
  'file_audience_events',
  'review_cases',
  'review_evidence_versions',
  'review_evidence_version_files',
  'review_events',
  'buyer_refund_obligations',
  'buyer_refund_payment_entries',
  'buyer_refund_payment_entry_files',
  'buyer_refund_events',
  'staff_availability',
  'staff_assignment_role_permission_defaults',
  'buyer_staff_assignments',
  'seller_staff_assignments',
  'staff_assignment_cursors',
  'staff_assignment_fallbacks',
  'staff_work_items',
  'staff_assignment_events',
  'staff_reassignment_batches',
  'staff_reassignment_batch_items',
  'staff_assignment_cursor_assertions',
  'order_instructions',
  'order_instruction_versions',
  'order_instruction_asset_batches',
  'order_instruction_asset_items',
  'order_instruction_keyword_images',
  'order_instruction_events',
  'order_instruction_expiry_scan_cursors',
  'order_instruction_reconciliation_markers',
  'order_evidence_internal_files',
  'formal_order_number_claims',
  'formal_order_number_conflicts',
  'currencies',
  'marketplace_registry',
  'marketplace_legacy_aliases',
  'buyer_marketplace_assignments',
  'seller_store_marketplaces',
  'buyer_marketplace_correction_events',
  'buyer_daily_currency_rate_versions',
  'seller_agreement_currency_rate_versions',
  'seller_service_fee_rule_versions',
  'order_evidence_marketplace_money',
  'formal_order_marketplace_money_snapshots',
  'customer_account_personas',
  'customer_buyer_invitations',
  'customer_buyer_invitation_events',
  'customer_password_reset_tokens',
  'customer_password_reset_events',
  'customer_security_rate_limits',
  'feishu_workbench_mirrors',
  'feishu_workbench_callback_receipts',
  'acquisition_role_permission_defaults',
  'acquisition_channels',
  'acquisition_channel_events',
  'acquisition_staff_channel_assignments',
  'acquisition_assignment_events',
  'acquisition_daily_consultations',
  'acquisition_daily_consultation_events',
  'acquisition_leads',
  'acquisition_lead_events',
  'acquisition_lead_links',
  'acquisition_maintenance_state',
  'acquisition_maintenance_runs',
];

const requiredTriggers = [
  'trg_acquisition_role_permission_defaults_no_update',
  'trg_acquisition_role_permission_defaults_no_delete',
  'trg_acquisition_channel_origin_guard',
  'trg_acquisition_channels_no_delete',
  'trg_acquisition_assignment_insert_guard',
  'trg_acquisition_assignment_revoke_only',
  'trg_acquisition_consultation_events_no_update',
  'trg_acquisition_consultation_events_no_delete',
  'trg_acquisition_lead_immutable_origin',
  'trg_acquisition_leads_no_delete',
  'trg_acquisition_lead_events_no_update',
  'trg_acquisition_lead_events_no_delete',
  'trg_acquisition_lead_links_no_update',
  'trg_acquisition_lead_links_no_delete',
  'trg_transaction_assertion_guard',
  'trg_transaction_assertion_cleanup',
  'trg_audit_events_no_update',
  'trg_audit_events_no_delete',
  'trg_staff_authorization_events_no_update',
  'trg_staff_authorization_events_no_delete',
  'trg_staff_role_assignments_revoke_only',
  'trg_staff_role_assignments_no_delete',
  'trg_customer_account_persona_source_guard',
  'trg_customer_account_personas_no_update',
  'trg_customer_account_personas_no_delete',
  'trg_customer_account_identity_rebind_guard',
  'trg_customer_account_identity_rebind_persona_sync',
  'trg_customer_buyer_invitation_transition_guard',
  'trg_customer_buyer_invitations_no_delete',
  'trg_customer_buyer_invitation_events_no_update',
  'trg_customer_buyer_invitation_events_no_delete',
  'trg_customer_password_reset_source_guard',
  'trg_customer_password_reset_transition_guard',
  'trg_customer_password_reset_tokens_no_delete',
  'trg_customer_password_reset_events_no_update',
  'trg_customer_password_reset_events_no_delete',
  'trg_customer_identity_claim_events_no_update',
  'trg_customer_identity_claim_events_no_delete',
  'trg_seller_channel_events_no_update',
  'trg_seller_channel_events_no_delete',
  'trg_buyer_number_events_no_update',
  'trg_buyer_number_events_no_delete',
  'trg_customer_access_events_no_update',
  'trg_customer_access_events_no_delete',
  'trg_seller_store_events_no_update',
  'trg_seller_store_events_no_delete',
  'trg_seller_scope_events_no_update',
  'trg_seller_scope_events_no_delete',
  'trg_product_versions_no_update',
  'trg_product_versions_no_delete',
  'trg_product_versions_ordering_profile_insert_guard',
  'trg_product_version_main_image_guard',
  'trg_product_version_main_images_no_update',
  'trg_product_version_main_images_no_delete',
  'trg_product_image_file_links_no_update',
  'trg_product_image_file_links_no_delete',
  'trg_product_events_no_update',
  'trg_product_events_no_delete',
  'trg_seller_member_events_no_update',
  'trg_seller_member_events_no_delete',
  'trg_product_application_events_no_update',
  'trg_product_application_events_no_delete',
  'trg_demand_batch_events_no_update',
  'trg_demand_batch_events_no_delete',
  'trg_demand_batch_capacity_guard_insert',
  'trg_demand_batch_capacity_guard_update',
  'trg_reservation_events_no_update',
  'trg_reservation_events_no_delete',
  'trg_file_objects_intent_guard',
  'trg_file_objects_verified_guard',
  'trg_file_entity_links_verified_guard',
  'trg_file_read_intents_verified_guard',
  'trg_file_events_no_update',
  'trg_file_events_no_delete',
  'trg_buyer_daily_rate_events_no_update',
  'trg_buyer_daily_rate_events_no_delete',
  'trg_seller_agreement_rate_events_no_update',
  'trg_seller_agreement_rate_events_no_delete',
  'trg_seller_service_fee_events_no_update',
  'trg_seller_service_fee_events_no_delete',
  'trg_customer_auth_security_events_no_update',
  'trg_customer_auth_security_events_no_delete',
  'trg_buyer_preorder_numbers_no_update',
  'trg_buyer_preorder_numbers_no_delete',
  'trg_buyer_registration_attempts_no_update',
  'trg_buyer_registration_attempts_no_delete',
  'trg_buyer_registration_conflicts_no_update',
  'trg_buyer_registration_conflicts_no_delete',
  'trg_buyer_registration_conflict_events_no_update',
  'trg_buyer_registration_conflict_events_no_delete',
  'trg_buyer_registration_sessions_no_update',
  'trg_buyer_registration_sessions_no_delete',
  'trg_buyer_auth_recovery_events_no_update',
  'trg_buyer_auth_recovery_events_no_delete',
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
  'trg_formal_order_source_guard',
  'trg_formal_orders_no_update',
  'trg_formal_orders_no_delete',
  'trg_formal_order_financial_snapshot_guard',
  'trg_formal_order_financial_snapshots_no_update',
  'trg_formal_order_financial_snapshots_no_delete',
  'trg_formal_order_event_identity_guard',
  'trg_formal_order_events_no_update',
  'trg_formal_order_events_no_delete',
  'trg_file_audience_grant_link_guard',
  'trg_file_audience_grants_revoke_only',
  'trg_file_audience_grants_no_delete',
  'trg_explicit_file_link_revoke_only',
  'trg_file_read_intent_link_guard',
  'trg_file_audience_events_no_update',
  'trg_file_audience_events_no_delete',
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
  'trg_buyer_staff_assignments_revoke_only',
  'trg_buyer_staff_assignments_no_delete',
  'trg_seller_staff_assignments_revoke_only',
  'trg_seller_staff_assignments_no_delete',
  'trg_staff_work_items_assignment_guard',
  'trg_staff_work_items_update_guard',
  'trg_staff_work_items_no_delete',
  'trg_staff_assignment_events_no_update',
  'trg_staff_assignment_events_no_delete',
  'trg_staff_assignment_cursor_assertion_guard',
  'trg_staff_assignment_cursor_assertion_cleanup',
  'trg_product_versions_self_pay_insert_guard',
  'trg_demand_buyer_self_pay_publish_guard_insert',
  'trg_demand_buyer_self_pay_publish_guard_update',
  'trg_demand_buyer_self_pay_published_immutable',
  'trg_reservation_self_pay_snapshot_insert_guard',
  'trg_reservation_self_pay_snapshot_immutable',
  'trg_order_instruction_reservation_guard',
  'trg_order_instruction_transition_guard',
  'trg_order_instruction_versions_no_update',
  'trg_order_instruction_versions_no_delete',
  'trg_order_instruction_keyword_images_no_update',
  'trg_order_instruction_keyword_images_no_delete',
  'trg_order_instruction_events_no_update',
  'trg_order_instruction_events_no_delete',
  'trg_order_evidence_instruction_snapshot_guard',
  'trg_formal_order_instruction_guard',
  'trg_formal_order_financial_self_pay_guard',
  'trg_formal_order_number_claim_source_guard',
  'trg_formal_order_number_claim_transition_guard',
  'trg_formal_order_number_claims_no_delete',
  'trg_buyer_customer_marketplace_default',
  'trg_seller_store_marketplace_default',
  'trg_buyer_marketplace_correction_events_no_update',
  'trg_buyer_marketplace_correction_events_no_delete',
  'trg_buyer_marketplace_assignment_fact_guard',
  'trg_buyer_daily_currency_rate_legacy_insert',
  'trg_buyer_daily_currency_rate_legacy_update',
  'trg_buyer_daily_currency_rate_update_guard',
  'trg_buyer_daily_currency_rate_no_delete',
  'trg_seller_agreement_currency_rate_legacy_insert',
  'trg_seller_agreement_currency_rate_legacy_update',
  'trg_seller_agreement_currency_rate_update_guard',
  'trg_seller_agreement_currency_rate_no_delete',
  'trg_seller_service_fee_rule_legacy_insert',
  'trg_seller_service_fee_rule_legacy_update',
  'trg_seller_service_fee_rule_update_guard',
  'trg_seller_service_fee_rule_no_delete',
  'trg_order_evidence_marketplace_money_no_update',
  'trg_order_evidence_marketplace_money_no_delete',
  'trg_order_evidence_marketplace_money_legacy_insert',
  'trg_formal_order_marketplace_money_source_guard',
  'trg_formal_order_marketplace_money_no_update',
  'trg_formal_order_marketplace_money_no_delete',
  'trg_formal_order_marketplace_money_legacy_insert',
  'trg_feishu_workbench_mirrors_insert_guard',
  'trg_feishu_workbench_mirrors_update_guard',
  'trg_feishu_workbench_mirrors_no_delete',
  'trg_feishu_workbench_callback_receipts_insert_guard',
  'trg_feishu_workbench_callback_receipts_update_guard',
  'trg_feishu_workbench_callback_receipts_no_delete',
];

try {
  const migrationFiles = readdirSync(migrationsDirectory)
    .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name))
    .sort();

  if (migrationFiles.length === 0) {
    throw new Error('未找到 Migration');
  }

  const database = new DatabaseSync(databasePath);
  try {
    database.exec('PRAGMA foreign_keys = ON;');
    for (const file of migrationFiles) {
      database.exec('BEGIN IMMEDIATE;');
      try {
        database.exec(readFileSync(
          path.join(migrationsDirectory, file),
          'utf8',
        ));
        database.exec('COMMIT;');
      } catch (error) {
        try { database.exec('ROLLBACK;'); } catch { /* no open tx */ }
        throw error;
      }
    }

    const integrity = database.prepare(
      'PRAGMA integrity_check',
    ).all().map((row) => String(row.integrity_check));
    if (integrity.length !== 1 || integrity[0] !== 'ok') {
      throw new Error(`integrity_check 失败: ${integrity.join(',')}`);
    }

    const foreignKeys = database.prepare(
      'PRAGMA foreign_key_check',
    ).all();
    if (foreignKeys.length > 0) {
      throw new Error(`foreign_key_check 发现 ${foreignKeys.length} 项`);
    }

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

    for (const table of requiredTables) {
      if (!tables.has(table)) throw new Error(`缺少表: ${table}`);
    }
    for (const trigger of requiredTriggers) {
      if (!triggers.has(trigger)) throw new Error(`缺少触发器: ${trigger}`);
    }

    const buyerRefundView = database.prepare(`
      SELECT name
      FROM sqlite_schema
      WHERE type='view' AND name='buyer_refund_ledger_balances'
    `).get();
    if (!buyerRefundView) {
      throw new Error('缺少视图: buyer_refund_ledger_balances');
    }

    const refundObligationColumns = new Set(database.prepare(`
      PRAGMA table_info(buyer_refund_obligations)
    `).all().map((column) => String(column.name)));
    if (refundObligationColumns.has('status')) {
      throw new Error('买家返款状态必须由账本推导，禁止持久化 status');
    }

    const sellerChannels = database.prepare(`
      SELECT code, prefix, next_sequence
      FROM seller_channels
      ORDER BY code
    `).all();

    const demandColumns = database.prepare(`
      PRAGMA table_info(demand_batches)
    `).all();
    for (const requiredColumn of [
      'held_reservation_count',
      'approved_reservation_count',
    ]) {
      if (!demandColumns.some(
        (column) => column.name === requiredColumn,
      )) {
        throw new Error(`demand_batches 缺少 ${requiredColumn}`);
      }
    }

    const sellerOrganizationColumns = database.prepare(`
      PRAGMA table_info(seller_organizations)
    `).all();
    if (!sellerOrganizationColumns.some(
      (column) => column.name === 'next_member_number',
    )) {
      throw new Error('seller_organizations 缺少 next_member_number');
    }
    if (sellerChannels.length !== 5
      || sellerChannels.map((row) => row.code).join(',')
        !== 'ido-mango,queshengai,ygbceping,yinghua1942,yueguangbaiai') {
      throw new Error('卖家渠道种子或编号顺序不正确');
    }

    const fileObjectColumns = database.prepare(`
      PRAGMA table_info(file_objects)
    `).all().map((column) => String(column.name));
    for (const forbiddenColumn of [
      'public_url',
      'signed_url',
      'secret',
      'upload_token',
    ]) {
      if (fileObjectColumns.includes(forbiddenColumn)) {
        throw new Error(`file_objects 禁止列: ${forbiddenColumn}`);
      }
    }

    const fileEntityLinkColumns = new Set(database.prepare(`
      PRAGMA table_info(file_entity_links)
    `).all().map((column) => String(column.name)));
    for (const requiredColumn of [
      'authorization_mode',
      'expires_at',
      'revoked_at',
    ]) {
      if (!fileEntityLinkColumns.has(requiredColumn)) {
        throw new Error(`file_entity_links 缺少 ${requiredColumn}`);
      }
    }
    const fileReadIntentColumns = new Set(database.prepare(`
      PRAGMA table_info(file_read_intents)
    `).all().map((column) => String(column.name)));
    if (!fileReadIntentColumns.has('file_entity_link_id')) {
      throw new Error('file_read_intents 缺少 file_entity_link_id');
    }

    const integerFacts = new Map([
      ['product_versions', [
        'ordering_guide_expected_amount_jpy',
        'default_buyer_self_pay_bps',
      ]],
      ['buyer_daily_exchange_rates', ['cny_per_jpy_e8']],
      ['seller_agreement_rate_versions', ['cny_per_jpy_e8']],
      ['seller_service_fee_versions', ['fee_cny_fen']],
      ['order_evidence_versions', [
        'final_paid_jpy', 'reference_order_amount_jpy_snapshot',
        'buyer_self_pay_bps_snapshot', 'buyer_self_pay_jpy',
        'buyer_refundable_principal_jpy', 'price_mismatch',
        'price_difference_jpy', 'submitted_before_deadline',
      ]],
      ['formal_orders', ['final_paid_jpy']],
      ['formal_order_financial_snapshots', [
        'buyer_cny_per_jpy_e8',
        'seller_cny_per_jpy_e8',
        'service_fee_cny_fen',
        'buyer_self_pay_bps', 'buyer_self_pay_jpy',
        'buyer_refundable_principal_jpy',
        'buyer_gross_principal_cny_fen',
        'buyer_self_pay_contribution_cny_fen',
        'buyer_expected_principal_cny_fen',
        'seller_expected_principal_cny_fen',
      ]],
      ['review_events', ['amount_cny_fen']],
      ['buyer_refund_obligations', ['due_amount_cny_fen']],
      ['buyer_refund_payment_entries', ['amount_cny_fen']],
      ['buyer_refund_events', [
        'amount_cny_fen',
        'net_paid_after_cny_fen',
      ]],
    ]);
    for (const [table, columns] of integerFacts) {
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

    const productVersionColumns = new Map(database.prepare(`
      PRAGMA table_info(product_versions)
    `).all().map((column) => [
      String(column.name),
      String(column.type).toUpperCase(),
    ]));
    if (productVersionColumns.get('ordering_guide_expected_amount_jpy')
      !== 'INTEGER') {
      throw new Error('product_versions expected JPY amount must be INTEGER');
    }
    if (!productVersionColumns.has('color_spec_mode')) {
      throw new Error('product_versions missing color_spec_mode');
    }

    const mainImageColumns = new Set(database.prepare(`
      PRAGMA table_info(product_version_main_images)
    `).all().map((column) => String(column.name)));
    for (const requiredColumn of [
      'product_version_id',
      'file_entity_link_id',
      'created_by_staff_id',
      'created_at',
    ]) {
      if (!mainImageColumns.has(requiredColumn)) {
        throw new Error(`product_version_main_images missing ${requiredColumn}`);
      }
    }

    const fileSql = database.prepare(`
      SELECT sql FROM sqlite_schema
      WHERE type='table' AND name IN (
        'file_upload_intents', 'file_objects',
        'file_entity_links', 'file_audience_events'
      )
      ORDER BY name
    `).all().map((row) => String(row.sql)).join('\n');
    for (const requiredValue of [
      'PRODUCT_IMAGE', 'PRODUCT_VERSION',
      'ORDER_INSTRUCTION_KEYWORD_IMAGE',
      'ORDER_INSTRUCTION_VERSION',
      'ORDER_EVIDENCE_INTERNAL_COMMUNICATION',
      'ORDER_EVIDENCE_SUBMISSION',
    ]) {
      if (!fileSql.includes(requiredValue)) {
        throw new Error(`file schema missing ${requiredValue}`);
      }
    }

    const orderEvidenceColumns = new Set(database.prepare(`
      PRAGMA table_info(order_evidence_versions)
    `).all().map((column) => String(column.name)));
    for (const forbiddenColumn of [
      'buyer_number',
      'business_order_number',
      'buyer_rate_snapshot',
      'seller_rate_snapshot',
      'service_fee_snapshot',
      'profit_cny_fen',
      'refund_amount',
      'settlement_amount',
    ]) {
      if (orderEvidenceColumns.has(forbiddenColumn)) {
        throw new Error(`order_evidence_versions 禁止列: ${forbiddenColumn}`);
      }
    }


    const formalOrderColumns = new Set(database.prepare(`
      PRAGMA table_info(formal_orders)
    `).all().map((column) => String(column.name)));
    const formalSnapshotColumns = new Set(database.prepare(`
      PRAGMA table_info(formal_order_financial_snapshots)
    `).all().map((column) => String(column.name)));
    for (const forbiddenColumn of [
      'review_status',
      'refund_status',
      'settlement_status',
      'profit_cny_fen',
      'realized_profit_cny_fen',
    ]) {
      if (formalOrderColumns.has(forbiddenColumn)
        || formalSnapshotColumns.has(forbiddenColumn)) {
        throw new Error(`Phase 3F 禁止字段: ${forbiddenColumn}`);
      }
    }

    const forbiddenPhase5Tables = database.prepare(`
      SELECT name
      FROM sqlite_schema
      WHERE type='table'
        AND name IN (
          'buyer_refunds',
          'seller_settlements',
          'internal_settlements',
          'review_profits',
          'amazon_accounts',
          'amazon_review_automation'
        )
    `).all();
    if (forbiddenPhase5Tables.length > 0) {
      throw new Error('禁止旧式返款覆盖表、卖家结算、利润或 Amazon 自动化表');
    }

    const uniqueAmazonOrderIndex = database.prepare(`
      SELECT name
      FROM sqlite_schema
      WHERE type='index'
        AND tbl_name='formal_orders'
        AND sql IS NOT NULL
        AND upper(sql) LIKE '%UNIQUE%'
        AND sql LIKE '%amazon_order_number_normalized%'
    `).all();
    if (uniqueAmazonOrderIndex.length > 0) {
      throw new Error('Amazon订单号不得设置全局唯一');
    }

    const rateLimitColumns = new Set(database.prepare(
      'PRAGMA table_info(customer_login_rate_limits)',
    ).all().map((column) => String(column.name)));
    for (const requiredColumn of [
      'scope_type',
      'scope_hash',
      'window_expires_at',
    ]) {
      if (!rateLimitColumns.has(requiredColumn)) {
        throw new Error(
          `customer_login_rate_limits 缺少 ${requiredColumn}`,
        );
      }
    }

    const state = database.prepare(`
      SELECT schema_version
      FROM app_schema_state
      WHERE singleton_id=1
    `).get();
    if (Number(state?.schema_version) !== migrationFiles.length) {
      throw new Error(
        `Schema 版本 ${String(state?.schema_version)} 与 Migration 数量 `
        + `${migrationFiles.length} 不一致`,
      );
    }

    console.log(JSON.stringify({
      status: 'PASS',
      migrations: migrationFiles,
      table_count: tables.size,
      trigger_count: triggers.size,
      integrity_check: 'ok',
      foreign_key_errors: 0,
      schema_version: Number(state.schema_version),
      seller_channels: sellerChannels,
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
