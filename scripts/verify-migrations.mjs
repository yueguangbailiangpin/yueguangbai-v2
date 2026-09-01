import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Clean baseline verifier (D-054): the 0001-0019 domain-split chain replaced
// the legacy 0001-0075 chain (stage 3); 0020 unified marketplace storage on
// the canonical codes and removed the legacy JP alias layer (stage 4).
// Provenance: docs/migration/V2_BACKEND_REBUILD_INVENTORY.md §7.2/§7.3.

const root = path.resolve(import.meta.dirname, '..');
const migrationsDirectory = path.join(root, 'migrations');
const workDirectory = mkdtempSync(path.join(tmpdir(), 'ygb-v2-migrations-'));
const databasePath = path.join(workDirectory, 'verification.sqlite');
const expectedLatestSchema = 42;
const expectedLastMigration = '0042_marketplace_runtime_expansion.sql';
const expectedSchemaInventory = {
  table: 155,
  index: 488,
  trigger: 305,
  view: 10,
  sha256: 'c75ec40e6d9bf1c14558f8e67f5fe012509111cd4f02db317a34d72056557890',
};

// Capability tables that must NOT exist in the clean baseline (stage 2
// deletions + owner-confirmed platform identity/parallel-order retirement).
const forbiddenTables = [
  // Owner cleanup 2026-09-01 (schema 38): zero-consumer registration island,
  // always-empty cursor assertion table.
  'buyer_registration_attempts',
  'buyer_registration_conflict_events',
  'buyer_registration_conflicts',
  'staff_assignment_cursor_assertions',
  'customer_buyer_invitation_lead_links',
  'scheduled_operations_permission_catalog',
  'buyer_daily_exchange_rate_events',
  'buyer_daily_exchange_rates',
  'seller_service_fee_events',
  'seller_service_fee_versions',
  'buyer_preorder_number_allocations',
  'marketplace_runtime_config',
  'formal_order_marketplace_money_snapshots',
  'order_evidence_marketplace_money',
  'acquisition_reporting_config',
  'drive_archive_controls',
  'file_drive_archives',
  'file_drive_archive_events',
  'file_drive_archive_manifests',
  'file_drive_archive_reconciliations',
  'file_drive_rehydrations',
  'marketplaces',
  'marketplace_legacy_aliases',
  'acquisition_machine_credentials',
  'acquisition_machine_marketplaces',
  'acquisition_machine_channels',
  'acquisition_machine_rate_buckets',
  'acquisition_prospect_signals',
  'staff_mcp_rate_limits',
  'staff_mcp_replay_records',
  'staff_mcp_runtime_controls',
  'staff_mcp_subject_bindings',
  'staff_mcp_token_revocations',
  'order_instruction_keyword_images',
  'order_instruction_asset_batches',
  'order_instruction_asset_items',
  'platform_product_identities',
  'platform_order_identities',
  'platform_identity_events',
  'platform_formal_orders',
  'platform_order_evidence_records',
  'platform_order_evidence_internal_files',
  'marketplace_registry_legacy_0029',
  'seller_agreement_rate_versions',
  'seller_agreement_rate_events',
  'seller_agreement_currency_rate_versions',
  'buyer_refunds',
  'seller_settlements',
  'internal_settlements',
  'review_profits',
  'amazon_accounts',
  'amazon_review_automation',
  // Stage 6.6B (D-056) retirements: the pool/round-robin/fallback/
  // availability/reassignment/org-chart assignment machinery, seller member
  // store scoping, and the order_evidence_internal_files slot table.
  'staff_departments',
  'staff_teams',
  'staff_team_memberships',
  'staff_team_leaders',
  'staff_role_consolidation_cutovers',
  'staff_role_consolidation_mappings',
  'staff_assignment_cursors',
  'staff_assignment_fallbacks',
  'staff_availability',
  'staff_reassignment_batches',
  'staff_reassignment_batch_items',
  'seller_member_portal_store_grants',
  'seller_member_store_scopes',
  'seller_member_store_scope_events',
  'order_evidence_internal_files',
  // Stage 6.6C (D-056): the acquisition CRM, integration outbox and dead letters.
  'acquisition_assignment_events',
  'acquisition_channel_events',
  'acquisition_channel_privacy_profiles',
  'acquisition_channels',
  'acquisition_customer_attributions',
  'acquisition_customer_intake_facts',
  'acquisition_daily_consultation_events',
  'acquisition_daily_consultations',
  'acquisition_historical_source_exemptions',
  'acquisition_lead_events',
  'acquisition_lead_links',
  'acquisition_lead_source_corrections',
  'acquisition_leads',
  'acquisition_maintenance_runs',
  'acquisition_maintenance_state',
  'acquisition_prospects',
  'acquisition_role_permission_defaults',
  'acquisition_staff_channel_assignments',
  'integration_outbox',
  'scheduled_dead_letters',
];

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
    if (current === '\'' || current === '"') {
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
  'audit_events',
  'buyer_advance_principal_entries',
  'buyer_advance_principal_entry_files',
  'buyer_advance_principal_overpayments',
  'buyer_advance_principal_settlements',
  'buyer_auth_recovery_events',
  'buyer_channels',
  'buyer_customers',
  'buyer_daily_currency_rate_versions',
  'buyer_marketplace_assignments',
  'buyer_marketplace_correction_events',
  'buyer_number_allocation_events',
  'buyer_refund_events',
  'buyer_refund_obligations',
  'buyer_refund_payment_entries',
  'buyer_refund_payment_entry_files',
  'buyer_refund_reminders',
  'buyer_registration_rate_limits',
  'buyer_registration_session_issuances',
  'buyer_staff_assignments',
  'command_idempotency_records',
  'currencies',
  'customer_access_events',
  'customer_account_personas',
  'customer_auth_security_events',
  'customer_buyer_invitation_events',
  'customer_buyer_invitations',
  'customer_identity_claim_events',
  'customer_identity_manual_bindings',
  'customer_identity_resolution_cases',
  'customer_identity_resolution_events',
  'customer_identity_subjects',
  'customer_login_accounts',
  'customer_login_identifier_change_events',
  'customer_login_rate_limits',
  'customer_password_credentials',
  'customer_password_reset_events',
  'customer_password_reset_tokens',
  'customer_security_rate_limits',
  'customer_seller_invitation_events',
  'customer_seller_invitations',
  'demand_batch_events',
  'demand_batches',
  'demand_order_schedule_versions',
  'archive_runtime_controls',
  'historical_import_batches',
  'historical_orders',
  'historical_order_files',
  'historical_import_quarantine',
  'historical_import_identity_overrides',
  'historical_image_inventory_batches',
  'historical_image_inventory_files',
  'historical_image_inventory_findings',
  'archive_bundles',
  'archive_bundle_files',
  'archive_bundle_events',
  'archive_jobs',
  'archive_restores',
  'archive_restore_members',
  'file_audience_events',
  'file_entity_audience_grants',
  'file_entity_links',
  'file_events',
  'file_objects',
  'file_read_intents',
  'file_upload_intents',
  'financial_export_events',
  'formal_order_events',
  'formal_order_financial_adjustments',
  'formal_order_financial_snapshots',
  'formal_order_number_claims',
  'formal_order_number_conflicts',
  'formal_order_operational_events',
  'formal_orders',
  'marketplace_registry',
  'order_archive_closures',
  'order_evidence_duplicate_signals',
  'order_evidence_events',
  'order_evidence_submissions',
  'order_evidence_version_files',
  'order_evidence_versions',
  'order_instruction_events',
  'order_instruction_expiry_scan_cursors',
  'order_instruction_reconciliation_markers',
  'order_instruction_versions',
  'order_instructions',
  'product_application_events',
  'product_applications',
  'product_events',
  'product_reservation_openings',
  'product_reservations',
  'product_version_main_images',
  'product_versions',
  'production_recovery_attestations',
  'products',
  'reservation_events',
  'reservation_participation_exceptions',
  'review_cases',
  'review_events',
  'review_evidence_version_files',
  'review_evidence_versions',
  'review_visibility_observations',
  'scheduled_alert_states',
  'scheduled_job_runs',
  'scheduled_job_states',
  'scheduled_manual_commands',
  'scheduled_operational_signals',
  'seller_channels',
  'seller_customer_group_marketplaces',
  'seller_customer_groups',
  'seller_member_events',
  'seller_member_invitation_events',
  'seller_member_invitations',
  'seller_organization_channel_events',
  'seller_organization_members',
  'seller_organizations',
  'seller_partner_import_batches',
  'seller_partner_import_source_records',
  'seller_payable_events',
  'seller_payable_reconciliation_conflicts',
  'seller_payables',
  'seller_payment_allocation_reversals',
  'seller_payment_allocations',
  'seller_payment_events',
  'seller_payment_proofs',
  'seller_payment_reversals',
  'seller_payments',
  'seller_principal_rate_policy_events',
  'seller_principal_rate_policy_versions',
  'seller_principal_rate_snapshots',
  'seller_product_offerings',
  'seller_product_primary_contact_events',
  'seller_service_fee_rule_versions',
  'seller_staff_assignments',
  'seller_store_events',
  'seller_store_marketplaces',
  'seller_stores',
  'staff_assignment_events',
  'staff_assignment_role_permission_defaults',
  'staff_authorization_events',
  'staff_email_identities',
  'staff_marketplace_scopes',
  'staff_permission_overrides',
  'staff_role_assignments',
  'staff_sessions',
  'staff_users',
  'staff_work_items',
  'standard_products',
  'transaction_assertions',
  'wechat_identity_claims',
];

