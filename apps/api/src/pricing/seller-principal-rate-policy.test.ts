import { afterEach, describe, expect, it } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import {
  confirmBuyerDailyExchangeRate,
  submitBuyerDailyExchangeRate,
} from './buyer-daily-exchange-rates';
import {
  confirmSellerPrincipalRatePolicy,
  readSellerPrincipalRatePolicies,
  resolveSellerPrincipalRateSnapshot,
  submitSellerPrincipalRatePolicy,
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

describe('seller principal rate policy', () => {
  it('reads the GLOBAL default target without Seller Organization master data', async () => {
    database = createMigratedTestDatabase();
    expect(await readSellerPrincipalRatePolicies(database, {
      sourceCurrencyCode: 'JPY', sellerOrganizationId: null, at: 5_000,
    })).toEqual({
      source_currency_code: 'JPY', quote_currency_code: 'CNY',
      seller_organization_id: null,
      default_policy: null, seller_override_policy: null,
      default_pending_policy: null, seller_override_pending_policy: null,
      default_upcoming_policy: null, seller_override_upcoming_policy: null,
      default_next_version: 1, seller_override_next_version: null,
      selected_policy: null,
    });
  });

  it('uses the order-date base rate plus the absolute default markup', async () => {
    database = fixture();
    await seedBaseRate(database, '2026-08-01', '5100000');
    // P1-B: the currency-pair default is confirmed inside the submission
    // transaction, so no second Owner decision step exists.
    const submitted = await submitPolicy(database, {
      scopeType: 'CURRENCY_PAIR_DEFAULT', sellerOrganizationId: null,
      markupRateValue: '0.004', expectedVersion: 0, effectiveFrom: 3_000,
    }, 'policy:default:submit');
    expect(submitted).toMatchObject({
      status: 'CONFIRMED', decision_version: 2, confirmed_at: 1_000,
    });

    const resolved = await resolveSellerPrincipalRateSnapshot(database, {
      sellerOrganizationId: 'seller-org-1', platformOrderDate: '2026-08-01',
      paymentAmountMinor: 100, paymentCurrencyCode: 'JPY', at: 5_000,
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
    await submitPolicy(database, {
      scopeType: 'CURRENCY_PAIR_DEFAULT', sellerOrganizationId: null,
      markupRateValue: '0.004', expectedVersion: 0, effectiveFrom: 3_000,
    }, 'policy:zero:default:submit');
    const override = await submitPolicy(database, {
      scopeType: 'SELLER_ORGANIZATION', sellerOrganizationId: 'seller-org-1',
      markupRateValue: '0', expectedVersion: 0, effectiveFrom: 3_000,
    }, 'policy:zero:override:submit');
    await confirmSellerPrincipalRatePolicy(
      database, { policyVersionId: override.policy_version_id, expectedVersion: 1 },
      command(owner, 'policy:zero:override:confirm', 2_000),
    );

    const resolved = await resolveSellerPrincipalRateSnapshot(database, {
      sellerOrganizationId: 'seller-org-1', platformOrderDate: '2026-08-01',
      paymentAmountMinor: 100, paymentCurrencyCode: 'JPY', at: 5_000,
    });
    expect(resolved).toMatchObject({
      markup_rate_value: '0', final_rate_value: '5100000',
      seller_expected_principal_amount_minor: '510',
      policy_scope_type: 'SELLER_ORGANIZATION',
    });
  });

  it('honors future effective boundaries, exact date lookup, idempotency, and fail-closed missing rates', async () => {
    database = fixture();
    await seedBaseRate(database, '2026-08-01', '5100000');
    const first = await submitPolicy(database, {
      scopeType: 'CURRENCY_PAIR_DEFAULT', sellerOrganizationId: null,
      markupRateValue: '0.004', expectedVersion: 0, effectiveFrom: 10_000,
    }, 'policy:future:submit');
    expect(first.status).toBe('CONFIRMED');
    const replay = await submitSellerPrincipalRatePolicy(database, {
      scopeType: 'CURRENCY_PAIR_DEFAULT', sellerOrganizationId: null,
      sourceCurrencyCode: 'JPY', markupRateValue: '0.004',
      expectedVersion: 0, effectiveFrom: 10_000,
    }, command(sellerOps, 'policy:future:submit', 1_100));
    expect(replay).toMatchObject({
      policy_version_id: first.policy_version_id, replayed: true,
      status: 'CONFIRMED',
    });
    // Base-rate fallback (0073): 2026-08-02 has no own rate, so the snapshot
    // resolves the 2026-08-01 confirmed rate and records that business date.
    const fallback = await resolveSellerPrincipalRateSnapshot(database, {
      sellerOrganizationId: 'seller-org-1', platformOrderDate: '2026-08-02',
      paymentAmountMinor: 100, paymentCurrencyCode: 'JPY', at: 12_000,
    });
    expect(fallback).toMatchObject({
      base_rate_business_date: '2026-08-01',
      base_rate_value: '5100000',
      final_rate_value: '5500000',
    });
    await expect(submitSellerPrincipalRatePolicy(database, {
      scopeType: 'CURRENCY_PAIR_DEFAULT', sellerOrganizationId: null,
      sourceCurrencyCode: 'JPY', markupRateValue: '0',
      expectedVersion: 0, effectiveFrom: 20_000,
    }, command(sellerOps, 'policy:race', 12_000))).rejects.toMatchObject({
      code: 'VERSION_CONFLICT', status: 409,
    });
  });

  it('rejects a default submission whose effective time already passed', async () => {
    database = fixture();
    await expect(submitPolicy(database, {
      scopeType: 'CURRENCY_PAIR_DEFAULT', sellerOrganizationId: null,
      markupRateValue: '0.004', expectedVersion: 0, effectiveFrom: 1_000,
    }, 'policy:default:past')).rejects.toMatchObject({
      code: 'PRICING_RULE_EFFECTIVE_TIME_CONFLICT', status: 409,
    });
  });

  it('surfaces the next confirmed change separately from the effective one', async () => {
    database = fixture();
    await submitPolicy(database, {
      scopeType: 'CURRENCY_PAIR_DEFAULT', sellerOrganizationId: null,
      markupRateValue: '0.004', expectedVersion: 0, effectiveFrom: 3_000,
    }, 'policy:upcoming:first');
    await submitPolicy(database, {
      scopeType: 'CURRENCY_PAIR_DEFAULT', sellerOrganizationId: null,
      markupRateValue: '0.006', expectedVersion: 1, effectiveFrom: 8_000,
    }, 'policy:upcoming:second');
    const read = await readSellerPrincipalRatePolicies(database, {
      sourceCurrencyCode: 'JPY', sellerOrganizationId: null, at: 5_000,
    });
    expect(read.default_policy).toMatchObject({
      markup_rate_value: '400000', effective_from: 3_000,
    });
    expect(read.default_upcoming_policy).toMatchObject({
      markup_rate_value: '600000', effective_from: 8_000,
    });
  });

  it('blocks the submitter from deciding their own organization override', async () => {
    database = fixture();
    const override = await submitSellerPrincipalRatePolicy(database, {
      scopeType: 'SELLER_ORGANIZATION', sellerOrganizationId: 'seller-org-1',
      sourceCurrencyCode: 'JPY', markupRateValue: '0.002',
      expectedVersion: 0, effectiveFrom: 3_000,
    }, command(owner, 'policy:self-decide:submit', 1_000));
    await expect(confirmSellerPrincipalRatePolicy(
      database, { policyVersionId: override.policy_version_id, expectedVersion: 1 },
      command(owner, 'policy:self-decide:confirm', 2_000),
    )).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });

  it('does not allow seller portal actors to write policy', async () => {
    database = fixture();
    await expect(submitSellerPrincipalRatePolicy(database, {
      scopeType: 'CURRENCY_PAIR_DEFAULT', sellerOrganizationId: null,
      sourceCurrencyCode: 'JPY', markupRateValue: '0.004',
      expectedVersion: 0, effectiveFrom: 3_000,
    }, { ...command({ ...sellerOps, roles: ['buyer_refund'] }, 'policy:denied', 1_000) }))
      .rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });

  it('rejects direct SQL policy/event tampering and duplicate pending rows', async () => {
    database = fixture();
    const pending = await submitPolicy(database, {
      scopeType: 'CURRENCY_PAIR_DEFAULT', sellerOrganizationId: null,
      markupRateValue: '0.004', expectedVersion: 0, effectiveFrom: 3_000,
    }, 'policy:db-guard:submit');
    const event = await database.prepare(
      `SELECT id FROM seller_principal_rate_policy_events WHERE version_id=?`,
    ).bind(pending.policy_version_id).first<{ id: string }>();

    await expect(database.prepare(`
      UPDATE seller_principal_rate_policy_versions SET markup_rate_value=1 WHERE id=?
    `).bind(pending.policy_version_id).run()).rejects.toThrow(
      'seller_principal_rate_policy_decision_transition_denied',
    );
    await expect(database.prepare(
      `DELETE FROM seller_principal_rate_policy_versions WHERE id=?`,
    ).bind(pending.policy_version_id).run()).rejects.toThrow(
      'seller_principal_rate_policy_versions_are_immutable',
    );
    await expect(database.prepare(`
      INSERT INTO seller_principal_rate_policy_versions (
        id, scope_type, seller_organization_id, source_currency_code,
        quote_currency_code, version_no, status, markup_rate_value, rate_scale,
        effective_from, submitted_by_staff_id, submitted_at, decision_version,
        confirmed_by_staff_id, confirmed_at, rejected_by_staff_id, rejected_at,
        rejection_reason
      ) VALUES ('direct-initial-confirmed', 'CURRENCY_PAIR_DEFAULT', NULL, 'JPY',
        'CNY', 2, 'CONFIRMED', 400000, 100000000, 4000,
        'staff-seller-ops', 1000, 2, 'staff-owner', 2000, NULL, NULL, NULL)
    `).run()).rejects.toThrow(
      'seller_principal_rate_policy_initial_state_must_be_submitted',
    );
    await expect(database.prepare(
      `UPDATE seller_principal_rate_policy_events SET reason='tampered' WHERE id=?`,
    ).bind(event?.id).run()).rejects.toThrow(
      'seller_principal_rate_policy_events_are_immutable',
    );
    await expect(database.prepare(
      `DELETE FROM seller_principal_rate_policy_events WHERE id=?`,
    ).bind(event?.id).run()).rejects.toThrow(
      'seller_principal_rate_policy_events_are_immutable',
    );
    await expect(database.prepare(`
      INSERT INTO seller_principal_rate_policy_events (
        id, version_id, scope_type, seller_organization_id, source_currency_code,
        quote_currency_code, version_no, event_type, actor_staff_id,
        previous_status, next_status, markup_rate_value, effective_from,
        reason, idempotency_key, created_at
      ) VALUES ('direct-bad-event', ?, 'CURRENCY_PAIR_DEFAULT', NULL, 'JPY', 'CNY',
        1, 'SELLER_PRINCIPAL_RATE_POLICY_SUBMITTED', 'staff-seller-ops',
        'SUBMITTED', 'SUBMITTED', 400000, 3000, NULL, 'direct-bad-event-key', 1000)
    `).bind(pending.policy_version_id).run()).rejects.toThrow(
      /CHECK|constraint|source_mismatch/iu,
    );
    await expect(database.prepare(`
      INSERT INTO seller_principal_rate_policy_versions (
        id, scope_type, seller_organization_id, source_currency_code,
        quote_currency_code, version_no, status, markup_rate_value, rate_scale,
        effective_from, submitted_by_staff_id, submitted_at, decision_version,
        confirmed_by_staff_id, confirmed_at, rejected_by_staff_id, rejected_at,
        rejection_reason
      ) VALUES ('direct-pending-duplicate', 'CURRENCY_PAIR_DEFAULT', NULL, 'JPY',
        'CNY', 2, 'SUBMITTED', 0, 100000000, 5000,
        'staff-seller-ops', 1000, 1, NULL, NULL, NULL, NULL, NULL)
    `).run()).resolves.toBeTruthy();
    await expect(database.prepare(`
      INSERT INTO seller_principal_rate_policy_versions (
        id, scope_type, seller_organization_id, source_currency_code,
        quote_currency_code, version_no, status, markup_rate_value, rate_scale,
        effective_from, submitted_by_staff_id, submitted_at, decision_version,
        confirmed_by_staff_id, confirmed_at, rejected_by_staff_id, rejected_at,
        rejection_reason
      ) VALUES ('direct-pending-duplicate-2', 'CURRENCY_PAIR_DEFAULT', NULL, 'JPY',
        'CNY', 3, 'SUBMITTED', 0, 100000000, 6000,
        'staff-seller-ops', 1000, 1, NULL, NULL, NULL, NULL, NULL)
    `).run()).rejects.toThrow(/seller_principal_rate_policy_pending|UNIQUE/iu);
  });

  it('rejects a duplicate confirmed effective boundary at the database boundary', async () => {
    database = fixture();
    await submitPolicy(database, {
      scopeType: 'CURRENCY_PAIR_DEFAULT', sellerOrganizationId: null,
      markupRateValue: '0.004', expectedVersion: 0, effectiveFrom: 3_000,
    }, 'policy:db-effective:first');
    await expect(submitPolicy(database, {
      scopeType: 'CURRENCY_PAIR_DEFAULT', sellerOrganizationId: null,
      markupRateValue: '0.005', expectedVersion: 1, effectiveFrom: 3_000,
    }, 'policy:db-effective:second')).rejects.toMatchObject({
      code: 'PRICING_RULE_EFFECTIVE_TIME_CONFLICT', status: 409,
    });
  });

  it('serializes concurrent submissions so only one pending version is created', async () => {
    database = fixture();
    const results = await Promise.allSettled([
      submitPolicy(database, {
        scopeType: 'CURRENCY_PAIR_DEFAULT', sellerOrganizationId: null,
        markupRateValue: '0.004', expectedVersion: 0, effectiveFrom: 3_000,
      }, 'policy:concurrent:a'),
      submitPolicy(database, {
        scopeType: 'CURRENCY_PAIR_DEFAULT', sellerOrganizationId: null,
        markupRateValue: '0.005', expectedVersion: 0, effectiveFrom: 4_000,
      }, 'policy:concurrent:b'),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({
      status: 'rejected', reason: expect.objectContaining({ status: 409 }),
    });
    expect(await database.prepare(`
      SELECT COUNT(*) AS count FROM seller_principal_rate_policy_versions
      WHERE scope_type='CURRENCY_PAIR_DEFAULT' AND status='CONFIRMED'
    `).first()).toEqual({ count: 1 });
  });
});

async function submitPolicy(
  db: SqliteDatabase,
  input: {
    scopeType: 'CURRENCY_PAIR_DEFAULT' | 'SELLER_ORGANIZATION';
    sellerOrganizationId: string | null;
    markupRateValue: string;
    expectedVersion: number;
    effectiveFrom: number;
  },
  key: string,
) {
  return submitSellerPrincipalRatePolicy(db, {
    ...input, sourceCurrencyCode: 'JPY',
  }, command(sellerOps, key, 1_000));
}

async function seedBaseRate(
  db: SqliteDatabase,
  businessDate: string,
  value: string,
): Promise<void> {
  const submitted = await submitBuyerDailyExchangeRate(db, {
    businessDate, cnyPerJpyE8: value, expectedVersion: 0,
  }, command(sellerOps, `base:${businessDate}:submit`, 1_000));
  await confirmBuyerDailyExchangeRate(db, {
    rateId: submitted.rate_id, expectedVersion: 1,
  }, command(owner, `base:${businessDate}:confirm`, 2_000));
}

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
      'seller-org-1', 'JP', 'ido-mango-000001', 'seller-channel-ido-mango',
      'seller-channel-ido-mango', 1, '测试卖家', 'ACTIVE', 1, 1, 1, 1, NULL, 2
    );
  `);
  return db;
}

function command(
  actor: PricingStaffActor,
  idempotencyKey: string,
  now: number,
) {
  return { actor, idempotencyKey, requestId: `${idempotencyKey}:request`, now };
}
