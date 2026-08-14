import { afterEach, describe, expect, it } from 'vitest';
import {
  createMigratedTestDatabase,
  SqliteDatabase,
} from '@ygb/testkit';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  COLD_ARCHIVE_CONFIRMED_AT,
  seedConfirmedColdArchiveOrder,
} from '../../test-support/cold-archive-fixture';

const migrationsDirectory = path.resolve(process.cwd(), 'migrations');
const migration0043 = '0043_seller_principal_rate_integrity_hardening.sql';
let database: SqliteDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe('Migration 0043 seller-principal integrity hardening', () => {
  it('rejects incompatible schema-42 facts before creating partial DDL', () => {
    database = createSchema42Database();
    database.exec(`
      INSERT INTO staff_users (
        id, display_name, status, authorization_version, version,
        created_at, updated_at, disabled_at
      ) VALUES ('migration-owner','迁移负责人','ACTIVE',1,1,0,0,NULL);

      INSERT INTO seller_principal_rate_policy_versions (
        id, scope_type, seller_organization_id, source_currency_code,
        quote_currency_code, version_no, status, markup_rate_value, rate_scale,
        effective_from, submitted_by_staff_id, submitted_at, decision_version,
        confirmed_by_staff_id, confirmed_at, rejected_by_staff_id, rejected_at,
        rejection_reason
      ) VALUES (
        'past-effective-existing', 'CURRENCY_PAIR_DEFAULT', NULL, 'JPY', 'CNY',
        1, 'SUBMITTED', 400000, 100000000, 500,
        'migration-owner', 3000, 1, NULL, NULL, NULL, NULL, NULL
      );
      UPDATE seller_principal_rate_policy_versions
      SET status='CONFIRMED', decision_version=2,
        confirmed_by_staff_id='migration-owner', confirmed_at=4000
      WHERE id='past-effective-existing';
    `);

    expect(() => apply0043(database!)).toThrow('transaction_assertion_failed');

    const state = database.raw.prepare(`
      SELECT schema_version FROM app_schema_state WHERE singleton_id=1
    `).get() as { schema_version: number };
    const repairObjects = database.raw.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_schema
      WHERE name IN (
        'uq_seller_principal_rate_policy_event_type',
        'trg_seller_principal_rate_policy_future_effective_guard',
        'trg_seller_principal_rate_policy_event_fidelity_guard',
        'trg_seller_principal_rate_snapshot_confirmation_guard'
      )
    `).get() as { count: number };
    const policy = database.raw.prepare(`
      SELECT status, effective_from, confirmed_at
      FROM seller_principal_rate_policy_versions
      WHERE id='past-effective-existing'
    `).get();
    expect(state.schema_version).toBe(42);
    expect(repairObjects.count).toBe(0);
    expect(policy).toEqual({
      status: 'CONFIRMED',
      effective_from: 500,
      confirmed_at: 4000,
    });
  });

  it('guards future-effective policy decisions', async () => {
    database = createMigratedTestDatabase();
    database.exec(`
      INSERT INTO seller_principal_rate_policy_versions (
        id, scope_type, seller_organization_id, source_currency_code,
        quote_currency_code, version_no, status, markup_rate_value, rate_scale,
        effective_from, submitted_by_staff_id, submitted_at, decision_version,
        confirmed_by_staff_id, confirmed_at, rejected_by_staff_id, rejected_at,
        rejection_reason
      ) VALUES (
        'future-policy-guard', 'CURRENCY_PAIR_DEFAULT', NULL, 'JPY', 'CNY',
        1, 'SUBMITTED', 400000, 100000000, 500,
        'zz-phase3h-test-owner', 3000, 1, NULL, NULL, NULL, NULL, NULL
      );
    `);
    await expect(database.prepare(`
      UPDATE seller_principal_rate_policy_versions
      SET status='CONFIRMED', decision_version=2,
        confirmed_by_staff_id='zz-phase3h-test-owner', confirmed_at=4000
      WHERE id='future-policy-guard'
    `).run()).rejects.toThrow(
      'seller_principal_rate_policy_effective_time_conflict',
    );
    const pending = await database.prepare(`
      SELECT status, decision_version
      FROM seller_principal_rate_policy_versions
      WHERE id='future-policy-guard'
    `).first();
    expect(pending).toEqual({ status: 'SUBMITTED', decision_version: 1 });
  });

  it('binds policy events to exact actor, time, reason, and event type', async () => {
    database = createMigratedTestDatabase();
    database.exec(`
      INSERT INTO staff_users (
        id, display_name, status, authorization_version, version,
        created_at, updated_at, disabled_at
      ) VALUES ('event-other-staff','其他员工','ACTIVE',1,1,0,0,NULL);

      INSERT INTO seller_principal_rate_policy_versions (
        id, scope_type, seller_organization_id, source_currency_code,
        quote_currency_code, version_no, status, markup_rate_value, rate_scale,
        effective_from, submitted_by_staff_id, submitted_at, decision_version,
        confirmed_by_staff_id, confirmed_at, rejected_by_staff_id, rejected_at,
        rejection_reason
      ) VALUES (
        'event-policy', 'CURRENCY_PAIR_DEFAULT', NULL, 'JPY', 'CNY',
        1, 'SUBMITTED', 400000, 100000000, 5000,
        'zz-phase3h-test-owner', 3000, 1, NULL, NULL, NULL, NULL, NULL
      );
    `);

    await expect(insertPolicyEvent(database, {
      id: 'forged-submitter',
      versionId: 'event-policy',
      eventType: 'SELLER_PRINCIPAL_RATE_POLICY_SUBMITTED',
      actorStaffId: 'event-other-staff',
      previousStatus: null,
      nextStatus: 'SUBMITTED',
      reason: null,
      createdAt: 3000,
    })).rejects.toThrow('seller_principal_rate_policy_event_source_mismatch');
    await expect(insertPolicyEvent(database, {
      id: 'forged-submitted-time',
      versionId: 'event-policy',
      eventType: 'SELLER_PRINCIPAL_RATE_POLICY_SUBMITTED',
      actorStaffId: 'zz-phase3h-test-owner',
      previousStatus: null,
      nextStatus: 'SUBMITTED',
      reason: null,
      createdAt: 2999,
    })).rejects.toThrow('seller_principal_rate_policy_event_source_mismatch');
    await insertPolicyEvent(database, {
      id: 'submitted-event',
      versionId: 'event-policy',
      eventType: 'SELLER_PRINCIPAL_RATE_POLICY_SUBMITTED',
      actorStaffId: 'zz-phase3h-test-owner',
      previousStatus: null,
      nextStatus: 'SUBMITTED',
      reason: null,
      createdAt: 3000,
    });
    database.exec(`
      UPDATE seller_principal_rate_policy_versions
      SET status='CONFIRMED', decision_version=2,
        confirmed_by_staff_id='zz-phase3h-test-owner', confirmed_at=4000
      WHERE id='event-policy';
    `);
    await insertPolicyEvent(database, {
      id: 'confirmed-event',
      versionId: 'event-policy',
      eventType: 'SELLER_PRINCIPAL_RATE_POLICY_CONFIRMED',
      actorStaffId: 'zz-phase3h-test-owner',
      previousStatus: 'SUBMITTED',
      nextStatus: 'CONFIRMED',
      reason: null,
      createdAt: 4000,
    });
    await expect(insertPolicyEvent(database, {
      id: 'duplicate-confirmed-event',
      versionId: 'event-policy',
      eventType: 'SELLER_PRINCIPAL_RATE_POLICY_CONFIRMED',
      actorStaffId: 'zz-phase3h-test-owner',
      previousStatus: 'SUBMITTED',
      nextStatus: 'CONFIRMED',
      reason: null,
      createdAt: 4000,
    })).rejects.toThrow(/uq_seller_principal_rate_policy_event_type|UNIQUE/iu);

    database.exec(`
      INSERT INTO seller_principal_rate_policy_versions (
        id, scope_type, seller_organization_id, source_currency_code,
        quote_currency_code, version_no, status, markup_rate_value, rate_scale,
        effective_from, submitted_by_staff_id, submitted_at, decision_version,
        confirmed_by_staff_id, confirmed_at, rejected_by_staff_id, rejected_at,
        rejection_reason
      ) VALUES (
        'rejected-policy-event', 'CURRENCY_PAIR_DEFAULT', NULL, 'JPY', 'CNY',
        2, 'SUBMITTED', 500000, 100000000, 6000,
        'zz-phase3h-test-owner', 3000, 1, NULL, NULL, NULL, NULL, NULL
      );
      UPDATE seller_principal_rate_policy_versions
      SET status='REJECTED', decision_version=2,
        rejected_by_staff_id='zz-phase3h-test-owner', rejected_at=4000,
        rejection_reason='权威拒绝原因'
      WHERE id='rejected-policy-event';
    `);
    await expect(insertPolicyEvent(database, {
      id: 'forged-rejection-reason',
      versionId: 'rejected-policy-event',
      eventType: 'SELLER_PRINCIPAL_RATE_POLICY_REJECTED',
      actorStaffId: 'zz-phase3h-test-owner',
      previousStatus: 'SUBMITTED',
      nextStatus: 'REJECTED',
      reason: '伪造拒绝原因',
      createdAt: 4000,
      markupRateValue: 500000,
      effectiveFrom: 6000,
      versionNo: 2,
    })).rejects.toThrow('seller_principal_rate_policy_event_source_mismatch');
  });

  it('binds a principal snapshot to confirmation time and financial amount', async () => {
    database = createMigratedTestDatabase();
    const order = await seedConfirmedColdArchiveOrder(database, 'migration-0043');
    const confirmedAt = COLD_ARCHIVE_CONFIRMED_AT;

    await expect(insertPrincipalSnapshot(database, {
      formalOrderId: order.formalOrderId,
      sellerOrganizationId: order.sellerOrganizationId,
      policyVersionId: 'cold-principal-policy-migration-0043',
      policyVersionNo: 1,
      policyEffectiveFrom: 3000,
      policyConfirmedAt: 2000,
      markupRateValue: 500000,
      finalRateValue: 6000000,
      amount: 11880,
      createdAt: confirmedAt + 1,
    })).rejects.toThrow('seller_principal_rate_snapshot_source_mismatch');

    database.exec(`
      INSERT INTO seller_principal_rate_policy_versions (
        id, scope_type, seller_organization_id, source_currency_code,
        quote_currency_code, version_no, status, markup_rate_value, rate_scale,
        effective_from, submitted_by_staff_id, submitted_at, decision_version,
        confirmed_by_staff_id, confirmed_at, rejected_by_staff_id, rejected_at,
        rejection_reason
      ) VALUES (
        'different-principal-policy', 'SELLER_ORGANIZATION',
        '${order.sellerOrganizationId}', 'JPY', 'CNY', 2, 'SUBMITTED',
        700000, 100000000, 4000, 'cold-archive-owner', 1000, 1,
        NULL, NULL, NULL, NULL, NULL
      );
      UPDATE seller_principal_rate_policy_versions
      SET status='CONFIRMED', decision_version=2,
        confirmed_by_staff_id='cold-archive-owner', confirmed_at=2000
      WHERE id='different-principal-policy';
    `);
    await expect(insertPrincipalSnapshot(database, {
      formalOrderId: order.formalOrderId,
      sellerOrganizationId: order.sellerOrganizationId,
      policyVersionId: 'different-principal-policy',
      policyVersionNo: 2,
      policyEffectiveFrom: 4000,
      policyConfirmedAt: 2000,
      markupRateValue: 700000,
      finalRateValue: 6200000,
      amount: 12276,
      createdAt: confirmedAt,
    })).rejects.toThrow('seller_principal_rate_snapshot_source_mismatch');

    await expect(database.prepare(`
      SELECT policy_version_id,final_rate_value,
        seller_expected_principal_amount_minor,created_at
      FROM seller_principal_rate_snapshots WHERE formal_order_id=?
    `).bind(order.formalOrderId).first()).resolves.toEqual({
      policy_version_id: 'cold-principal-policy-migration-0043',
      final_rate_value: 6000000,
      seller_expected_principal_amount_minor: 11880,
      created_at: confirmedAt,
    });
  });
});

function createSchema42Database(): SqliteDatabase {
  const result = new SqliteDatabase();
  const files = readdirSync(migrationsDirectory)
    .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name))
    .sort()
    .filter((name) => name < migration0043);
  expect(files).toHaveLength(42);
  for (const file of files) applySqlMigration(result, file);
  return result;
}

function apply0043(target: SqliteDatabase): void {
  applySqlMigration(target, migration0043);
}

function applySqlMigration(target: SqliteDatabase, file: string): void {
  target.exec('BEGIN IMMEDIATE;');
  try {
    target.exec(readFileSync(path.join(migrationsDirectory, file), 'utf8'));
    target.exec('COMMIT;');
  } catch (error) {
    try { target.exec('ROLLBACK;'); } catch { /* no open transaction */ }
    throw error;
  }
}

function insertPolicyEvent(target: SqliteDatabase, input: {
  id: string;
  versionId: string;
  eventType: string;
  actorStaffId: string;
  previousStatus: string | null;
  nextStatus: string;
  reason: string | null;
  createdAt: number;
  markupRateValue?: number;
  effectiveFrom?: number;
  versionNo?: number;
}) {
  return target.prepare(`
    INSERT INTO seller_principal_rate_policy_events (
      id, version_id, scope_type, seller_organization_id,
      source_currency_code, quote_currency_code, version_no, event_type,
      actor_staff_id, previous_status, next_status, markup_rate_value,
      effective_from, reason, idempotency_key, created_at
    ) VALUES (?, ?, 'CURRENCY_PAIR_DEFAULT', NULL, 'JPY', 'CNY', ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?)
  `).bind(
    input.id,
    input.versionId,
    input.versionNo ?? 1,
    input.eventType,
    input.actorStaffId,
    input.previousStatus,
    input.nextStatus,
    input.markupRateValue ?? 400000,
    input.effectiveFrom ?? 5000,
    input.reason,
    `event-key-${input.id}`,
    input.createdAt,
  ).run();
}

function insertPrincipalSnapshot(target: SqliteDatabase, input: {
  formalOrderId: string;
  sellerOrganizationId: string;
  policyVersionId: string;
  policyVersionNo: number;
  policyEffectiveFrom: number;
  policyConfirmedAt: number;
  markupRateValue: number;
  finalRateValue: number;
  amount: number;
  createdAt: number;
}) {
  return target.prepare(`
    INSERT INTO seller_principal_rate_snapshots (
      formal_order_id, platform_order_date, payment_amount_minor,
      payment_currency_code, base_rate_version_id, base_rate_business_date,
      base_rate_confirmed_at, base_rate_value, base_rate_scale,
      policy_version_id, policy_scope_type, policy_seller_organization_id,
      policy_version_no, policy_effective_from, policy_confirmed_at,
      markup_rate_value, markup_rate_scale, final_rate_value, final_rate_scale,
      rounding_rule, seller_expected_principal_amount_minor, created_at
    ) VALUES (
      ?, '2026-08-01', 1980, 'JPY', 'currency-cold-buyer-rate', '2026-08-01',
      2000, 5500000, 100000000, ?, 'SELLER_ORGANIZATION', ?, ?, ?, ?, ?,
      100000000, ?, 100000000, 'HALF_UP', ?, ?
    )
  `).bind(
    input.formalOrderId,
    input.policyVersionId,
    input.sellerOrganizationId,
    input.policyVersionNo,
    input.policyEffectiveFrom,
    input.policyConfirmedAt,
    input.markupRateValue,
    input.finalRateValue,
    input.amount,
    input.createdAt,
  ).run();
}
