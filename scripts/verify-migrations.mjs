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
];

const requiredTriggers = [
  'trg_transaction_assertion_guard',
  'trg_transaction_assertion_cleanup',
  'trg_audit_events_no_update',
  'trg_audit_events_no_delete',
  'trg_staff_authorization_events_no_update',
  'trg_staff_authorization_events_no_delete',
  'trg_buyer_identity_subject_type_guard',
  'trg_seller_member_identity_subject_type_guard',
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
      database.exec(readFileSync(
        path.join(migrationsDirectory, file),
        'utf8',
      ));
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
        throw new Error(
          `demand_batches 缺少 ${requiredColumn}`,
        );
      }
    }

    const sellerOrganizationColumns = database.prepare(`
      PRAGMA table_info(seller_organizations)
    `).all();
    if (!sellerOrganizationColumns.some(
      (column) => column.name === 'next_member_number',
    )) {
      throw new Error(
        'seller_organizations 缺少 next_member_number',
      );
    }
    if (sellerChannels.length !== 3) {
      throw new Error('卖家渠道种子数量不正确');
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

    const integerFacts = new Map([
      ['buyer_daily_exchange_rates', ['cny_per_jpy_e8']],
      ['seller_agreement_rate_versions', ['cny_per_jpy_e8']],
      ['seller_service_fee_versions', ['fee_cny_fen']],
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