const requiredTriggers = [
  'trg_buyer_daily_currency_rate_no_delete',
  'trg_buyer_daily_currency_rate_no_update',
  'trg_seller_service_fee_rule_no_delete',
  'trg_seller_service_fee_rule_no_update',
  'trg_seller_principal_rate_policy_no_delete',
  'trg_seller_principal_rate_policy_no_update',
  'trg_seller_principal_rate_policy_events_no_delete',
  'trg_seller_principal_rate_policy_events_no_update',
  'trg_seller_principal_rate_snapshots_no_delete',
  'trg_seller_principal_rate_snapshots_no_update',
  'trg_seller_principal_rate_snapshot_confirmation_guard',
  'trg_seller_principal_rate_snapshot_guard',
  'trg_formal_order_financial_snapshot_guard',
  'trg_formal_order_financial_snapshots_no_delete',
  'trg_formal_order_financial_snapshots_no_update',
  'trg_formal_order_financial_self_pay_guard',
  'trg_buyer_marketplace_assignment_fact_guard',
  'trg_advance_principal_full_payment_amount_guard',
  'trg_advance_principal_full_reversal_guard',
  'trg_advance_principal_payment_before_obligation',
  'trg_advance_principal_reversal_source_guard',
  'trg_advance_principal_reversal_total_guard',
  'trg_advance_principal_single_outstanding_payment_guard',
  'trg_audit_events_no_delete',
  'trg_audit_events_no_update',
  'trg_buyer_advance_principal_entries_no_delete',
  'trg_buyer_advance_principal_entries_no_update',
  'trg_buyer_advance_principal_entry_files_guard',
  'trg_buyer_advance_principal_entry_files_no_delete',
  'trg_buyer_advance_principal_entry_files_no_update',
  'trg_buyer_advance_principal_overpayments_no_delete',
  'trg_buyer_advance_principal_overpayments_no_update',
  'trg_buyer_advance_principal_settlements_no_delete',
  'trg_buyer_advance_principal_settlements_no_update',
  'trg_buyer_auth_recovery_events_no_delete',
  'trg_buyer_auth_recovery_events_no_update',
  'trg_buyer_customer_marketplace_default',
  'trg_buyer_marketplace_correction_events_no_delete',
  'trg_buyer_marketplace_correction_events_no_update',
  'trg_buyer_refund_event_identity_guard',
  'trg_buyer_refund_events_no_delete',
  'trg_buyer_refund_events_no_update',
  'trg_buyer_refund_obligation_requires_normal_order',
  'trg_buyer_refund_obligation_source_guard',
  'trg_buyer_refund_obligation_version_guard',
  'trg_buyer_refund_obligations_no_delete',
  'trg_buyer_refund_payment_entries_no_delete',
  'trg_buyer_refund_payment_entries_no_update',
  'trg_buyer_refund_payment_entry_file_guard',
  'trg_buyer_refund_payment_entry_files_no_delete',
  'trg_buyer_refund_payment_entry_files_no_update',
  'trg_buyer_refund_payment_entry_source_guard',
  'trg_buyer_refund_reminders_no_delete',
  'trg_buyer_refund_reminders_no_update',
  'trg_buyer_refund_reminders_source_guard',
  'trg_buyer_refund_reversal_limit_guard',
  'trg_buyer_registration_sessions_no_delete',
  'trg_buyer_registration_sessions_no_update',
  'trg_buyer_staff_assignments_no_delete',
  'trg_buyer_staff_assignments_revoke_only',
  'trg_buyer_staff_assignments_staff_guard',
  'trg_customer_access_events_no_delete',
  'trg_customer_access_events_no_update',
  'trg_customer_account_identity_rebind_guard',
  'trg_customer_account_identity_rebind_persona_sync',
  'trg_customer_account_persona_after_account_buyer',
  'trg_customer_account_persona_after_account_seller',
  'trg_customer_account_persona_after_buyer',
  'trg_customer_account_persona_after_seller_member',
  'trg_customer_account_persona_source_guard',
  'trg_customer_account_personas_no_delete',
  'trg_customer_account_personas_no_update',
  'trg_customer_auth_security_events_no_delete',
  'trg_customer_auth_security_events_no_update',
  'trg_customer_buyer_invitation_events_no_delete',
  'trg_customer_buyer_invitation_events_no_update',
  'trg_customer_buyer_invitation_transition_guard',
  'trg_customer_buyer_invitations_no_delete',
  'trg_customer_identity_claim_events_no_delete',
  'trg_customer_identity_claim_events_no_update',
  'trg_customer_identity_resolution_events_no_delete',
  'trg_customer_identity_resolution_events_no_update',
  'trg_customer_login_identifier_change_events_no_delete',
  'trg_customer_login_identifier_change_events_no_update',
  'trg_customer_password_reset_events_no_delete',
  'trg_customer_password_reset_events_no_update',
  'trg_customer_password_reset_source_guard',
  'trg_customer_password_reset_tokens_no_delete',
  'trg_customer_password_reset_transition_guard',
  'trg_customer_persona_privilege_session_bump',
  'trg_demand_batch_capacity_guard_insert',
  'trg_demand_batch_capacity_guard_update',
  'trg_demand_batch_events_no_delete',
  'trg_demand_batch_events_no_update',
  'trg_demand_buyer_self_pay_publish_guard_insert',
  'trg_demand_buyer_self_pay_publish_guard_update',
  'trg_demand_buyer_self_pay_published_immutable',
  'trg_demand_order_schedule_insert_guard',
  'trg_demand_order_schedule_versions_no_delete',
  'trg_demand_order_schedule_versions_no_update',
  'trg_archive_runtime_controls_no_delete',
  'trg_archive_runtime_controls_update_guard',
  'trg_archive_bundles_no_delete',
  'trg_archive_bundles_insert_guard',
  'trg_archive_bundles_update_guard',
  'trg_archive_bundle_events_no_update',
  'trg_archive_bundle_events_no_delete',
  'trg_archive_bundle_files_no_delete',
  'trg_archive_bundle_files_insert_guard',
  'trg_archive_bundle_files_update_guard',
  'trg_archive_jobs_no_delete',
  'trg_archive_jobs_update_guard',
  'trg_archive_restores_no_delete',
  'trg_archive_restores_update_guard',
  'trg_archive_restore_members_no_update',
  'trg_archive_restore_members_no_delete',
  'trg_explicit_file_link_revoke_only',
  'trg_file_audience_events_no_delete',
  'trg_file_audience_events_no_update',
  'trg_file_audience_grant_link_guard',
  'trg_file_audience_grants_no_delete',
  'trg_file_audience_grants_revoke_only',
  'trg_file_entity_links_verified_guard',
  'trg_file_events_no_delete',
  'trg_file_events_no_update',
  'trg_file_objects_intent_guard',
  'trg_file_objects_verified_guard',
  'trg_file_read_intent_link_guard',
  'trg_file_read_intents_verified_guard',
  'trg_financial_export_events_no_delete',
  'trg_financial_export_events_no_update',
  'trg_formal_order_event_identity_guard',
  'trg_formal_order_events_no_delete',
  'trg_formal_order_events_no_update',
  'trg_formal_order_financial_adjustment_event_guard',
  'trg_formal_order_financial_adjustment_profit_only',
  'trg_formal_order_financial_adjustments_no_delete',
  'trg_formal_order_financial_adjustments_no_update',
  'trg_formal_order_instruction_guard',
  'trg_formal_order_non_jp_local_date_required',
  'trg_formal_order_number_claim_source_guard',
  'trg_formal_order_number_claim_transition_guard',
  'trg_formal_order_number_claims_no_delete',
  'trg_formal_order_number_conflicts_no_delete',
  'trg_formal_order_operational_events_no_delete',
  'trg_formal_order_operational_events_no_update',
  'trg_formal_order_source_guard',
  'trg_formal_orders_no_delete',
  'trg_formal_orders_no_update',
  'trg_order_archive_closure_insert_guard',
  'trg_order_archive_closure_reclose_source_guard',
  'trg_order_archive_closure_update_guard',
  'trg_order_archive_closures_no_delete',
  'trg_order_evidence_duplicate_signal_after_version',
  'trg_order_evidence_duplicate_signals_no_delete',
  'trg_order_evidence_duplicate_signals_no_update',
  'trg_order_evidence_event_identity_guard',
  'trg_order_evidence_events_no_delete',
  'trg_order_evidence_events_no_update',
  'trg_order_evidence_instruction_snapshot_guard',
  'trg_order_evidence_submission_identity_immutable',
  'trg_order_evidence_submission_reservation_guard',
  'trg_order_evidence_version_file_guard',
  'trg_order_evidence_version_files_no_delete',
  'trg_order_evidence_version_files_no_update',
  'trg_order_evidence_version_submission_guard',
  'trg_order_evidence_versions_no_delete',
  'trg_order_evidence_versions_no_update',
  'trg_order_instruction_events_no_delete',
  'trg_order_instruction_events_no_update',
  'trg_order_instruction_historical_marker_guard',
  'trg_order_instruction_identity_immutable',
  'trg_order_instruction_reconciliation_markers_no_delete',
  'trg_order_instruction_reconciliation_markers_no_update',
  'trg_order_instruction_reservation_guard',
  'trg_order_instruction_transition_guard',
  'trg_order_instruction_version_main_image_guard',
  'trg_order_instruction_version_source_guard',
  'trg_order_instruction_versions_no_delete',
  'trg_order_instruction_versions_no_update',
  'trg_order_instructions_no_delete',
  'trg_product_application_events_no_delete',
  'trg_product_application_events_no_update',
  'trg_product_events_no_delete',
  'trg_product_events_no_update',
  'trg_product_image_file_links_no_delete',
  'trg_product_image_file_links_no_update',
  'trg_product_version_main_image_guard',
  'trg_product_version_main_images_no_delete',
  'trg_product_version_main_images_no_update',
  'trg_product_versions_no_delete',
  'trg_product_versions_no_update',
  'trg_product_versions_ordering_profile_insert_guard',
  'trg_product_versions_self_pay_insert_guard',
  'trg_production_recovery_attestations_no_delete',
  'trg_production_recovery_attestations_no_update',
  'trg_reservation_events_no_delete',
  'trg_reservation_events_no_update',
  'trg_reservation_participation_exceptions_no_delete',
  'trg_reservation_participation_exceptions_no_update',
  'trg_reservation_self_pay_snapshot_immutable',
  'trg_reservation_self_pay_snapshot_insert_guard',
  'trg_review_approval_requires_normal_order',
  'trg_review_case_source_guard',
  'trg_review_case_transition_guard',
  'trg_review_cases_no_delete',
  'trg_review_event_identity_guard',
  'trg_review_events_no_delete',
  'trg_review_events_no_update',
  'trg_review_evidence_version_file_guard',
  'trg_review_evidence_version_files_no_delete',
  'trg_review_evidence_version_files_no_update',
  'trg_review_evidence_version_guard',
  'trg_review_evidence_version_url_guard',
  'trg_review_evidence_versions_no_delete',
  'trg_review_evidence_versions_no_update',
  'trg_review_service_fee_requires_normal_order',
  'trg_review_visibility_observations_no_delete',
  'trg_review_visibility_observations_no_update',
  'trg_review_visibility_requires_approved_review',
  'trg_seller_allocation_guard',
  'trg_seller_allocation_reversal_guard',
  'trg_seller_allocation_reversals_no_delete',
  'trg_seller_allocation_reversals_no_update',
  'trg_seller_channel_events_no_delete',
  'trg_seller_channel_events_no_update',
  'trg_seller_customer_group_after_org',
  'trg_seller_member_events_no_delete',
  'trg_seller_member_events_no_update',
  'trg_seller_member_invitation_events_no_delete',
  'trg_seller_member_invitation_events_no_update',
  'trg_seller_partner_import_source_no_delete',
  'trg_seller_partner_import_source_no_update',
  'trg_seller_payable_conflicts_no_delete',
  'trg_seller_payable_conflicts_no_update',
  'trg_seller_payable_event_guard',
  'trg_seller_payable_events_no_delete',
  'trg_seller_payable_events_no_update',
  'trg_seller_payable_source_guard',
  'trg_seller_payables_no_delete',
  'trg_seller_payables_no_update',
  'trg_seller_payment_allocations_no_delete',
  'trg_seller_payment_allocations_no_update',
  'trg_seller_payment_event_guard',
  'trg_seller_payment_events_no_delete',
  'trg_seller_payment_events_no_update',
  'trg_seller_payment_insert_guard',
  'trg_seller_payment_proof_guard',
  'trg_seller_payment_proofs_no_delete',
  'trg_seller_payment_proofs_no_update',
  'trg_seller_payment_reversal_guard',
  'trg_seller_payment_reversals_no_delete',
  'trg_seller_payment_reversals_no_update',
  'trg_seller_payment_update_guard',
  'trg_seller_payments_no_delete',
  'trg_seller_product_primary_contact_events_no_delete',
  'trg_seller_product_primary_contact_events_no_update',
  'trg_seller_product_primary_contact_insert_guard',
  'trg_seller_product_primary_contact_member_guard',
  'trg_seller_staff_assignments_no_delete',
  'trg_seller_staff_assignments_revoke_only',
  'trg_seller_staff_assignments_staff_guard',
  'trg_seller_store_events_no_delete',
  'trg_seller_store_events_no_update',
  'trg_seller_store_marketplace_default',
  'trg_staff_assignment_role_permission_defaults_no_delete',
  'trg_staff_assignment_role_permission_defaults_no_update',
  'trg_staff_assignment_events_no_delete',
  'trg_staff_assignment_events_no_update',
  'trg_staff_authorization_events_no_delete',
  'trg_staff_authorization_events_no_update',
  'trg_staff_permission_override_deny_only_insert',
  'trg_staff_permission_override_deny_only_update',
  'trg_staff_reactivated_restore_primary_scope',
  'trg_staff_role_assignments_no_delete',
  'trg_staff_role_assignments_revoke_only',
  'trg_staff_sessions_identity_immutable',
  'trg_staff_sessions_no_delete',
  'trg_staff_sessions_transition_guard',
  'trg_staff_work_item_marketplace_after_insert',
  'trg_staff_work_items_assignment_guard',
  'trg_staff_work_items_no_delete',
  'trg_staff_work_items_update_guard',
  'trg_transaction_assertion_cleanup',
  'trg_transaction_assertion_guard',
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
        quote_currency_code, version_no, markup_rate_value, rate_scale,
        effective_from, created_by_staff_id, created_at
      ) VALUES (
        'migration-verifier-past-policy', 'CURRENCY_PAIR_DEFAULT', NULL,
        'JPY', 'CNY', 1, 400000, 100000000, 500,
        'migration-verifier-owner', 500
      );
    `);
    expectDmlFailure(
      database,
      `
      UPDATE seller_principal_rate_policy_versions
      SET markup_rate_value=1
      WHERE id='migration-verifier-past-policy';
    `,
      'seller_principal_rate_policy_is_immutable',
    );
    expectDmlFailure(
      database,
      `
      DELETE FROM seller_principal_rate_policy_versions
      WHERE id='migration-verifier-past-policy';
    `,
      'seller_principal_rate_policy_is_immutable',
    );
    database.exec(`
      INSERT INTO seller_principal_rate_policy_events (
        id, version_id, scope_type, seller_organization_id,
        source_currency_code, quote_currency_code, version_no, event_type,
        actor_staff_id, markup_rate_value, effective_from,
        idempotency_key, created_at
      ) VALUES (
        'migration-verifier-saved-event', 'migration-verifier-past-policy',
        'CURRENCY_PAIR_DEFAULT', NULL, 'JPY', 'CNY', 1,
        'SELLER_PRINCIPAL_RATE_POLICY_SAVED', 'migration-verifier-owner',
        400000, 500, 'verifier-saved-event', 500
      );
    `);
    expectDmlFailure(
      database,
      `
      INSERT INTO seller_principal_rate_policy_events (
        id, version_id, scope_type, seller_organization_id,
        source_currency_code, quote_currency_code, version_no, event_type,
        actor_staff_id, markup_rate_value, effective_from,
        idempotency_key, created_at
      ) VALUES (
        'migration-verifier-duplicate-event', 'migration-verifier-past-policy',
        'CURRENCY_PAIR_DEFAULT', NULL, 'JPY', 'CNY', 1,
        'SELLER_PRINCIPAL_RATE_POLICY_SAVED', 'migration-verifier-owner',
        400000, 500, 'verifier-duplicate-event', 600
      );
    `,
      'UNIQUE constraint failed',
    );
    expectDmlFailure(
      database,
      `
      UPDATE seller_principal_rate_policy_events
      SET markup_rate_value=1
      WHERE id='migration-verifier-saved-event';
    `,
      'seller_principal_rate_policy_event_is_immutable',
    );
    expectDmlFailure(
      database,
      `
      DELETE FROM seller_principal_rate_policy_events
      WHERE id='migration-verifier-saved-event';
    `,
      'seller_principal_rate_policy_event_is_immutable',
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
  const migrationFiles = readdirSync(migrationsDirectory)
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))
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
    throw new Error('Migration 必须是唯一连续的 0001-0042');
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
    for (const table of forbiddenTables) {
      if (tables.has(table)) throw new Error(`禁止遗留表: ${table}`);
    }
    // Owner cleanup 0038/0039 guard (Codex 0901 Q6): no surviving schema
    // object may still reference a dropped table/view by name -- trigger and
    // view bodies included, closing the audit blind spot that briefly
    // dropped a load-bearing permission view.
    for (const name of [
      'buyer_registration_attempts',
      'buyer_registration_conflicts',
      'buyer_registration_conflict_events',
      'staff_assignment_cursor_assertions',
      'buyer_registration_conflict_statuses',
      'formal_order_effective_dates',
      'customer_buyer_invitation_lead_links',
      'scheduled_operations_permission_catalog',
    ]) {
      const referencing = database
        .prepare(
          "SELECT name FROM sqlite_schema WHERE name != ? AND sql LIKE '%' || ? || '%'",
        )
        .all(name, name)
        .map((row) => String(row.name));
      if (referencing.length) {
        throw new Error(`被删对象存在幸存引用: ${name} <- ${referencing.join(', ')}`);
      }
    }
    // Positive counterpart (Codex 0901 P1-2): the two live staff guard
    // triggers must still select the effective-permission view, proving the
    // load-bearing defaults/view/trigger chain survived the 0038/0039 drops.
    for (const guard of [
      'trg_buyer_staff_assignments_staff_guard',
      'trg_seller_staff_assignments_staff_guard',
    ]) {
      const row = database
        .prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name=?")
        .get(guard);
      if (!row || !String(row.sql).includes('staff_effective_assignment_permissions')) {
        throw new Error(`承重守卫触发器丢失或不再引用权限视图: ${guard}`);
      }
    }
    for (const [table, forbiddenColumns] of [
      ['formal_orders', ['canonical_marketplace_code']],
      [
        'formal_order_financial_snapshots',
        [
          'seller_rate_version_id',
          'seller_rate_version_no',
          'seller_rate_effective_from',
          'seller_rate_confirmed_at',
          'seller_cny_per_jpy_e8',
          'service_fee_version_id',
          'buyer_cny_per_jpy_e8',
        ],
      ],
      [
        'buyer_customers',
        ['first_valid_order_business_date'],
      ],
      [
        'order_evidence_versions',
        ['evidence_file_object_id'],
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

    const marketplaceRegistry = database
      .prepare(
        `
      SELECT code, status || ':' || adapter_status AS state
      FROM marketplace_registry
      ORDER BY code
    `,
      )
      .all();
    const registryExpectation = [
      'AMAZON_JP:ACTIVE:AVAILABLE',
      'AMAZON_US:ACTIVE:AVAILABLE',
      'COUPANG_KR:DISABLED:UNAVAILABLE',
      'RAKUTEN_JP:ACTIVE:AVAILABLE',
      'TEMU_JP:ACTIVE:AVAILABLE',
      'TIKTOK_JP:ACTIVE:AVAILABLE',
      'YAHOO_JP:ACTIVE:AVAILABLE',
    ];
    if (
      marketplaceRegistry.length !== 7 ||
      marketplaceRegistry.map((row) => `${row.code}:${row.state}`).join(',') !==
        registryExpectation.join(',')
    ) {
      throw new Error(
        'Marketplace registry 必须含七平台（五开+COUPANG_KR fail-closed）',
      );
    }
    if (
      database.prepare('SELECT COUNT(*) AS count FROM marketplace_registry').get().count !== 7
    ) {
      throw new Error('marketplace seed count');
    }

    const sellerChannels = database
      .prepare(
        `
      SELECT code, prefix, next_sequence, status
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
      sellerChannels.length !== 7 ||
      sellerChannels.filter((row) => row.status === 'ACTIVE').map((row) => row.code).join(',') !==
        'ido-mango,portal-onboarding,queshengai,ygbceping,' + 'yinghua1942,yueguangbaiai'
    ) {
      throw new Error('卖家渠道种子或编号顺序不正确');
    }
    const moonwhiteTombstone = sellerChannels.find((row) => row.code === 'yueguangbai');
    if (!moonwhiteTombstone || moonwhiteTombstone.status !== 'DISABLED') {
      throw new Error('yueguangbai 必须以 DISABLED 墓碑保留（0041）');
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
      ['buyer_daily_currency_rate_versions', ['rate_value', 'rate_scale']],
      ['seller_service_fee_rule_versions', ['fee_amount_minor']],
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
          'buyer_rate_value',
          'buyer_rate_scale',
          'payment_amount_minor',
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
      'ORDER_COMMUNICATION_SCREENSHOT',
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
          baseline: 'clean-baseline-0001-0042',
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
