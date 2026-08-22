import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { verifyHistoricalMigrationImmutability } from './historical-migration-immutability.mjs';

const root = path.resolve(import.meta.dirname, '..');
const migrationsDirectory = path.join(root, 'migrations');
const workDirectory = mkdtempSync(path.join(tmpdir(), 'ygb-v2-migrations-'));
const databasePath = path.join(workDirectory, 'verification.sqlite');
const expectedLatestSchema = 72;
const expectedLastMigration = '0072_unified_order_day_rate_center.sql';
const expectedSchemaInventory = {
  table: 212,
  index: 604,
  trigger: 401,
  view: 12,
  sha256: '1088a453225ac1b8ff8941feb537b6df052930b27fbfd592f14e17cea0c01a65',
};

function sqlCodeOnly(source) {
  let result = '';
  let index = 0;
  while (index < source.length) {
    const current = source[index];
    const next = source[index + 1];
    if (current === '-' && next === '-') {
      index += 2;
      while (index < source.length && source[index] !== '\n') index += 1;
      result += '\n';
      index += 1;
      continue;
    }
    if (current === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        if (source[index] === '\n') result += '\n';
        index += 1;
      }
      index += 2;
      continue;
    }
    if (current === "'" || current === '"') {
      const quote = current;
      result += ' ';
      index += 1;
      while (index < source.length) {
        if (source[index] === quote && source[index + 1] === quote) {
          index += 2;
          continue;
        }
        if (source[index] === quote) {
          index += 1;
          break;
        }
        if (source[index] === '\n') result += '\n';
        index += 1;
      }
      result += ' ';
      continue;
    }
    result += current;
    index += 1;
  }
  return result;
}

