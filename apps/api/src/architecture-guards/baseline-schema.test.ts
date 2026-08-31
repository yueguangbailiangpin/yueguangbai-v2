import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';

// Clean baseline schema suite (D-054). This file carries the still-valid
// schema assertions previously anchored on the legacy per-number migration
// tests (0021/0023/0027/0028/0030/0036/0037/0043/0062-0071), which retired
// with the old 0001-0075 chain. Mid-chain upgrade-path semantics are gone by
// design; everything below asserts the applied final baseline state
// (0001-0019 stage 3 + 0020 marketplace canonical unification stage 4).

let database: SqliteDatabase | null = null;
afterEach(() => {
  database?.close();
  database = null;
});

const root = path.resolve(import.meta.dirname, '../../../..');

describe('stage 3 clean baseline schema', () => {
  it('is one continuous 0001-0037 chain ending at schema version 37', () => {
    const migrations = readdirSync(path.join(root, 'migrations'))
      .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))
      .sort();
    expect(migrations).toHaveLength(37);
    expect(migrations.map((name) => Number(name.slice(0, 4))))
      .toEqual(Array.from({ length: 37 }, (_, index) => index + 1));
    expect(migrations.at(-1)).toBe('0037_stage75_multimarket_staff_order_list_index.sql');
    for (const file of migrations) {
      const source = readFileSync(path.join(root, 'migrations', file), 'utf8');
      expect(source).not.toMatch(/SELECT\s+CASE\s+WHEN[\s\S]*?THEN\s+RAISE\s*\(/iu);
      expect(source).not.toMatch(/\b(?:REAL|FLOAT)\b/u);
    }
  });

  it('applies to an empty database in one pass at version 37', () => {
    database = createMigratedTestDatabase();
    const state = database.raw.prepare(
      'SELECT schema_version FROM app_schema_state WHERE singleton_id=1',
    ).get();
    expect(state).toEqual({ schema_version: 37 });
    expect(database.raw.prepare('PRAGMA integrity_check').get())
      .toEqual({ integrity_check: 'ok' });
    expect(database.raw.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('keeps seller settlement ledgers append-only with unique business keys', () => {
    database = createMigratedTestDatabase();
    const payables = database.raw.prepare(`
      SELECT sql FROM sqlite_schema WHERE type='table' AND name='seller_payables'
    `).get() as { sql: string };
    expect(payables.sql).toContain("payable_type IN ('SELLER_PRINCIPAL','SELLER_SERVICE_FEE')");
    expect(payables.sql).toContain('UNIQUE (formal_order_id, payable_type)');
    expect(payables.sql).toContain('UNIQUE (source_type, source_id, payable_type)');
    for (const trigger of [
      'trg_seller_payables_no_update',
      'trg_seller_payables_no_delete',
      'trg_seller_payment_update_guard',
      'trg_seller_allocation_guard',
      'trg_seller_payment_reversal_guard',
    ]) {
      expect(database.raw.prepare(
        `SELECT type FROM sqlite_schema WHERE name='${trigger}'`,
      ).get()).toEqual({ type: 'trigger' });
    }
    for (const view of ['seller_payment_balances', 'seller_payable_balances']) {
      expect(database.raw.prepare(
        `SELECT type FROM sqlite_schema WHERE name='${view}'`,
      ).get()).toEqual({ type: 'view' });
    }
  });

  it('keeps formal order number claims unique among active states only', () => {
    database = createMigratedTestDatabase();
    const index = database.raw.prepare(`
      SELECT sql FROM sqlite_schema
      WHERE type='index' AND name='uq_formal_order_number_claims_active'
    `).get() as { sql: string } | undefined;
    expect(index?.sql).toMatch(/UNIQUE INDEX uq_formal_order_number_claims_active/u);
    expect(index?.sql).toMatch(/WHERE status IN \('PROVISIONAL','FINAL'\)/u);
    expect(database.raw.prepare(`
      SELECT name FROM sqlite_schema
      WHERE type='index' AND tbl_name='formal_orders' AND sql IS NOT NULL
        AND upper(sql) LIKE '%UNIQUE%'
        AND sql LIKE '%amazon_order_number_normalized%'
    `).all()).toEqual([]);
    expect(database.raw.prepare(`
      SELECT name FROM sqlite_schema WHERE name='formal_order_number_conflicts'
    `).get()).toEqual({ name: 'formal_order_number_conflicts' });
  });

  it('keeps the buyer amazon order date authority columns and guards', () => {
    database = createMigratedTestDatabase();
    for (const table of ['order_evidence_versions', 'formal_orders']) {
      const columns = database.raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string; type: string; notnull: number }[];
      const column = columns.find((value) => value.name === 'amazon_order_date');
      expect(column?.type).toBe('TEXT');
      expect(column?.notnull).toBe(0);
      const sql = database.raw.prepare(`
        SELECT sql FROM sqlite_schema WHERE type='table' AND name='${table}'
      `).get() as { sql: string };
      expect(sql.sql).toContain('date(amazon_order_date)=amazon_order_date');
    }
    const evidenceGuard = database.raw.prepare(`
      SELECT sql FROM sqlite_schema
      WHERE type='trigger' AND name='trg_order_evidence_version_submission_guard'
    `).get() as { sql: string };
    expect(evidenceGuard.sql).toContain('NEW.amazon_order_date IS NULL');
    const formalGuard = database.raw.prepare(`
      SELECT sql FROM sqlite_schema
      WHERE type='trigger' AND name='trg_formal_order_source_guard'
    `).get() as { sql: string };
    expect(formalGuard.sql).toContain('evidence.amazon_order_date=NEW.amazon_order_date');
  });

  it('keeps customer multipersona security without plaintext material columns', () => {
    database = createMigratedTestDatabase();
    for (const table of [
      'customer_account_personas',
      'customer_buyer_invitations',
      'customer_password_reset_tokens',
      'customer_security_rate_limits',
      'customer_login_identifier_change_events',
    ]) {
      expect(database.raw.prepare(`
        SELECT type FROM sqlite_schema WHERE name='${table}'
      `).get()).toEqual({ type: 'table' });
    }
    const schemaText = database.raw.prepare(`
      SELECT group_concat(sql, char(10)) AS sql FROM sqlite_schema
      WHERE type='table' AND name IN (
        'customer_buyer_invitations', 'customer_password_reset_tokens',
        'customer_password_credentials'
      )
    `).get() as { sql: string };
    expect(schemaText.sql).not.toMatch(/\btoken\s+TEXT/iu);
    expect(schemaText.sql).not.toMatch(/\bpassword\s+TEXT/iu);
    for (const trigger of [
      'trg_customer_buyer_invitation_events_no_update',
      'trg_customer_buyer_invitation_events_no_delete',
      'trg_customer_password_reset_events_no_update',
      'trg_customer_password_reset_events_no_delete',
      'trg_customer_persona_privilege_session_bump',
    ]) {
      expect(database.raw.prepare(`
        SELECT type FROM sqlite_schema WHERE name='${trigger}'
      `).get()).toEqual({ type: 'trigger' });
    }
  });

  it('keeps advance V1 full payment, proof and overpayment guards', () => {
    database = createMigratedTestDatabase();
    for (const trigger of [
      'trg_advance_principal_full_payment_amount_guard',
      'trg_advance_principal_single_outstanding_payment_guard',
      'trg_advance_principal_full_reversal_guard',
      'trg_advance_principal_reversal_source_guard',
      'trg_buyer_advance_principal_entries_no_update',
      'trg_buyer_advance_principal_entries_no_delete',
      'trg_buyer_advance_principal_overpayments_no_update',
      'trg_buyer_advance_principal_overpayments_no_delete',
    ]) {
      expect(database.raw.prepare(`
        SELECT type FROM sqlite_schema WHERE name='${trigger}'
      `).get()).toEqual({ type: 'trigger' });
    }
    expect(database.raw.prepare(`
      SELECT type FROM sqlite_schema WHERE name='buyer_advance_principal_overpayments'
    `).get()).toEqual({ type: 'table' });
    const filePurposes = database.raw.prepare(`
      SELECT group_concat(sql, char(10)) AS sql FROM sqlite_schema
      WHERE type='table' AND name IN ('file_upload_intents', 'file_objects', 'file_entity_links')
    `).get() as { sql: string };
    expect(filePurposes.sql).toContain('BUYER_REFUND_PROOF');
    expect(filePurposes.sql).toContain('SELLER_SETTLEMENT_PROOF');
  });

  it('keeps buyer refund reminders immutable and buyer-bound', () => {
    database = createMigratedTestDatabase();
    for (const object of [
      'buyer_refund_reminders',
      'trg_buyer_refund_reminders_source_guard',
      'trg_buyer_refund_reminders_no_update',
      'trg_buyer_refund_reminders_no_delete',
    ]) {
      expect(database.raw.prepare(`
        SELECT type FROM sqlite_schema WHERE name='${object}'
      `).get()).toMatchObject({ type: expect.stringMatching(/table|trigger/u) });
    }
  });

  it('keeps reservation scheduling versions immutable with the +8h business day window', () => {
    database = createMigratedTestDatabase();
    expect(database.raw.prepare(`
      SELECT type FROM sqlite_schema WHERE name='demand_order_schedule_versions'
    `).get()).toEqual({ type: 'table' });
    for (const trigger of [
      'trg_demand_order_schedule_versions_no_update',
      'trg_demand_order_schedule_versions_no_delete',
    ]) {
      expect(database.raw.prepare(`
        SELECT type FROM sqlite_schema WHERE name='${trigger}'
      `).get()).toEqual({ type: 'trigger' });
    }
    const schedulingText = database.raw.prepare(`
      SELECT group_concat(sql, char(10)) AS sql FROM sqlite_schema
      WHERE type IN ('table', 'trigger') AND (
        tbl_name IN ('demand_batches', 'product_versions')
        OR name LIKE 'trg_demand_order_schedule%'
      )
    `).get() as { sql: string };
    expect(schedulingText.sql).toContain('order_interval_days');
    expect(schedulingText.sql).toContain('orders_per_run');
  });

  it('keeps product application amounts as nullable guarded integers', () => {
    database = createMigratedTestDatabase();
    const columns = database.raw.prepare(
      'PRAGMA table_info(product_applications)',
    ).all() as { name: string; type: string; notnull: number }[];
    const column = columns.find((value) => value.name === 'ordering_guide_expected_amount_jpy');
    expect(column?.type).toBe('INTEGER');
    expect(column?.notnull).toBe(0);
  });

  it('keeps the principal rate policy and snapshot immutability with source guards', () => {
    database = createMigratedTestDatabase();
    // Stage 6.6 removed the submit/confirm decision model; the protection now
    // rests on version immutability plus insert-time source verification.
    for (const trigger of [
      'trg_seller_principal_rate_policy_no_delete',
      'trg_seller_principal_rate_policy_no_update',
      'trg_seller_principal_rate_snapshots_no_update',
      'trg_seller_principal_rate_snapshots_no_delete',
      'trg_seller_principal_rate_snapshot_guard',
      'trg_seller_principal_rate_snapshot_confirmation_guard',
    ]) {
      expect(database.raw.prepare(`
        SELECT type FROM sqlite_schema WHERE name='${trigger}'
      `).get()).toEqual({ type: 'trigger' });
    }
  });

  it('contains no retired capability tables from stages 2 and 3', () => {
    database = createMigratedTestDatabase();
    const forbidden = [
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
      'feishu_staff_directory_users',
    ];
    for (const table of forbidden) {
      expect(database.raw.prepare(`
        SELECT COUNT(*) AS count FROM sqlite_schema WHERE name='${table}'
      `).get()).toEqual({ count: 0 });
    }
  });

  it('seeds only the clean three-marketplace registry with COUPANG_KR fail-closed', () => {
    database = createMigratedTestDatabase();
    const registry = database.raw.prepare(`
      SELECT code, status, adapter_status FROM marketplace_registry ORDER BY code
    `).all() as { code: string; status: string; adapter_status: string }[];
    expect(registry).toEqual([
      { code: 'AMAZON_JP', status: 'ACTIVE', adapter_status: 'AVAILABLE' },
      { code: 'AMAZON_US', status: 'ACTIVE', adapter_status: 'AVAILABLE' },
      { code: 'COUPANG_KR', status: 'DISABLED', adapter_status: 'UNAVAILABLE' },
    ]);
    // Stage 4 removed the legacy JP alias layer atomically: the retired
    // marketplaces/alias tables must be gone and every rebuilt marketplace FK
    // must target marketplace_registry with canonical-only storage.
    for (const retired of ['marketplaces', 'marketplace_legacy_aliases']) {
      expect(database.raw.prepare(
        `SELECT COUNT(*) AS count FROM sqlite_schema WHERE name='${retired}'`,
      ).get()).toEqual({ count: 0 });
    }
    const formalOrderColumns = database.raw.prepare(
      'PRAGMA table_info(formal_orders)',
    ).all() as { name: string }[];
    expect(formalOrderColumns.map((column) => column.name))
      .not.toContain('canonical_marketplace_code');
    // Stage 6.6 made marketplace_registry the single marketplace config source:
    // the runtime-config side table is gone and the registry itself carries the
    // timezone and portal-status columns.
    expect(database.raw.prepare(
      `SELECT COUNT(*) AS count FROM sqlite_schema WHERE name='marketplace_runtime_config'`,
    ).get()).toEqual({ count: 0 });
    const registryColumns = database.raw.prepare(
      'PRAGMA table_info(marketplace_registry)',
    ).all() as { name: string }[];
    const registryColumnNames = registryColumns.map((column) => column.name);
    for (const column of [
      'business_timezone',
      'reporting_timezone',
      'seller_portal_status',
      'buyer_portal_status',
    ]) {
      expect(registryColumnNames).toContain(column);
    }
    const formalOrderSql = database.raw.prepare(`
      SELECT sql FROM sqlite_schema WHERE type='table' AND name='formal_orders'
    `).get() as { sql: string };
    expect(formalOrderSql.sql).toContain('REFERENCES marketplace_registry(code)');
    expect(formalOrderSql.sql).not.toContain('RAKUTEN_JP');
  });
});
