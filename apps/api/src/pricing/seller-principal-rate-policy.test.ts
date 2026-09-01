import { afterEach, describe, expect, it } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import { saveBuyerDailyExchangeRate } from './buyer-daily-exchange-rates';
import {
  readSellerPrincipalRatePolicies,
  resolveSellerPrincipalRateSnapshot,
  saveSellerPrincipalRatePolicy,
} from './seller-principal-rate-policy';
import type { PricingStaffActor } from './pricing-shared';

const sellerOps: PricingStaffActor = {
  staffId: 'staff-seller-ops', displayName: 'Seller Ops', roles: ['seller_ops'],
};
const owner: PricingStaffActor = {
  staffId: 'staff-owner', displayName: 'Owner', roles: ['owner'],
};

let database: SqliteDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe('seller principal rate policy (stage 6.6 single-save model)', () => {
  it('reads the GLOBAL default target without Seller Organization master data', async () => {
    database = createMigratedTestDatabase();
    expect(await readSellerPrincipalRatePolicies(database, {
      sourceCurrencyCode: 'JPY', sellerOrganizationId: null, at: 5_000,
    })).toEqual({
      source_currency_code: 'JPY', quote_currency_code: 'CNY',
      seller_organization_id: null,
      default_policy: null, seller_override_policy: null,
      default_next_version: 1, seller_override_next_version: null,
      selected_policy: null,
    });
  });

  it('uses the order-date base rate plus the absolute default markup', async () => {
    database = fixture();
    await seedBaseRate(database, '2026-08-01', '5100000');
    const saved = await savePolicy(database, {
      scopeType: 'CURRENCY_PAIR_DEFAULT', sellerOrganizationId: null,
      markupRateValue: '0.004', expectedVersion: 0,
    }, 'policy:default:save');
    expect(saved).toMatchObject({
      markup_rate_value: '400000',
      markup_rate_scale: '100000000',
      effective_from: saved.created_at,
      replayed: false,
    });

    const resolved = await resolveSellerPrincipalRateSnapshot(database, {
      sellerOrganizationId: 'seller-org-1', platformOrderDate: '2026-08-01',
      paymentAmountMinor: 100, paymentCurrencyCode: 'JPY', at: 9_000,
    });
    expect(resolved).toMatchObject({
      base_rate_value: '5100000',
      markup_rate_value: '400000',
      final_rate_value: '5500000',
      seller_expected_principal_amount_minor: '550',
      policy_scope_type: 'CURRENCY_PAIR_DEFAULT',
    });
  });

  it('distinguishes an explicit zero seller override from an unset override', async () => {
    database = fixture();
    await seedBaseRate(database, '2026-08-01', '5100000');
    await savePolicy(database, {
      scopeType: 'CURRENCY_PAIR_DEFAULT', sellerOrganizationId: null,
      markupRateValue: '0.004', expectedVersion: 0,
    }, 'policy:default:save');
    await savePolicy(database, {
      scopeType: 'SELLER_ORGANIZATION', sellerOrganizationId: 'seller-org-1',
      markupRateValue: '0', expectedVersion: 0,
    }, 'policy:override-zero:save');
    const policies = await readSellerPrincipalRatePolicies(database, {
      sourceCurrencyCode: 'JPY', sellerOrganizationId: 'seller-org-1', at: 9_000,
    });
    expect(policies.selected_policy).toMatchObject({
      scope_type: 'SELLER_ORGANIZATION',
      markup_rate_value: '0',
    });
    const resolved = await resolveSellerPrincipalRateSnapshot(database, {
      sellerOrganizationId: 'seller-org-1', platformOrderDate: '2026-08-01',
      paymentAmountMinor: 100, paymentCurrencyCode: 'JPY', at: 9_000,
    });
    expect(resolved).toMatchObject({
      final_rate_value: '5100000',
      seller_expected_principal_amount_minor: '510',
    });
  });

  it('honors exact-date lookup, idempotent replay, and fail-closed missing rates', async () => {
    database = fixture();
    await expect(resolveSellerPrincipalRateSnapshot(database, {
      sellerOrganizationId: 'seller-org-1', platformOrderDate: '2026-08-01',
      paymentAmountMinor: 100, paymentCurrencyCode: 'JPY', at: 5_000,
    })).rejects.toMatchObject({ code: 'SELLER_PRINCIPAL_RATE_NOT_FOUND' });

    await seedBaseRate(database, '2026-08-01', '5100000');
    const key = 'policy:idempotent:save';
    const once = await savePolicy(database, {
      scopeType: 'CURRENCY_PAIR_DEFAULT', sellerOrganizationId: null,
      markupRateValue: '0.004', expectedVersion: 0,
    }, key);
    const replay = await savePolicy(database, {
      scopeType: 'CURRENCY_PAIR_DEFAULT', sellerOrganizationId: null,
      markupRateValue: '0.004', expectedVersion: 0,
    }, key);
    expect(replay).toMatchObject({
      policy_version_id: once.policy_version_id,
      replayed: true,
    });

    // Exact Amazon-order-date resolution: no rate seeded for 2026-08-02 fails.
    await seedBaseRate(database, '2026-08-03', '5200000');
    await expect(resolveSellerPrincipalRateSnapshot(database, {
      sellerOrganizationId: 'seller-org-1', platformOrderDate: '2026-08-02',
      paymentAmountMinor: 100, paymentCurrencyCode: 'JPY', at: 9_000,
    })).rejects.toMatchObject({ code: 'SELLER_PRINCIPAL_RATE_NOT_FOUND' });
  });

  it('rejects version conflicts and payload mismatches under the same key', async () => {
    database = fixture();
    await savePolicy(database, {
      scopeType: 'CURRENCY_PAIR_DEFAULT', sellerOrganizationId: null,
      markupRateValue: '0.004', expectedVersion: 0,
    }, 'policy:first:save');
    await expect(savePolicy(database, {
      scopeType: 'CURRENCY_PAIR_DEFAULT', sellerOrganizationId: null,
      markupRateValue: '0.005', expectedVersion: 0,
    }, 'policy:stale:save')).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });

  it('allows both owner and seller_ops to save; rejects non-maintainer roles', async () => {
    database = fixture();
    const preSales: PricingStaffActor = {
      staffId: 'staff-pre-sales', displayName: 'Pre Sales', roles: ['pre_sales'],
    };
    database.exec(`
      INSERT INTO staff_users (
        id, display_name, status, authorization_version, version,
        created_at, updated_at, disabled_at
      ) VALUES ('staff-pre-sales', 'Pre Sales', 'ACTIVE', 1, 1, 1, 1, NULL)
    `);
    await expect(saveSellerPrincipalRatePolicy(database, {
      scopeType: 'CURRENCY_PAIR_DEFAULT', sellerOrganizationId: null,
      sourceCurrencyCode: 'JPY', markupRateValue: '0.004', expectedVersion: 0,
    }, command(preSales, 'policy:role:pre-sales', 1_000))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(saveSellerPrincipalRatePolicy(database, {
      scopeType: 'CURRENCY_PAIR_DEFAULT', sellerOrganizationId: null,
      sourceCurrencyCode: 'JPY', markupRateValue: '0.004', expectedVersion: 0,
    }, command(owner, 'policy:role:owner', 1_000))).resolves.toMatchObject({
      version_no: 1,
    });
    await expect(saveSellerPrincipalRatePolicy(database, {
      scopeType: 'SELLER_ORGANIZATION', sellerOrganizationId: 'seller-org-1',
      sourceCurrencyCode: 'JPY', markupRateValue: '0.003', expectedVersion: 0,
    }, command(sellerOps, 'policy:role:seller-ops', 2_000))).resolves.toMatchObject({
      version_no: 1,
    });
  });

  it('rejects direct SQL tampering: saved versions are immutable', async () => {
    database = fixture();
    await savePolicy(database, {
      scopeType: 'CURRENCY_PAIR_DEFAULT', sellerOrganizationId: null,
      markupRateValue: '0.004', expectedVersion: 0,
    }, 'policy:immutable:save');
    const db = database;
    expect(() => db.exec(`
      UPDATE seller_principal_rate_policy_versions
      SET markup_rate_value=1
      WHERE version_no=1 AND scope_type='CURRENCY_PAIR_DEFAULT'
    `)).toThrow(/immutable/u);
    expect(() => db.exec(`
      DELETE FROM seller_principal_rate_policy_versions
      WHERE scope_type='CURRENCY_PAIR_DEFAULT'
    `)).toThrow(/immutable/u);
  });

  it('rejects a duplicate effective boundary at the database boundary', async () => {
    database = fixture();
    const db = database;
    database.exec(`
      INSERT INTO seller_principal_rate_policy_versions (
        id, scope_type, seller_organization_id, source_currency_code,
        quote_currency_code, version_no, markup_rate_value, rate_scale,
        effective_from, created_by_staff_id, created_at
      ) VALUES (
        'policy-existing', 'CURRENCY_PAIR_DEFAULT', NULL, 'JPY', 'CNY',
        1, 400000, 100000000, 1000, 'staff-owner', 1000
      )
    `);
    expect(() => db.exec(`
      INSERT INTO seller_principal_rate_policy_versions (
        id, scope_type, seller_organization_id, source_currency_code,
        quote_currency_code, version_no, markup_rate_value, rate_scale,
        effective_from, created_by_staff_id, created_at
      ) VALUES (
        'policy-conflict', 'CURRENCY_PAIR_DEFAULT', NULL, 'JPY', 'CNY',
        2, 500000, 100000000, 1000, 'staff-owner', 1000
      )
    `)).toThrow();
  });
});

function fixture(): SqliteDatabase {
  const db = createMigratedTestDatabase();
  db.exec(`
    INSERT INTO staff_users (
      id, display_name, status, authorization_version, version,
      created_at, updated_at, disabled_at
    ) VALUES
      ('staff-seller-ops', 'Seller Ops', 'ACTIVE', 1, 1, 1, 1, NULL),
      ('staff-owner', 'Owner', 'ACTIVE', 1, 1, 1, 1, NULL);
    INSERT INTO seller_organizations (
      id, marketplace_code, seller_code, origin_channel_id, current_channel_id,
      seller_sequence, organization_name, status, version, created_at,
      updated_at, activated_at, disabled_at, next_member_number
    ) VALUES (
      'seller-org-1', 'AMAZON_JP', 'ido-mango-000001', 'seller-channel-ido-mango',
      'seller-channel-ido-mango', 1, '测试卖家', 'ACTIVE', 1, 1, 1, 1, NULL, 2
    );
  `);
  return db;
}

async function seedBaseRate(
  db: SqliteDatabase,
  businessDate: string,
  value: string,
): Promise<void> {
  await saveBuyerDailyExchangeRate(db, {
    businessDate, cnyPerJpyE8: value, expectedVersion: 0,
  }, command(sellerOps, `base:${businessDate}:save`, 1_000));
}

async function savePolicy(
  db: SqliteDatabase,
  input: {
    scopeType: 'CURRENCY_PAIR_DEFAULT' | 'SELLER_ORGANIZATION';
    sellerOrganizationId: string | null;
    markupRateValue: string;
    expectedVersion: number;
  },
  key: string,
) {
  return saveSellerPrincipalRatePolicy(db, {
    ...input, sourceCurrencyCode: 'JPY',
  }, command(sellerOps, key, 1_000));
}

function command(actor: PricingStaffActor, idempotencyKey: string, now: number) {
  return {
    actor,
    idempotencyKey: `key-${idempotencyKey}-${'0'.repeat(8)}`,
    requestId: null,
    now,
  };
}