function containsIncompatibleTriggerRaise(source) {
  return /SELECT\s+CASE\s+WHEN[\s\S]*?THEN\s+RAISE\s*\(/iu.test(sqlCodeOnly(source));
}

const longTriggerProbe = `SELECT CASE WHEN ${'condition AND '.repeat(80)}true
THEN RAISE(ABORT, 'blocked') END;`;
if (
  !containsIncompatibleTriggerRaise(longTriggerProbe) ||
  containsIncompatibleTriggerRaise(`
    -- SELECT CASE WHEN true THEN RAISE(ABORT, 'comment') END;
    SELECT 'SELECT CASE WHEN true THEN RAISE(ABORT, ''string'') END';
  `)
) {
  throw new Error('D1 trigger compatibility detector self-check failed');
}

const requiredTables = [
  'app_schema_state',
  'transaction_assertions',
  'command_idempotency_records',
  'audit_events',
  'integration_outbox',
  'staff_departments',
  'staff_teams',
  'staff_users',
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
  'seller_service_fee_rule_versions',
  'order_evidence_marketplace_money',
  'formal_order_marketplace_money_snapshots',
  'customer_account_personas',
  'customer_buyer_invitations',
  'customer_buyer_invitation_events',
  'customer_password_reset_tokens',
  'customer_password_reset_events',
  'customer_security_rate_limits',
  'seller_principal_rate_policy_versions',
  'seller_principal_rate_policy_events',
  'seller_principal_rate_snapshots',
  'marketplace_registry_legacy_0029',
  'platform_product_identities',
  'platform_order_identities',
  'platform_identity_events',
  'platform_order_evidence_records',
  'platform_formal_orders',
  'platform_order_evidence_internal_files',
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
  'staff_email_identities',
  'staff_marketplace_scopes',
  'acquisition_channel_privacy_profiles',
  'acquisition_prospects',
  'acquisition_prospect_signals',
  'acquisition_customer_attributions',
  'customer_seller_invitations',
  'customer_seller_invitation_events',
  'customer_buyer_invitation_lead_links',
  'acquisition_customer_intake_facts',
  'acquisition_reporting_config',
  'acquisition_historical_source_exemptions',
  'customer_identity_resolution_cases',
  'customer_identity_resolution_events',
  'customer_identity_manual_bindings',
  'acquisition_lead_source_corrections',
  'seller_customer_groups',
  'seller_customer_group_marketplaces',
  'formal_order_operational_events',
  'review_visibility_observations',
  'formal_order_financial_adjustments',
  'buyer_advance_principal_entries',
  'buyer_advance_principal_settlements',
  'seller_member_invitations',
  'seller_member_invitation_events',
  'customer_login_identifier_change_events',
  'acquisition_machine_credentials',
  'acquisition_machine_marketplaces',
  'acquisition_machine_channels',
  'acquisition_machine_rate_buckets',
  'production_recovery_attestations',
  'seller_member_portal_store_grants',
  'buyer_advance_principal_entry_files',
  'buyer_advance_principal_overpayments',
  'marketplace_runtime_config',
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
  'trg_platform_product_identity_scope_guard',
  'trg_platform_product_identity_no_key_update',
  'trg_platform_product_identities_no_delete',
  'trg_platform_order_identity_scope_guard',
  'trg_platform_order_identity_product_guard',
  'trg_platform_order_identity_no_key_update',
  'trg_platform_order_identities_no_delete',
  'trg_platform_identity_event_target_guard',
  'trg_platform_identity_events_no_update',
  'trg_platform_identity_events_no_delete',
  'trg_marketplace_registry_legacy_0029_no_insert',
  'trg_marketplace_registry_legacy_0029_no_update',
  'trg_marketplace_registry_legacy_0029_no_delete',
  'trg_platform_order_evidence_scope_guard',
  'trg_platform_order_evidence_no_update',
  'trg_platform_order_evidence_no_delete',
  'trg_platform_formal_order_source_guard',
  'trg_platform_formal_orders_no_update',
  'trg_platform_formal_orders_no_delete',
  'trg_formal_orders_platform_id_collision_guard',
  'trg_platform_order_evidence_internal_files_guard',
  'trg_platform_order_evidence_internal_files_no_update',
  'trg_platform_order_evidence_internal_files_no_delete',
  'trg_order_evidence_internal_files_platform_collision_guard',
  'trg_seller_principal_rate_policy_initial_state_guard',
  'trg_seller_principal_rate_policy_decision_guard',
  'trg_seller_principal_rate_policy_no_delete',
  'trg_seller_principal_rate_policy_event_source_guard',
  'trg_seller_principal_rate_policy_event_no_update',
  'trg_seller_principal_rate_policy_event_no_delete',
  'trg_seller_principal_rate_snapshot_guard',
  'trg_seller_principal_rate_snapshots_no_update',
  'trg_seller_principal_rate_snapshots_no_delete',
  'trg_seller_principal_rate_policy_future_effective_guard',
  'trg_seller_principal_rate_policy_event_fidelity_guard',
  'trg_seller_principal_rate_snapshot_confirmation_guard',
  'trg_staff_work_item_marketplace_after_insert',
  'trg_acquisition_lead_prospect_guard',
  'trg_acquisition_lead_prospect_insert_guard',
  'trg_acquisition_lead_prospect_source_update_guard',
  'trg_acquisition_channel_privacy_profile_scope_guard',
  'trg_acquisition_channel_privacy_profile_after_insert',
  'trg_buyer_invitation_consumed_link_acquisition_lead',
  'trg_acquisition_intake_fact_after_lead',
  'trg_acquisition_intake_facts_no_update',
  'trg_acquisition_intake_facts_no_delete',
  'trg_acquisition_reporting_precision_immutable',
  'trg_acquisition_historical_exemptions_no_update',
  'trg_acquisition_historical_exemptions_no_delete',
  'trg_customer_identity_resolution_events_no_update',
  'trg_customer_identity_resolution_events_no_delete',
  'trg_acquisition_source_correction_guard',
  'trg_acquisition_source_corrections_no_update',
  'trg_acquisition_source_corrections_no_delete',
  'trg_acquisition_channel_no_new_both',
  'trg_acquisition_channel_staff_label_immutable',
  'trg_seller_customer_group_after_org',
  'trg_review_visibility_requires_approved_review',
  'trg_review_visibility_observations_no_update',
  'trg_review_visibility_observations_no_delete',
  'trg_formal_order_operational_events_no_update',
  'trg_formal_order_operational_events_no_delete',
  'trg_formal_order_financial_adjustment_event_guard',
  'trg_formal_order_financial_adjustment_profit_only',
  'trg_formal_order_financial_adjustments_no_update',
  'trg_formal_order_financial_adjustments_no_delete',
  'trg_buyer_advance_principal_entries_no_update',
  'trg_buyer_advance_principal_entries_no_delete',
  'trg_advance_principal_reversal_source_guard',
  'trg_advance_principal_full_payment_amount_guard',
  'trg_advance_principal_single_outstanding_payment_guard',
  'trg_advance_principal_full_reversal_guard',
  'trg_buyer_advance_principal_settlements_no_update',
  'trg_buyer_advance_principal_settlements_no_delete',
  'trg_acquisition_lead_link_first_touch_attribution',
  'trg_seller_member_invitation_events_no_update',
  'trg_seller_member_invitation_events_no_delete',
  'trg_customer_login_identifier_change_events_no_update',
  'trg_customer_login_identifier_change_events_no_delete',
  'trg_acquisition_machine_scope_no_update',
  'trg_acquisition_machine_scope_no_delete',
  'trg_acquisition_machine_channel_scope_guard',
  'trg_acquisition_machine_channel_no_update',
  'trg_acquisition_machine_channel_no_delete',
  'trg_production_recovery_attestations_no_update',
  'trg_production_recovery_attestations_no_delete',
  'trg_seller_member_portal_grant_scope_guard',
  'trg_seller_member_portal_grant_no_update',
  'trg_seller_member_portal_grant_no_delete',
  'trg_review_approval_requires_normal_order',
  'trg_buyer_refund_obligation_requires_normal_order',
  'trg_review_service_fee_requires_normal_order',
  'trg_staff_permission_override_deny_only_insert',
  'trg_staff_permission_override_deny_only_update',
  'trg_customer_persona_privilege_session_bump',
  'trg_staff_reactivated_restore_primary_scope',
  'trg_advance_principal_payment_before_obligation',
  'trg_buyer_advance_principal_entry_files_guard',
  'trg_buyer_advance_principal_entry_files_no_update',
  'trg_buyer_advance_principal_entry_files_no_delete',
  'trg_buyer_advance_principal_overpayments_no_update',
  'trg_buyer_advance_principal_overpayments_no_delete',
  'trg_marketplace_runtime_config_no_update',
  'trg_marketplace_runtime_config_no_delete',
  'trg_formal_order_non_jp_local_date_required',
];

function schemaInventory(database) {
  return database
    .prepare(
      `
    SELECT type, name, tbl_name, sql
    FROM sqlite_schema
    WHERE type IN ('table', 'index', 'trigger', 'view')
    ORDER BY type, name
  `,
    )
    .all()
    .map((row) => ({
      type: String(row.type),
      name: String(row.name),
      table: String(row.tbl_name),
      sql: row.sql === null ? null : String(row.sql),
    }));
}

function inventoryCounts(inventory) {
  return Object.fromEntries(
    ['table', 'index', 'trigger', 'view'].map((type) => [
      type,
      inventory.filter((object) => object.type === type).length,
    ]),
  );
}

function inventoryHash(inventory) {
  return createHash('sha256').update(JSON.stringify(inventory)).digest('hex');
}

function assertIntegrity(database, label) {
  const integrity = database
    .prepare('PRAGMA integrity_check')
    .all()
    .map((row) => String(row.integrity_check));
  if (integrity.length !== 1 || integrity[0] !== 'ok') {
    throw new Error(`${label} integrity_check 失败: ${integrity.join(',')}`);
  }
  const foreignKeys = database.prepare('PRAGMA foreign_key_check').all();
  if (foreignKeys.length > 0) {
    throw new Error(`${label} foreign_key_check 发现 ${foreignKeys.length} 项`);
  }
}

function expectDmlFailure(database, sql, expectedMessage) {
  let failure = null;
  try {
    database.exec(sql);
  } catch (error) {
    failure = String(error);
  }
  if (failure === null || !failure.includes(expectedMessage)) {
    throw new Error(`expected DML failure ${expectedMessage}, received ${String(failure)}`);
  }
}

function verifyCriticalNegativeDml(database) {
  database.exec('BEGIN IMMEDIATE;');
  try {
    database.exec(`
      INSERT INTO staff_users (
        id, display_name, status, authorization_version, version,
        created_at, updated_at, disabled_at
      ) VALUES
        ('migration-verifier-owner','迁移校验负责人','ACTIVE',1,1,0,0,NULL),
        ('migration-verifier-other','迁移校验其他员工','ACTIVE',1,1,0,0,NULL);

      INSERT INTO seller_principal_rate_policy_versions (
        id, scope_type, seller_organization_id, source_currency_code,
        quote_currency_code, version_no, status, markup_rate_value, rate_scale,
        effective_from, submitted_by_staff_id, submitted_at, decision_version,
        confirmed_by_staff_id, confirmed_at, rejected_by_staff_id, rejected_at,
        rejection_reason
      ) VALUES (
        'migration-verifier-past-policy', 'CURRENCY_PAIR_DEFAULT', NULL,
        'JPY', 'CNY', 1, 'SUBMITTED', 400000, 100000000, 500,
        'migration-verifier-owner', 3000, 1, NULL, NULL, NULL, NULL, NULL
      );
    `);
    expectDmlFailure(
      database,
      `
      UPDATE seller_principal_rate_policy_versions
      SET status='CONFIRMED', decision_version=2,
        confirmed_by_staff_id='migration-verifier-owner', confirmed_at=4000
      WHERE id='migration-verifier-past-policy';
    `,
      'seller_principal_rate_policy_effective_time_conflict',
    );

    database.exec(`
      INSERT INTO seller_principal_rate_policy_versions (
        id, scope_type, seller_organization_id, source_currency_code,
        quote_currency_code, version_no, status, markup_rate_value, rate_scale,
        effective_from, submitted_by_staff_id, submitted_at, decision_version,
        confirmed_by_staff_id, confirmed_at, rejected_by_staff_id, rejected_at,
        rejection_reason
      ) VALUES (
        'migration-verifier-event-policy', 'CURRENCY_PAIR_DEFAULT', NULL,
        'USD', 'CNY', 1, 'SUBMITTED', 400000, 100000000, 5000,
        'migration-verifier-owner', 3000, 1, NULL, NULL, NULL, NULL, NULL
      );
    `);
    expectDmlFailure(
      database,
      `
      INSERT INTO seller_principal_rate_policy_events (
        id, version_id, scope_type, seller_organization_id,
        source_currency_code, quote_currency_code, version_no, event_type,
        actor_staff_id, previous_status, next_status, markup_rate_value,
        effective_from, reason, idempotency_key, created_at
      ) VALUES (
        'migration-verifier-forged-event', 'migration-verifier-event-policy',
        'CURRENCY_PAIR_DEFAULT', NULL, 'USD', 'CNY', 1,
        'SELLER_PRINCIPAL_RATE_POLICY_SUBMITTED', 'migration-verifier-other',
        NULL, 'SUBMITTED', 400000, 5000, NULL, 'verifier-forged-event', 3000
      );
    `,
      'seller_principal_rate_policy_event_source_mismatch',
    );
    database.exec(`
      INSERT INTO seller_principal_rate_policy_events (
        id, version_id, scope_type, seller_organization_id,
        source_currency_code, quote_currency_code, version_no, event_type,
        actor_staff_id, previous_status, next_status, markup_rate_value,
        effective_from, reason, idempotency_key, created_at
      ) VALUES (
        'migration-verifier-submitted-event', 'migration-verifier-event-policy',
        'CURRENCY_PAIR_DEFAULT', NULL, 'USD', 'CNY', 1,
        'SELLER_PRINCIPAL_RATE_POLICY_SUBMITTED', 'migration-verifier-owner',
        NULL, 'SUBMITTED', 400000, 5000, NULL, 'verifier-submit-event', 3000
      );
      UPDATE seller_principal_rate_policy_versions
      SET status='CONFIRMED', decision_version=2,
        confirmed_by_staff_id='migration-verifier-owner', confirmed_at=4000
      WHERE id='migration-verifier-event-policy';
      INSERT INTO seller_principal_rate_policy_events (
        id, version_id, scope_type, seller_organization_id,
        source_currency_code, quote_currency_code, version_no, event_type,
        actor_staff_id, previous_status, next_status, markup_rate_value,
        effective_from, reason, idempotency_key, created_at
      ) VALUES (
        'migration-verifier-confirmed-event', 'migration-verifier-event-policy',
        'CURRENCY_PAIR_DEFAULT', NULL, 'USD', 'CNY', 1,
        'SELLER_PRINCIPAL_RATE_POLICY_CONFIRMED', 'migration-verifier-owner',
        'SUBMITTED', 'CONFIRMED', 400000, 5000, NULL,
        'verifier-confirm-event', 4000
      );
    `);
    expectDmlFailure(
      database,
      `
      INSERT INTO seller_principal_rate_policy_events (
        id, version_id, scope_type, seller_organization_id,
        source_currency_code, quote_currency_code, version_no, event_type,
        actor_staff_id, previous_status, next_status, markup_rate_value,
        effective_from, reason, idempotency_key, created_at
      ) VALUES (
        'migration-verifier-duplicate-event', 'migration-verifier-event-policy',
        'CURRENCY_PAIR_DEFAULT', NULL, 'USD', 'CNY', 1,
        'SELLER_PRINCIPAL_RATE_POLICY_CONFIRMED', 'migration-verifier-owner',
        'SUBMITTED', 'CONFIRMED', 400000, 5000, NULL,
        'verifier-duplicate-event', 4000
      );
    `,
      'UNIQUE constraint failed',
    );
    database.exec('ROLLBACK;');
  } catch (error) {
    try {
      database.exec('ROLLBACK;');
    } catch {
      /* no open tx */
    }
    throw error;
  }
}

try {
  const historicalIntegrity = verifyHistoricalMigrationImmutability(root);
  const migrationFiles = readdirSync(migrationsDirectory)
    .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name))
    .sort();
  const migrationSources = new Map(
    migrationFiles.map((file) => [
      file,
      readFileSync(path.join(migrationsDirectory, file), 'utf8'),
    ]),
  );

  const migrationNumbers = migrationFiles.map((name) => Number(name.slice(0, 4)));
  if (
    migrationFiles.length !== expectedLatestSchema ||
    migrationFiles.at(-1) !== expectedLastMigration ||
    migrationNumbers.some((number, index) => number !== index + 1)
  ) {
    throw new Error('Migration 必须是唯一连续的 0001-0072');
  }

  for (const [file, source] of migrationSources) {
    if (/pragma_(?:integrity|quick)_check|PRAGMA\s+(?:integrity|quick)_check/iu.test(source)) {
      throw new Error(
        `${file}: 禁止在 Cloudflare D1 migration 事务内执行整库检查；` +
          '应导出后在原生 SQLite 中验证',
      );
    }
    if (containsIncompatibleTriggerRaise(source)) {
      throw new Error(
        `${file}: Cloudflare D1 不接受 trigger 中的 CASE...THEN RAISE；` +
          '应使用 SELECT RAISE(...) WHERE ... 的等价形式',
      );
    }
  }

  const database = new DatabaseSync(databasePath);
  try {
    database.exec('PRAGMA foreign_keys = ON;');
    for (const file of migrationFiles) {
      database.exec('BEGIN IMMEDIATE;');
      try {
        database.exec(migrationSources.get(file));
        database.exec('COMMIT;');
      } catch (error) {
        try {
          database.exec('ROLLBACK;');
        } catch {
          /* no open tx */
        }
        throw error;
      }
    }

    assertIntegrity(database, 'sequential');
    const sequentialInventory = schemaInventory(database);
    const sequentialInventoryJson = JSON.stringify(sequentialInventory);
    const schemaCounts = inventoryCounts(sequentialInventory);
    const schemaInventorySha256 = inventoryHash(sequentialInventory);
    for (const type of ['table', 'index', 'trigger', 'view']) {
      if (schemaCounts[type] !== expectedSchemaInventory[type]) {
        throw new Error(
          `${type} inventory count ${schemaCounts[type]} != ` + `${expectedSchemaInventory[type]}`,
        );
      }
    }
    if (schemaInventorySha256 !== expectedSchemaInventory.sha256) {
      throw new Error(`完整 Schema inventory SHA-256 不匹配: ${schemaInventorySha256}`);
    }

    const freshDatabase = new DatabaseSync(':memory:');
    try {
      freshDatabase.exec('PRAGMA foreign_keys = ON;');
      freshDatabase.exec('BEGIN IMMEDIATE;');
      try {
        for (const file of migrationFiles) {
          freshDatabase.exec(migrationSources.get(file));
        }
        freshDatabase.exec('COMMIT;');
      } catch (error) {
        try {
          freshDatabase.exec('ROLLBACK;');
        } catch {
          /* no open tx */
        }
        throw error;
      }
      assertIntegrity(freshDatabase, 'fresh');
      const freshInventoryJson = JSON.stringify(schemaInventory(freshDatabase));
      if (freshInventoryJson !== sequentialInventoryJson) {
        throw new Error('fresh 与 sequential 的完整 name+SQL inventory 不一致');
      }
      const freshState = freshDatabase
        .prepare(
          `
        SELECT schema_version FROM app_schema_state WHERE singleton_id=1
      `,
        )
        .get();
      if (Number(freshState?.schema_version) !== expectedLatestSchema) {
        throw new Error(`fresh schema 不是 ${expectedLatestSchema}`);
      }
    } finally {
      freshDatabase.close();
    }

    verifyCriticalNegativeDml(database);
    assertIntegrity(database, 'post-negative-dml');

    const tables = new Set(
      database
        .prepare(
          `
      SELECT name
      FROM sqlite_schema
      WHERE type='table'
    `,
        )
        .all()
        .map((row) => String(row.name)),
    );

    const triggers = new Set(
      database
        .prepare(
          `
      SELECT name
      FROM sqlite_schema
      WHERE type='trigger'
    `,
        )
        .all()
        .map((row) => String(row.name)),
    );

    for (const table of requiredTables) {
      if (!tables.has(table)) throw new Error(`缺少表: ${table}`);
    }
    for (const trigger of requiredTriggers) {
      if (!triggers.has(trigger)) throw new Error(`缺少触发器: ${trigger}`);
    }
    for (const table of [
      'seller_agreement_rate_versions',
      'seller_agreement_rate_events',
      'seller_agreement_currency_rate_versions',
    ]) {
      if (tables.has(table)) throw new Error(`禁止遗留表: ${table}`);
    }
    for (const [table, forbiddenColumns] of [
      [
        'formal_order_financial_snapshots',
        [
          'seller_rate_version_id',
          'seller_rate_version_no',
          'seller_rate_effective_from',
          'seller_rate_confirmed_at',
          'seller_cny_per_jpy_e8',
        ],
      ],
      [
        'formal_order_marketplace_money_snapshots',
        [
          'seller_rate_version_id',
          'seller_rate_version_no',
          'seller_rate_effective_from',
          'seller_rate_confirmed_at',
          'seller_rate_value',
          'seller_rate_scale',
        ],
      ],
    ]) {
      const columns = new Set(
        database
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .map((column) => String(column.name)),
      );
      for (const column of forbiddenColumns) {
        if (columns.has(column)) throw new Error(`禁止遗留列: ${table}.${column}`);
      }
    }
    if (
      !sequentialInventory.some(
        (object) =>
          object.type === 'index' && object.name === 'uq_seller_principal_rate_policy_event_type',
      )
    ) {
      throw new Error('缺少索引: uq_seller_principal_rate_policy_event_type');
    }

    const buyerRefundView = database
      .prepare(
        `
      SELECT name
      FROM sqlite_schema
      WHERE type='view' AND name='buyer_refund_ledger_balances'
    `,
      )
      .get();
    if (!buyerRefundView) {
      throw new Error('缺少视图: buyer_refund_ledger_balances');
    }

    const refundObligationColumns = new Set(
      database
        .prepare(
          `
      PRAGMA table_info(buyer_refund_obligations)
    `,
        )
        .all()
        .map((column) => String(column.name)),
    );
    if (refundObligationColumns.has('status')) {
      throw new Error('买家返款状态必须由账本推导，禁止持久化 status');
    }

    const sellerChannels = database
      .prepare(
        `
      SELECT code, prefix, next_sequence
      FROM seller_channels
      ORDER BY code
    `,
      )
      .all();

    const demandColumns = database
      .prepare(
        `
      PRAGMA table_info(demand_batches)
    `,
      )
      .all();
    for (const requiredColumn of ['held_reservation_count', 'approved_reservation_count']) {
      if (!demandColumns.some((column) => column.name === requiredColumn)) {
        throw new Error(`demand_batches 缺少 ${requiredColumn}`);
      }
    }

    const sellerOrganizationColumns = database
      .prepare(
        `
      PRAGMA table_info(seller_organizations)
    `,
      )
      .all();
    if (!sellerOrganizationColumns.some((column) => column.name === 'next_member_number')) {
      throw new Error('seller_organizations 缺少 next_member_number');
    }
    if (
      sellerChannels.length !== 6 ||
      sellerChannels.map((row) => row.code).join(',') !==
        'ido-mango,portal-onboarding,queshengai,ygbceping,' + 'yinghua1942,yueguangbaiai'
    ) {
      throw new Error('卖家渠道种子或编号顺序不正确');
    }

    const fileObjectColumns = database
      .prepare(
        `
      PRAGMA table_info(file_objects)
    `,
      )
      .all()
      .map((column) => String(column.name));
    for (const forbiddenColumn of ['public_url', 'signed_url', 'secret', 'upload_token']) {
      if (fileObjectColumns.includes(forbiddenColumn)) {
        throw new Error(`file_objects 禁止列: ${forbiddenColumn}`);
      }
    }

    const fileEntityLinkColumns = new Set(
      database
        .prepare(
          `
      PRAGMA table_info(file_entity_links)
    `,
        )
        .all()
        .map((column) => String(column.name)),
    );
    for (const requiredColumn of ['authorization_mode', 'expires_at', 'revoked_at']) {
      if (!fileEntityLinkColumns.has(requiredColumn)) {
        throw new Error(`file_entity_links 缺少 ${requiredColumn}`);
      }
    }
    const fileReadIntentColumns = new Set(
      database
        .prepare(
          `
      PRAGMA table_info(file_read_intents)
    `,
        )
        .all()
        .map((column) => String(column.name)),
    );
    if (!fileReadIntentColumns.has('file_entity_link_id')) {
      throw new Error('file_read_intents 缺少 file_entity_link_id');
    }

    const integerFacts = new Map([
      ['product_versions', ['ordering_guide_expected_amount_jpy', 'default_buyer_self_pay_bps']],
      ['buyer_daily_exchange_rates', ['cny_per_jpy_e8']],
      ['seller_service_fee_versions', ['fee_cny_fen']],
      [
        'order_evidence_versions',
        [
          'final_paid_jpy',
          'reference_order_amount_jpy_snapshot',
          'buyer_self_pay_bps_snapshot',
          'buyer_self_pay_jpy',
          'buyer_refundable_principal_jpy',
          'price_mismatch',
          'price_difference_jpy',
          'submitted_before_deadline',
        ],
      ],
      ['formal_orders', ['final_paid_jpy']],
      [
        'formal_order_financial_snapshots',
        [
          'buyer_cny_per_jpy_e8',
          'service_fee_cny_fen',
          'buyer_self_pay_bps',
          'buyer_self_pay_jpy',
          'buyer_refundable_principal_jpy',
          'buyer_gross_principal_cny_fen',
          'buyer_self_pay_contribution_cny_fen',
          'buyer_expected_principal_cny_fen',
          'seller_expected_principal_cny_fen',
        ],
      ],
      ['review_events', ['amount_cny_fen']],
      ['buyer_refund_obligations', ['due_amount_cny_fen']],
      ['buyer_refund_payment_entries', ['amount_cny_fen']],
      ['buyer_refund_events', ['amount_cny_fen', 'net_paid_after_cny_fen']],
    ]);
    for (const [table, columns] of integerFacts) {
      const definitions = new Map(
        database
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .map((column) => [String(column.name), String(column.type).toUpperCase()]),
      );
      for (const column of columns) {
        if (definitions.get(column) !== 'INTEGER') {
          throw new Error(`${table}.${column} 必须为 INTEGER`);
        }
      }
    }

    const productVersionColumns = new Map(
      database
        .prepare(
          `
      PRAGMA table_info(product_versions)
    `,
        )
        .all()
        .map((column) => [String(column.name), String(column.type).toUpperCase()]),
    );
    if (productVersionColumns.get('ordering_guide_expected_amount_jpy') !== 'INTEGER') {
      throw new Error('product_versions expected JPY amount must be INTEGER');
    }
    if (!productVersionColumns.has('color_spec_mode')) {
      throw new Error('product_versions missing color_spec_mode');
    }

    const mainImageColumns = new Set(
      database
        .prepare(
          `
      PRAGMA table_info(product_version_main_images)
    `,
        )
        .all()
        .map((column) => String(column.name)),
    );
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

    const fileSql = database
      .prepare(
        `
      SELECT sql FROM sqlite_schema
      WHERE type='table' AND name IN (
        'file_upload_intents', 'file_objects',
        'file_entity_links', 'file_audience_events'
      )
      ORDER BY name
    `,
      )
      .all()
      .map((row) => String(row.sql))
      .join('\n');
    for (const requiredValue of [
      'PRODUCT_IMAGE',
      'PRODUCT_VERSION',
      'ORDER_INSTRUCTION_KEYWORD_IMAGE',
      'ORDER_INSTRUCTION_VERSION',
      'ORDER_EVIDENCE_INTERNAL_COMMUNICATION',
      'ORDER_EVIDENCE_SUBMISSION',
    ]) {
      if (!fileSql.includes(requiredValue)) {
        throw new Error(`file schema missing ${requiredValue}`);
      }
    }

    const orderEvidenceColumns = new Set(
      database
        .prepare(
          `
      PRAGMA table_info(order_evidence_versions)
    `,
        )
        .all()
        .map((column) => String(column.name)),
    );
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

    const formalOrderColumns = new Set(
      database
        .prepare(
          `
      PRAGMA table_info(formal_orders)
    `,
        )
        .all()
        .map((column) => String(column.name)),
    );
    const formalSnapshotColumns = new Set(
      database
        .prepare(
          `
      PRAGMA table_info(formal_order_financial_snapshots)
    `,
        )
        .all()
        .map((column) => String(column.name)),
    );
    for (const forbiddenColumn of [
      'review_status',
      'refund_status',
      'settlement_status',
      'profit_cny_fen',
      'realized_profit_cny_fen',
    ]) {
      if (formalOrderColumns.has(forbiddenColumn) || formalSnapshotColumns.has(forbiddenColumn)) {
        throw new Error(`Phase 3F 禁止字段: ${forbiddenColumn}`);
      }
    }

    const forbiddenPhase5Tables = database
      .prepare(
        `
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
    `,
      )
      .all();
    if (forbiddenPhase5Tables.length > 0) {
      throw new Error('禁止旧式返款覆盖表、卖家结算、利润或 Amazon 自动化表');
    }

    const uniqueAmazonOrderIndex = database
      .prepare(
        `
      SELECT name
      FROM sqlite_schema
      WHERE type='index'
        AND tbl_name='formal_orders'
        AND sql IS NOT NULL
        AND upper(sql) LIKE '%UNIQUE%'
        AND sql LIKE '%amazon_order_number_normalized%'
    `,
      )
      .all();
    if (uniqueAmazonOrderIndex.length > 0) {
      throw new Error('Amazon订单号不得设置全局唯一');
    }

    const rateLimitColumns = new Set(
      database
        .prepare('PRAGMA table_info(customer_login_rate_limits)')
        .all()
        .map((column) => String(column.name)),
    );
    for (const requiredColumn of ['scope_type', 'scope_hash', 'window_expires_at']) {
      if (!rateLimitColumns.has(requiredColumn)) {
        throw new Error(`customer_login_rate_limits 缺少 ${requiredColumn}`);
      }
    }

    const state = database
      .prepare(
        `
      SELECT schema_version
      FROM app_schema_state
      WHERE singleton_id=1
    `,
      )
      .get();
    if (
      Number(state?.schema_version) !== expectedLatestSchema ||
      migrationFiles.length !== expectedLatestSchema
    ) {
      throw new Error(
        `Schema 版本 ${String(state?.schema_version)} 与 Migration 数量 ` +
          `${migrationFiles.length} 不一致`,
      );
    }

    console.log(
      JSON.stringify(
        {
          status: 'PASS',
          historical_baseline: historicalIntegrity.baseline,
          immutable_historical_migrations: historicalIntegrity.count,
          historical_migration_aggregate_sha256: historicalIntegrity.aggregateSha256,
          migrations: migrationFiles,
          table_count: tables.size,
          index_count: schemaCounts.index,
          trigger_count: triggers.size,
          view_count: schemaCounts.view,
          schema_inventory_objects: sequentialInventory.length,
          schema_inventory_sha256: schemaInventorySha256,
          fresh_sequential_inventory_match: true,
          critical_negative_dml: 3,
          integrity_check: 'ok',
          foreign_key_errors: 0,
          schema_version: Number(state.schema_version),
          seller_channels: sellerChannels,
        },
        null,
        2,
      ),
    );
  } finally {
    database.close();
  }
} finally {
  rmSync(workDirectory, {
    recursive: true,
    force: true,
  });
}
