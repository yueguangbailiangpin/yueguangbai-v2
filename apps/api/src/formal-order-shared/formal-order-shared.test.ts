import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest';
import type {
  SqlAllResult,
  SqlDatabase,
  SqlRunResult,
  SqlStatement,
  StaffPermissionCode,
  StaffRoleCode,
} from '@ygb/contracts';
import {
  createMigratedTestDatabase,
  type SqliteDatabase,
} from '@ygb/testkit';
import { confirmFormalOrderForTest as confirmFormalOrder } from '../../test-support/confirm-formal-order-fixture';
import type { FormalOrderStaffActor } from './formal-order-shared';
import {
  bindPhase3GEvidenceFixture,
  seedPhase3GInstructionFixture,
} from '../../test-support/phase3g-test-fixtures';
import { approveOrderEvidenceAtomically } from '../order-evidence/approve-order-evidence';

const NOW = Date.UTC(2026, 7, 1, 0, 0, 0);
const BUSINESS_DATE = '2026-08-01';
const LONG_RUNNING_TEST_TIMEOUT_MS = 30_000;

let database: SqliteDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe('Phase 3F formal order confirmation', () => {
  it('atomically confirms a VERIFIED order and freezes all financial facts', async () => {
    database = createMigratedTestDatabase();
    await seedFormalOrderFixture(database);

    const result = await confirmFormalOrder(
      database,
      confirmationInput('evidence-submission-1'),
      command(preSalesActor(), 'formal-order:confirm:0001'),
    );

    expect(result).toMatchObject({
      status: 'CONFIRMED',
      version: 1,
      buyer_customer_no: '20260801E1',
      buyer_number_allocated: true,
      review_type: 'IMAGE',
      final_paid_jpy: '8880',
      confirmed_business_date: BUSINESS_DATE,
      replayed: false,
      financial_snapshot: {
        snapshot_version: 1,
        buyer_cny_per_jpy_e8: '5500000',
        service_fee_cny_fen: '2500',
        buyer_expected_principal_cny_fen: '48840',
        seller_expected_principal_cny_fen: '53280',
        rounding_rule: 'HALF_UP',
        seller_principal_rate_snapshot: {
          platform_order_date: '2026-08-01',
          base_rate_version_id: 'currency-buyer-rate-v1',
          base_rate_value: '5500000',
          markup_rate_value: '500000',
          final_rate_value: '6000000',
          rounding_rule: 'HALF_UP',
          seller_expected_principal_amount_minor: '53280',
        },
      },
    });

    const facts = await database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM formal_orders
          WHERE id=?) AS orders,
        (SELECT COUNT(*) FROM formal_order_financial_snapshots
          WHERE formal_order_id=?) AS snapshots,
        (SELECT COUNT(*) FROM formal_order_events
          WHERE formal_order_id=?) AS events,
        (SELECT status FROM order_evidence_submissions
          WHERE id='evidence-submission-1') AS evidence_status,
        (SELECT COUNT(*) FROM buyer_number_allocation_events
          WHERE buyer_customer_id='buyer-1') AS number_events,
        (SELECT next_sequence FROM buyer_channels
          WHERE id='buyer-channel-formal') AS next_sequence
    `).bind(
      result.formal_order_id,
      result.formal_order_id,
      result.formal_order_id,
    ).first<{
      orders: number;
      snapshots: number;
      events: number;
      evidence_status: string;
      number_events: number;
      next_sequence: number;
    }>();
    expect(facts).toEqual({
      orders: 1,
      snapshots: 1,
      events: 1,
      evidence_status: 'CONSUMED',
      number_events: 1,
      next_sequence: 2,
    });
  });

  it('requires VERIFIED evidence, APPROVED reservation, and expectedVersion', async () => {
    database = createMigratedTestDatabase();
    await seedFormalOrderFixture(database);

    database.exec(`
      UPDATE order_evidence_submissions
      SET status='CONSUMED', consumed_at=${NOW}, version=3, updated_at=${NOW}
      WHERE id='evidence-submission-1';
    `);
    await expect(confirmFormalOrder(
      database,
      confirmationInput('evidence-submission-1', 3),
      command(preSalesActor(), 'formal-order:state:not-verified'),
    )).rejects.toMatchObject({
      code: 'ORDER_EVIDENCE_STATE_CONFLICT',
      status: 409,
    });

    database.close();
    database = createMigratedTestDatabase();
    await seedFormalOrderFixture(database);
    database.exec(`
      UPDATE product_reservations
      SET status='CANCELLED', cancelled_at=${NOW}, version=3,
          updated_at=${NOW}
      WHERE id='reservation-formal-1';
    `);
    await expect(confirmFormalOrder(
      database,
      confirmationInput('evidence-submission-1'),
      command(preSalesActor(), 'formal-order:state:reservation'),
    )).rejects.toMatchObject({
      code: 'ORDER_EVIDENCE_STATE_CONFLICT',
      status: 409,
    });

    database.close();
    database = createMigratedTestDatabase();
    await seedFormalOrderFixture(database);
    await expect(confirmFormalOrder(
      database,
      confirmationInput('evidence-submission-1', 1),
      command(preSalesActor(), 'formal-order:state:version'),
    )).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
      status: 409,
    });
  }, LONG_RUNNING_TEST_TIMEOUT_MS);

  it('replays the same command and rejects an idempotency payload conflict', async () => {
    database = createMigratedTestDatabase();
    await seedFormalOrderFixture(database);
    const key = 'formal-order:idempotency:0001';

    const first = await confirmFormalOrder(
      database,
      confirmationInput('evidence-submission-1'),
      command(preSalesActor(), key),
    );
    const replay = await confirmFormalOrder(
      database,
      confirmationInput('evidence-submission-1'),
      command(preSalesActor(), key, NOW + 1),
    );
    expect(replay).toEqual({
      ...first,
      replayed: true,
    });

    await expect(confirmFormalOrder(
      database,
      confirmationInput('evidence-submission-1', 99),
      command(preSalesActor(), key, NOW + 2),
    )).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
      status: 409,
    });
  });

  it('allows at most one formal order per evidence and reservation', async () => {
    database = createMigratedTestDatabase();
    await seedFormalOrderFixture(database);
    await confirmFormalOrder(
      database,
      confirmationInput('evidence-submission-1'),
      command(preSalesActor(), 'formal-order:unique:first'),
    );

    await expect(confirmFormalOrder(
      database,
      confirmationInput('evidence-submission-1', 3),
      command(preSalesActor(), 'formal-order:unique:second'),
    )).rejects.toMatchObject({
      code: 'ORDER_EVIDENCE_STATE_CONFLICT',
      status: 409,
    });

    const counts = await database.prepare(`
      SELECT
        COUNT(*) AS orders,
        COUNT(DISTINCT order_evidence_submission_id) AS evidence_sources,
        COUNT(DISTINCT reservation_id) AS reservation_sources
      FROM formal_orders
    `).first<{
      orders: number;
      evidence_sources: number;
      reservation_sources: number;
    }>();
    expect(counts).toEqual({
      orders: 1,
      evidence_sources: 1,
      reservation_sources: 1,
    });
  });

  it('requires the exact China-business-date buyer rate and never falls back', async () => {
    database = createMigratedTestDatabase();
    await seedFormalOrderFixture(database);
    const nextDay = Date.UTC(2026, 7, 2, 0, 0, 0);

    await expect(confirmFormalOrder(
      database,
      confirmationInput('evidence-submission-1'),
      command(preSalesActor(), 'formal-order:rate:no-fallback', nextDay),
    )).rejects.toMatchObject({
      code: 'BUYER_DAILY_EXCHANGE_RATE_NOT_FOUND',
      status: 404,
    });

    await expectNoPartialFacts(database, 'evidence-submission-1');
  });

  it(
    'blocks confirmation when principal policy or Review Type fee is missing',
    { timeout: 20_000 },
    async () => {
    database = createMigratedTestDatabase();
    await seedFormalOrderFixture(database, { omitPrincipalPolicy: true });

    await expect(confirmFormalOrder(
      database,
      confirmationInput('evidence-submission-1'),
      command(preSalesActor(), 'formal-order:pricing:missing-rate'),
    )).rejects.toMatchObject({
      code: 'SELLER_PRINCIPAL_RATE_NOT_FOUND',
      status: 404,
    });
    await expectNoPartialFacts(database, 'evidence-submission-1');

    database.close();
    database = createMigratedTestDatabase();
    await seedFormalOrderFixture(database, { omitVideoServiceFee: true });
    await expect(confirmFormalOrder(
      database,
      confirmationInput('evidence-submission-3'),
      command(ownerActor(), 'formal-order:pricing:missing-fee'),
    )).rejects.toMatchObject({
      code: 'PRICING_RULE_NOT_FOUND',
      status: 404,
    });
    await expectNoPartialFacts(database, 'evidence-submission-3');
  });

  it('contains no legacy agreement-rate schema or financial projection', async () => {
    database = createMigratedTestDatabase();
    await seedFormalOrderFixture(database);

    const result = await confirmFormalOrder(
      database,
      confirmationInput('evidence-submission-1'),
      command(preSalesActor(), 'formal-order:principal-only'),
    );
    expect(result.financial_snapshot.seller_principal_rate_snapshot)
      .toMatchObject({
        policy_version_id: 'principal-policy-override-v1',
        final_rate_value: '6000000',
        seller_expected_principal_amount_minor: '53280',
      });
    expect(Object.keys(result.financial_snapshot).some(
      (key) => key.startsWith('seller_rate_')
        || key === 'seller_cny_per_jpy_e8',
    )).toBe(false);
    expect((await database.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_schema
      WHERE name LIKE '%seller_agreement%'
    `).first<{ count: number }>())).toEqual({ count: 0 });
  });

  it(
    'always requires an eligible principal policy without a runtime switch',
    { timeout: 20_000 },
    async () => {
    database = createMigratedTestDatabase();
    await seedFormalOrderFixture(database, { omitPrincipalPolicy: true });
    await expect(confirmFormalOrder(
      database,
      confirmationInput('evidence-submission-1'),
      command(preSalesActor(), 'formal-order:policy:missing'),
    )).rejects.toMatchObject({
      code: 'SELLER_PRINCIPAL_RATE_NOT_FOUND',
      status: 404,
    });
    expect(await database.prepare(
      `SELECT COUNT(*) AS count FROM formal_orders`,
    ).first<{ count: number }>()).toEqual({ count: 0 });

    database.close();
    database = createMigratedTestDatabase();
    await seedFormalOrderFixture(database);
    const enforcedResult = await confirmFormalOrder(
      database,
      confirmationInput('evidence-submission-1'),
      command(preSalesActor(), 'formal-order:policy:existing'),
    );
    expect(enforcedResult.financial_snapshot.seller_principal_rate_snapshot).toMatchObject({
      policy_version_id: 'principal-policy-override-v1',
      seller_expected_principal_amount_minor: '53280',
    });
  });

  it('leaves no formal financial facts when atomic approval cannot resolve an enforced principal policy', async () => {
    database = createMigratedTestDatabase();
    await seedFormalOrderFixture(database, {
      leaveEvidencePending: true,
      omitPrincipalPolicy: true,
    });
    seedAtomicApprovalWorkItem(database);

    await expect(approveOrderEvidenceAtomically(
      database,
      {
        submissionId: 'evidence-submission-1',
        expectedVersion: 1,
        priceMismatchAcknowledged: true,
        priceMismatchReason: 'fixture amount differs from reference',
      },
      {
        actor: atomicApprovalOwnerActor(),
        idempotencyKey: 'atomic-policy-switch:on-missing',
        requestId: 'request:atomic-policy-switch:on-missing',
        now: NOW,
      },
    )).rejects.toMatchObject({
      code: 'SELLER_PRINCIPAL_RATE_NOT_FOUND',
      status: 404,
    });

    expect(atomicApprovalFactCounts(database)).toEqual({
      orders: 0,
      financial_snapshots: 0,
      principal_snapshots: 0,
      principal_payables: 0,
      order_events: 0,
      audit_events: 0,
      outbox_events: 0,
    });
  });

  it('keeps atomic approval principal amounts identical across both snapshots and the payable', async () => {
    database = createMigratedTestDatabase();
    await seedFormalOrderFixture(database, { leaveEvidencePending: true });
    seedAtomicApprovalWorkItem(database);

    const result = await approveOrderEvidenceAtomically(
      database,
      {
        submissionId: 'evidence-submission-1',
        expectedVersion: 1,
        priceMismatchAcknowledged: true,
        priceMismatchReason: 'fixture amount differs from reference',
      },
      {
        actor: atomicApprovalOwnerActor(),
        idempotencyKey: 'atomic-policy-switch:on-existing',
        requestId: 'request:atomic-policy-switch:on-existing',
        now: NOW,
      },
    );

    expect(result.formalOrder.financial_snapshot).toMatchObject({
      seller_expected_principal_cny_fen: '53280',
      seller_principal_rate_snapshot: {
        policy_version_id: 'principal-policy-override-v1',
        seller_expected_principal_amount_minor: '53280',
      },
    });
    expect(database.raw.prepare(`
      SELECT
        financial.seller_expected_principal_cny_fen AS financial_amount,
        principal.seller_expected_principal_amount_minor AS principal_amount,
        payable.amount_cny_fen AS payable_amount
      FROM formal_orders formal_order
      JOIN formal_order_financial_snapshots financial
        ON financial.formal_order_id=formal_order.id
      JOIN seller_principal_rate_snapshots principal
        ON principal.formal_order_id=formal_order.id
      JOIN seller_payables payable
        ON payable.formal_order_id=formal_order.id
        AND payable.payable_type='SELLER_PRINCIPAL'
      WHERE formal_order.id=?
    `).get(result.formalOrder.formal_order_id)).toEqual({
      financial_amount: 53280,
      principal_amount: 53280,
      payable_amount: 53280,
    });
  });

  it.each([
    ['buyer rate', { binding: 12, value: 5_500_001 }, 'VALIDATION_ERROR', 400],
    ['service fee', { binding: 17, value: 2_501 }, 'VALIDATION_ERROR', 400],
    ['principal snapshot', { binding: 19, value: 53_281 }, 'VALIDATION_ERROR', 400],
    ['payment amount', { binding: 8, value: 8_881 }, 'VALIDATION_ERROR', 400],
    ['order date', { binding: 7, value: '2026-08-02' }, 'VALIDATION_ERROR', 400],
    ['currency', { sqlCurrency: true }, 'DEPENDENCY_UNAVAILABLE', 503],
    ['created timestamp', { binding: 20, value: NOW + 1 }, 'VALIDATION_ERROR', 400],
  ] as const)('rejects a marketplace snapshot with mismatched %s', async (
    _label,
    mutation,
    code,
    status,
  ) => {
    database = createMigratedTestDatabase();
    await seedFormalOrderFixture(database, { leaveEvidencePending: true });
    seedAtomicApprovalWorkItem(database);
    const tampered = new MarketplaceSnapshotTamperDatabase(database, mutation);

    await expect(approveOrderEvidenceAtomically(
      tampered,
      {
        submissionId: 'evidence-submission-1',
        expectedVersion: 1,
        priceMismatchAcknowledged: true,
        priceMismatchReason: 'fixture amount differs from reference',
      },
      {
        actor: atomicApprovalOwnerActor(),
        idempotencyKey: `atomic-guard:${_label}`,
        now: NOW,
      },
    )).rejects.toMatchObject({ code, status });
    await expectNoPartialFacts(database, 'evidence-submission-1');
  });

  it('resolves the service fee by seller organization and Review Type', async () => {
    database = createMigratedTestDatabase();
    await seedFormalOrderFixture(database);

    const result = await confirmFormalOrder(
      database,
      confirmationInput('evidence-submission-2'),
      command(preSalesActor(), 'formal-order:fee:text'),
    );
    expect(result.review_type).toBe('TEXT');
    expect(result.financial_snapshot).toMatchObject({
      service_fee_version_id: 'service-fee-text-v1',
      service_fee_cny_fen: '1800',
    });
  });

  it('uses integer fixed-point HALF_UP rounding at the half-fen boundary', async () => {
    database = createMigratedTestDatabase();
    await seedFormalOrderFixture(database, {
      finalPaidJpy: 1,
      buyerRateE8: 5_500_000,
      sellerRateE8: 5_400_000,
    });

    const result = await confirmFormalOrder(
      database,
      confirmationInput('evidence-submission-1'),
      command(preSalesActor(), 'formal-order:rounding:half-up'),
    );
    expect(result.financial_snapshot).toMatchObject({
      buyer_expected_principal_cny_fen: '6',
      seller_expected_principal_cny_fen: '6',
      rounding_rule: 'HALF_UP',
    });
  });

  it('preserves an existing historical buyer number without a second allocation', async () => {
    database = createMigratedTestDatabase();
    await seedFormalOrderFixture(database);

    const result = await confirmFormalOrder(
      database,
      confirmationInput('evidence-submission-3'),
      command(ownerActor(), 'formal-order:number:existing'),
    );
    expect(result).toMatchObject({
      buyer_customer_id: 'buyer-existing',
      buyer_customer_no: '20260731E99',
      buyer_number_allocated: false,
    });

    const state = await database.prepare(`
      SELECT
        buyer_customer_no,
        buyer_sequence,
        first_valid_order_business_date,
        version,
        (SELECT COUNT(*) FROM buyer_number_allocation_events
          WHERE buyer_customer_id='buyer-existing') AS events
      FROM buyer_customers
      WHERE id='buyer-existing'
    `).first<{
      buyer_customer_no: string;
      buyer_sequence: number;
      first_valid_order_business_date: string;
      version: number;
      events: number;
    }>();
    expect(state).toEqual({
      buyer_customer_no: '20260731E99',
      buyer_sequence: 99,
      first_valid_order_business_date: '2026-07-31',
      version: 1,
      events: 0,
    });
  });

  it('never allocates two buyer numbers during concurrent first orders', async () => {
    database = createMigratedTestDatabase();
    await seedFormalOrderFixture(database);

    await Promise.allSettled([
      confirmFormalOrder(
        database,
        confirmationInput('evidence-submission-1'),
        command(preSalesActor(), 'formal-order:concurrent:one'),
      ),
      confirmFormalOrder(
        database,
        confirmationInput('evidence-submission-2'),
        command(preSalesActor(), 'formal-order:concurrent:two'),
      ),
    ]);

    const state = await database.prepare(`
      SELECT
        buyer_customer_no,
        buyer_sequence,
        (SELECT COUNT(*) FROM buyer_number_allocation_events
          WHERE buyer_customer_id='buyer-1') AS allocation_events,
        (SELECT COUNT(*) FROM formal_orders
          WHERE buyer_customer_id='buyer-1') AS orders
      FROM buyer_customers
      WHERE id='buyer-1'
    `).first<{
      buyer_customer_no: string | null;
      buyer_sequence: number | null;
      allocation_events: number;
      orders: number;
    }>();
    expect(state?.buyer_customer_no).toBe('20260801E1');
    expect(state?.buyer_sequence).toBe(1);
    expect(state?.allocation_events).toBe(1);
    expect((state?.orders ?? 0) >= 1).toBe(true);
  });

  it('rejects a second formal order for an already claimed Amazon order number', async () => {
    database = createMigratedTestDatabase();
    await seedFormalOrderFixture(database, { duplicateAmazonOrder: true });

    const first = await confirmFormalOrder(
      database,
      confirmationInput('evidence-submission-1'),
      command(preSalesActor(), 'formal-order:duplicate:one'),
    );
    await expect(confirmFormalOrder(
      database,
      confirmationInput('evidence-submission-2'),
      command(preSalesActor(), 'formal-order:duplicate:two'),
    )).rejects.toMatchObject({
      code: 'ORDER_EVIDENCE_STATE_CONFLICT',
      status: 409,
    });

    const count = await database.prepare(`
      SELECT COUNT(*) AS value
      FROM formal_orders
      WHERE amazon_order_number_normalized=?
    `).bind(first.amazon_order_number).first<{ value: number }>();
    expect(Number(count?.value)).toBe(1);
  });

  it('does not rewrite snapshots after product or store status changes', async () => {
    database = createMigratedTestDatabase();
    await seedFormalOrderFixture(database);
    const result = await confirmFormalOrder(
      database,
      confirmationInput('evidence-submission-1'),
      command(preSalesActor(), 'formal-order:snapshot:stable'),
    );

    database.exec(`
      UPDATE products
      SET status='DISABLED', disabled_at=${NOW + 10},
          version=version+1, updated_at=${NOW + 10}
      WHERE id='product-formal-1';
      UPDATE seller_stores
      SET status='DISABLED', disabled_at=${NOW + 10},
          version=version+1, updated_at=${NOW + 10}
      WHERE id='store-formal';
    `);

    const frozen = await database.prepare(`
      SELECT
        formal_order.asin_normalized,
        formal_order.product_name_snapshot,
        snapshot.buyer_cny_per_jpy_e8,
        principal.final_rate_value AS seller_principal_final_rate_value,
        snapshot.service_fee_cny_fen
      FROM formal_orders formal_order
      JOIN formal_order_financial_snapshots snapshot
        ON snapshot.formal_order_id=formal_order.id
      JOIN seller_principal_rate_snapshots principal
        ON principal.formal_order_id=formal_order.id
      WHERE formal_order.id=?
    `).bind(result.formal_order_id).first<{
      asin_normalized: string;
      product_name_snapshot: string;
      buyer_cny_per_jpy_e8: number;
      seller_principal_final_rate_value: number;
      service_fee_cny_fen: number;
    }>();
    expect(frozen).toEqual({
      asin_normalized: 'B0FORM0001',
      product_name_snapshot: '正式订单产品一',
      buyer_cny_per_jpy_e8: 5_500_000,
      seller_principal_final_rate_value: 6_000_000,
      service_fee_cny_fen: 2500,
    });
  });

  it('makes formal orders, snapshots, and events immutable', async () => {
    database = createMigratedTestDatabase();
    await seedFormalOrderFixture(database);
    const result = await confirmFormalOrder(
      database,
      confirmationInput('evidence-submission-1'),
      command(preSalesActor(), 'formal-order:immutable'),
    );

    await expect(database.prepare(`
      UPDATE formal_orders SET status='CONFIRMED' WHERE id=?
    `).bind(result.formal_order_id).run()).rejects.toThrow(
      'formal_orders_are_immutable',
    );
    await expect(database.prepare(`
      DELETE FROM formal_order_financial_snapshots
      WHERE formal_order_id=?
    `).bind(result.formal_order_id).run()).rejects.toThrow(
      'formal_order_financial_snapshots_are_immutable',
    );
    await expect(database.prepare(`
      UPDATE seller_principal_rate_snapshots
      SET final_rate_value=1
      WHERE formal_order_id=?
    `).bind(result.formal_order_id).run()).rejects.toThrow(
      'seller_principal_rate_snapshots_are_immutable',
    );
    await expect(database.prepare(`
      INSERT INTO seller_principal_rate_snapshots
      SELECT formal_order_id, platform_order_date, payment_amount_minor,
        payment_currency_code, base_rate_version_id, ? AS base_rate_business_date,
        base_rate_confirmed_at, base_rate_value, base_rate_scale,
        policy_version_id, policy_scope_type, policy_seller_organization_id,
        policy_version_no, policy_effective_from, policy_confirmed_at,
        markup_rate_value, markup_rate_scale, final_rate_value, final_rate_scale,
        rounding_rule, seller_expected_principal_amount_minor, created_at
      FROM seller_principal_rate_snapshots WHERE formal_order_id=?
    `).bind('2026-08-02', result.formal_order_id).run()).rejects.toThrow(
      'seller_principal_rate_snapshot_source_mismatch',
    );
    await expect(database.prepare(`
      INSERT INTO seller_principal_rate_snapshots
      SELECT formal_order_id, platform_order_date, payment_amount_minor,
        payment_currency_code, base_rate_version_id, base_rate_business_date,
        base_rate_confirmed_at, base_rate_value, base_rate_scale,
        policy_version_id, policy_scope_type, policy_seller_organization_id,
        policy_version_no, policy_effective_from, policy_confirmed_at,
        markup_rate_value, markup_rate_scale, final_rate_value, final_rate_scale,
        rounding_rule, seller_expected_principal_amount_minor + 1, created_at
      FROM seller_principal_rate_snapshots WHERE formal_order_id=?
    `).bind(result.formal_order_id).run()).rejects.toThrow(
      'seller_principal_rate_snapshot_source_mismatch',
    );
    await database.prepare(`
      INSERT INTO seller_organizations (
        id, marketplace_code, seller_code, origin_channel_id, current_channel_id,
        seller_sequence, organization_name, status, version, created_at,
        updated_at, activated_at, disabled_at, next_member_number
      ) SELECT 'seller-org-other', marketplace_code, 'other-seller-000001',
        origin_channel_id, current_channel_id, seller_sequence + 1, '其他卖家',
        status, version, created_at, updated_at, activated_at, disabled_at,
        next_member_number FROM seller_organizations WHERE id='seller-org-formal'
    `).run();
    await expect(database.prepare(`
      INSERT INTO seller_principal_rate_snapshots
      SELECT formal_order_id, platform_order_date, payment_amount_minor,
        payment_currency_code, base_rate_version_id, base_rate_business_date,
        base_rate_confirmed_at, base_rate_value, base_rate_scale,
        policy_version_id, policy_scope_type, 'seller-org-other',
        policy_version_no, policy_effective_from, policy_confirmed_at,
        markup_rate_value, markup_rate_scale, final_rate_value, final_rate_scale,
        rounding_rule, seller_expected_principal_amount_minor, created_at
      FROM seller_principal_rate_snapshots WHERE formal_order_id=?
    `).bind(result.formal_order_id).run()).rejects.toThrow(
      'seller_principal_rate_snapshot_source_mismatch',
    );
    await expect(database.prepare(`
      DELETE FROM seller_principal_rate_snapshots
      WHERE formal_order_id=?
    `).bind(result.formal_order_id).run()).rejects.toThrow(
      'seller_principal_rate_snapshots_are_immutable',
    );
    await expect(database.prepare(`
      UPDATE formal_order_events SET next_status='CONFIRMED'
      WHERE formal_order_id=?
    `).bind(result.formal_order_id).run()).rejects.toThrow(
      'formal_order_events_are_immutable',
    );
  });

  it('rolls back order, number, snapshot, event, and CONSUMED status on failure', async () => {
    database = createMigratedTestDatabase();
    await seedFormalOrderFixture(database);
    database.exec(`
      CREATE TRIGGER trg_phase3f_test_snapshot_failure
      BEFORE INSERT ON formal_order_financial_snapshots
      BEGIN
        SELECT RAISE(ABORT, 'phase3f_test_snapshot_failure');
      END;
    `);

    await expect(confirmFormalOrder(
      database,
      confirmationInput('evidence-submission-1'),
      command(preSalesActor(), 'formal-order:rollback'),
    )).rejects.toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE',
      status: 503,
    });
    await expectNoPartialFacts(database, 'evidence-submission-1');
  });

  it('allows owner/pre_sales with ORDER_CONFIRM and rejects every other actor or deny', async () => {
    database = createMigratedTestDatabase();
    await seedFormalOrderFixture(database);

    await expect(confirmFormalOrder(
      database,
      confirmationInput('evidence-submission-1'),
      command(otherActor(), 'formal-order:permission:other'),
    )).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    await expect(confirmFormalOrder(
      database,
      confirmationInput('evidence-submission-1'),
      command(preSalesDeniedActor(), 'formal-order:permission:deny'),
    )).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });

    const ownerResult = await confirmFormalOrder(
      database,
      confirmationInput('evidence-submission-3'),
      command(ownerActor(), 'formal-order:permission:owner'),
    );
    expect(ownerResult.status).toBe('CONFIRMED');
  });

  it('contains no comment, refund, settlement, or profit facts', async () => {
    database = createMigratedTestDatabase();
    await seedFormalOrderFixture(database);
    const tables = await database.prepare(`
      SELECT name
      FROM sqlite_schema
      WHERE type='table'
        AND name IN (
          'formal_order_reviews',
          'buyer_refunds',
          'seller_settlements',
          'formal_order_profits'
        )
    `).all();
    expect(tables.results).toEqual([]);

    for (const table of [
      'formal_orders',
      'formal_order_financial_snapshots',
    ]) {
      const columns = await database.prepare(
        `PRAGMA table_info(${table})`,
      ).all<{ name: string }>();
      const names = new Set(columns.results.map((column) => column.name));
      for (const forbidden of [
        'review_status',
        'refund_status',
        'settlement_status',
        'profit_cny_fen',
        'realized_profit_cny_fen',
      ]) {
        expect(names.has(forbidden)).toBe(false);
      }
    }
  });
});

function confirmationInput(
  orderEvidenceSubmissionId: string,
  expectedVersion = 2,
) {
  return {
    orderEvidenceSubmissionId,
    expectedVersion,
  };
}

function command(
  actor: FormalOrderStaffActor,
  idempotencyKey: string,
  now = NOW,
) {
  return {
    actor,
    idempotencyKey,
    requestId: `request:${idempotencyKey}`,
    now,
  };
}

function actor(
  roles: readonly StaffRoleCode[],
  permissions: readonly StaffPermissionCode[],
  staffId: string,
): FormalOrderStaffActor {
  return {
    staffId,
    displayName: staffId,
    roles,
    permissions: new Set(permissions),
  };
}

type SnapshotMutation = Readonly<{
  binding?: number;
  value?: unknown;
  sqlCurrency?: boolean;
}>;

class MarketplaceSnapshotTamperDatabase implements SqlDatabase {
  constructor(
    private readonly target: SqlDatabase,
    private readonly mutation: SnapshotMutation,
  ) {}

  prepare(sql: string): SqlStatement {
    if (!sql.includes('INSERT INTO formal_order_marketplace_money_snapshots')) {
      return this.target.prepare(sql);
    }
    const preparedSql = this.mutation.sqlCurrency === true
      ? sql.replaceAll("'JPY'", "'USD'")
      : sql;
    return new MarketplaceSnapshotTamperStatement(
      this.target.prepare(preparedSql),
      this.mutation,
    );
  }

  batch(statements: readonly SqlStatement[]): Promise<SqlRunResult[]> {
    return this.target.batch(statements);
  }
}

class MarketplaceSnapshotTamperStatement implements SqlStatement {
  constructor(
    private readonly target: SqlStatement,
    private readonly mutation: SnapshotMutation,
  ) {}

  bind(...values: unknown[]): SqlStatement {
    const changed = [...values];
    if (this.mutation.binding !== undefined) {
      changed[this.mutation.binding] = this.mutation.value;
    }
    return this.target.bind(...changed);
  }

  first<T = Record<string, unknown>>(): Promise<T | null> {
    return this.target.first<T>();
  }

  all<T = Record<string, unknown>>(): Promise<SqlAllResult<T>> {
    return this.target.all<T>();
  }

  run(): Promise<SqlRunResult> {
    return this.target.run();
  }
}

function preSalesActor(): FormalOrderStaffActor {
  return actor(['pre_sales'], ['ORDER_CONFIRM'], 'staff-pre-sales');
}

function preSalesDeniedActor(): FormalOrderStaffActor {
  return actor(['pre_sales'], [], 'staff-pre-sales');
}

function ownerActor(): FormalOrderStaffActor {
  return actor(['owner'], ['ORDER_CONFIRM'], 'staff-owner');
}

function atomicApprovalOwnerActor(): FormalOrderStaffActor {
  return actor(
    ['owner'],
    ['ORDER_CONFIRM'],
    'zz-phase3h-test-owner',
  );
}

function otherActor(): FormalOrderStaffActor {
  return actor(['seller_ops'], ['ORDER_CONFIRM'], 'staff-other');
}

async function expectNoPartialFacts(
  db: SqliteDatabase,
  submissionId: string,
): Promise<void> {
  const state = await db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM formal_orders) AS orders,
      (SELECT COUNT(*) FROM formal_order_financial_snapshots) AS snapshots,
      (SELECT COUNT(*) FROM formal_order_events) AS events,
      (SELECT COUNT(*) FROM buyer_number_allocation_events
        WHERE buyer_customer_id='buyer-1') AS number_events,
      (SELECT buyer_customer_no FROM buyer_customers
        WHERE id='buyer-1') AS buyer_number,
      (SELECT next_sequence FROM buyer_channels
        WHERE id='buyer-channel-formal') AS next_sequence,
      (SELECT status FROM order_evidence_submissions
        WHERE id=?) AS evidence_status
  `).bind(submissionId).first<{
    orders: number;
    snapshots: number;
    events: number;
    number_events: number;
    buyer_number: string | null;
    next_sequence: number;
    evidence_status: string;
  }>();
  expect(state).toEqual({
    orders: 0,
    snapshots: 0,
    events: 0,
    number_events: 0,
    buyer_number: null,
    next_sequence: 1,
    evidence_status: 'PENDING_VERIFICATION',
  });
}

async function seedFormalOrderFixture(
  db: SqliteDatabase,
  options: {
    finalPaidJpy?: number;
    buyerRateE8?: number;
    sellerRateE8?: number;
    omitPrincipalPolicy?: boolean;
    duplicateAmazonOrder?: boolean;
    omitVideoServiceFee?: boolean;
    leaveEvidencePending?: boolean;
  } = {},
): Promise<void> {
  const finalPaidJpy = options.finalPaidJpy ?? 8880;
  const buyerRateE8 = options.buyerRateE8 ?? 5_500_000;
  const sellerRateE8 = options.sellerRateE8 ?? 6_000_000;
  const policyOverrideMarkupE8 = Math.max(0, sellerRateE8 - buyerRateE8);
  const secondOrder = options.duplicateAmazonOrder
    ? '123-1234567-1234567'
    : '456-1234567-1234567';
  const principalPolicySql = options.omitPrincipalPolicy
    ? ''
    : `
    INSERT INTO seller_principal_rate_policy_versions (
      id, scope_type, seller_organization_id, source_currency_code,
      quote_currency_code, version_no, status, markup_rate_value, rate_scale,
      effective_from, submitted_by_staff_id, submitted_at, decision_version,
      confirmed_by_staff_id, confirmed_at, rejected_by_staff_id, rejected_at,
      rejection_reason
    ) VALUES (
      'principal-policy-default-v1', 'CURRENCY_PAIR_DEFAULT', NULL, 'JPY',
      'CNY', 1, 'SUBMITTED', 400000, 100000000, 3000,
      'staff-owner', 1000, 1, NULL, NULL, NULL, NULL, NULL
    );
    INSERT INTO seller_principal_rate_policy_versions (
      id, scope_type, seller_organization_id, source_currency_code,
      quote_currency_code, version_no, status, markup_rate_value, rate_scale,
      effective_from, submitted_by_staff_id, submitted_at, decision_version,
      confirmed_by_staff_id, confirmed_at, rejected_by_staff_id, rejected_at,
      rejection_reason
    ) VALUES (
      'principal-policy-override-v1', 'SELLER_ORGANIZATION', 'seller-org-formal', 'JPY',
      'CNY', 1, 'SUBMITTED', ${policyOverrideMarkupE8}, 100000000, 3000,
      'staff-owner', 1000, 1, NULL, NULL, NULL, NULL, NULL
    );
    UPDATE seller_principal_rate_policy_versions
    SET status='CONFIRMED', decision_version=2,
        confirmed_by_staff_id='staff-owner', confirmed_at=2000
    WHERE id IN ('principal-policy-default-v1', 'principal-policy-override-v1');
  `;

  db.exec(`
    INSERT INTO staff_users (
      id, display_name, status, authorization_version,
      version, created_at, updated_at, disabled_at
    ) VALUES
      ('staff-pre-sales', '售前', 'ACTIVE', 1, 1, 1000, 1000, NULL),
      ('staff-owner', '负责人', 'ACTIVE', 1, 1, 1000, 1000, NULL),
      ('staff-other', '其他角色', 'ACTIVE', 1, 1, 1000, 1000, NULL);

    INSERT INTO seller_organizations (
      id, marketplace_code, seller_code,
      origin_channel_id, current_channel_id,
      seller_sequence, organization_name, status,
      version, created_at, updated_at,
      activated_at, disabled_at, next_member_number
    ) VALUES (
      'seller-org-formal', 'JP', 'ido-mango-9201',
      'seller-channel-ido-mango', 'seller-channel-ido-mango',
      9201, '正式订单测试卖家', 'ACTIVE',
      1, 1000, 1000, 1000, NULL, 2
    );

    INSERT INTO customer_identity_subjects (
      id, subject_type, created_at
    ) VALUES
      ('seller-formal-subject', 'SELLER_ORG_MEMBER', 1000),
      ('buyer-formal-subject-1', 'BUYER_CUSTOMER', 1000),
      ('buyer-formal-subject-existing', 'BUYER_CUSTOMER', 1000);

    INSERT INTO seller_organization_members (
      id, identity_subject_id, organization_id,
      member_number, username_fallback, display_name,
      role, primary_owner, status, version,
      created_at, updated_at, activated_at, disabled_at
    ) VALUES (
      'seller-formal-owner', 'seller-formal-subject',
      'seller-org-formal', 1, 'ido-mango-9201-1',
      '负责人', 'OWNER', 1, 'ACTIVE', 1,
      1000, 1000, 1000, NULL
    );

    INSERT INTO buyer_channels (
      id, code, name, status, next_sequence, version,
      created_at, updated_at, disabled_at
    ) VALUES (
      'buyer-channel-formal', 'E', '正式订单测试渠道',
      'ACTIVE', 1, 1, 1000, 1000, NULL
    );

    INSERT INTO buyer_customers (
      id, identity_subject_id, marketplace_code,
      buyer_channel_id, buyer_customer_no,
      buyer_sequence, first_valid_order_business_date,
      display_name, access_status,
      identity_review_status, version,
      created_at, updated_at, activated_at, disabled_at
    ) VALUES
      (
        'buyer-1', 'buyer-formal-subject-1', 'JP',
        'buyer-channel-formal', NULL, NULL, NULL,
        '首次下单买家', 'ACTIVE', 'CLEAR', 1,
        1000, 1000, 1000, NULL
      ),
      (
        'buyer-existing', 'buyer-formal-subject-existing', 'JP',
        'buyer-channel-formal', '20260731E99', 99, '2026-07-31',
        '历史编号买家', 'ACTIVE', 'CLEAR', 1,
        1000, 1000, 1000, NULL
      );

    INSERT INTO seller_stores (
      id, organization_id, marketplace_code,
      display_name, normalized_name, status,
      version, created_at, updated_at, disabled_at
    ) VALUES (
      'store-formal', 'seller-org-formal', 'JP',
      '正式订单测试店铺', '正式订单测试店铺', 'ACTIVE',
      1, 1000, 1000, NULL
    );

    INSERT INTO products (
      id, organization_id, store_id, marketplace_code,
      asin_display, asin_normalized, status,
      current_version_no, version,
      created_at, updated_at, disabled_at
    ) VALUES
      ('product-formal-1', 'seller-org-formal', 'store-formal', 'JP',
       'B0FORM0001', 'B0FORM0001', 'ACTIVE', 1, 1, 1000, 1000, NULL),
      ('product-formal-2', 'seller-org-formal', 'store-formal', 'JP',
       'B0FORM0002', 'B0FORM0002', 'ACTIVE', 1, 1, 1000, 1000, NULL),
      ('product-formal-3', 'seller-org-formal', 'store-formal', 'JP',
       'B0FORM0003', 'B0FORM0003', 'ACTIVE', 1, 1, 1000, 1000, NULL);

    INSERT INTO product_versions (
      id, product_id, version_no, product_name,
      search_keywords_json, product_url,
      buyer_visible_notes, internal_notes,
      created_by_staff_id, created_at
    ,
          ordering_guide_expected_amount_jpy,
          color_spec_mode) VALUES
      ('product-formal-1-v1', 'product-formal-1', 1,
       '正式订单产品一', '[]', NULL, NULL, NULL, 'staff-pre-sales', 1000,
          1980, 'MAIN_IMAGE_VARIANT'),
      ('product-formal-2-v1', 'product-formal-2', 1,
       '正式订单产品二', '[]', NULL, NULL, NULL, 'staff-pre-sales', 1000,
          1980, 'MAIN_IMAGE_VARIANT'),
      ('product-formal-3-v1', 'product-formal-3', 1,
       '正式订单产品三', '[]', NULL, NULL, NULL, 'staff-pre-sales', 1000,
          1980, 'MAIN_IMAGE_VARIANT');

    INSERT INTO demand_batches (
      id, organization_id, store_id, marketplace_code,
      product_id, product_version_no,
      submitted_by_member_id, task_type,
      target_quantity, buyer_visible_notes, seller_notes,
      open_at, reservation_deadline, order_deadline,
      status, review_reason, close_reason,
      reviewed_by_staff_id, closed_by_staff_id,
      version, submitted_at, updated_at,
      reviewed_at, published_at, withdrawn_at, closed_at,
      held_reservation_count, approved_reservation_count
    ) VALUES
      ('demand-formal-1', 'seller-org-formal', 'store-formal', 'JP',
       'product-formal-1', 1, 'seller-formal-owner', 'IMAGE',
       10, NULL, NULL, 2000, 5000, 20000,
       'PUBLISHED', NULL, NULL, 'staff-pre-sales', NULL,
       2, 1000, 3000, 3000, 3000, NULL, NULL, 0, 1),
      ('demand-formal-2', 'seller-org-formal', 'store-formal', 'JP',
       'product-formal-2', 1, 'seller-formal-owner', 'TEXT',
       10, NULL, NULL, 2000, 5000, 20000,
       'PUBLISHED', NULL, NULL, 'staff-pre-sales', NULL,
       2, 1000, 3000, 3000, 3000, NULL, NULL, 0, 1),
      ('demand-formal-3', 'seller-org-formal', 'store-formal', 'JP',
       'product-formal-3', 1, 'seller-formal-owner', 'VIDEO',
       10, NULL, NULL, 2000, 5000, 20000,
       'PUBLISHED', NULL, NULL, 'staff-pre-sales', NULL,
       2, 1000, 3000, 3000, 3000, NULL, NULL, 0, 1);

    INSERT INTO product_reservations (
      id, demand_batch_id, buyer_customer_id,
      organization_id, store_id, product_id,
      product_version_no, marketplace_code,
      status, precheck_snapshot_json,
      hold_expires_at, order_deadline_snapshot,
      version, submitted_at, updated_at,
      decided_by_staff_id, decision_reason, decided_at,
      cancelled_at, expired_at, reopened_count,
      buyer_self_pay_bps_snapshot,
      reference_order_amount_jpy_snapshot,
      estimated_self_pay_jpy_snapshot,
      estimated_refundable_principal_jpy_snapshot,
      buyer_self_pay_accepted_at,
      buyer_self_pay_accepted_demand_version
    ) VALUES
      ('reservation-formal-1', 'demand-formal-1', 'buyer-1',
       'seller-org-formal', 'store-formal', 'product-formal-1', 1, 'JP',
       'APPROVED', '{}', 5000, 20000, 2, 4000, 6000,
       'staff-pre-sales', NULL, 6000, NULL, NULL, 0,
       0, 1980, 0, 1980, 4000, 2),
      ('reservation-formal-2', 'demand-formal-2', 'buyer-1',
       'seller-org-formal', 'store-formal', 'product-formal-2', 1, 'JP',
       'APPROVED', '{}', 5000, 20000, 2, 4000, 6000,
       'staff-pre-sales', NULL, 6000, NULL, NULL, 0,
       0, 1980, 0, 1980, 4000, 2),
      ('reservation-formal-3', 'demand-formal-3', 'buyer-existing',
       'seller-org-formal', 'store-formal', 'product-formal-3', 1, 'JP',
       'APPROVED', '{}', 5000, 20000, 2, 4000, 6000,
       'staff-pre-sales', NULL, 6000, NULL, NULL, 0,
       0, 1980, 0, 1980, 4000, 2);
  `);

  const instructionOne = await seedPhase3GInstructionFixture(db, {
    suffix: 'formal-1',
    reservationId: 'reservation-formal-1',
    buyerCustomerId: 'buyer-1',
    productId: 'product-formal-1',
    productVersionId: 'product-formal-1-v1',
    staffId: 'staff-pre-sales',
  });
  const instructionTwo = await seedPhase3GInstructionFixture(db, {
    suffix: 'formal-2',
    reservationId: 'reservation-formal-2',
    buyerCustomerId: 'buyer-1',
    productId: 'product-formal-2',
    productVersionId: 'product-formal-2-v1',
    staffId: 'staff-pre-sales',
  });
  const instructionThree = await seedPhase3GInstructionFixture(db, {
    suffix: 'formal-3',
    reservationId: 'reservation-formal-3',
    buyerCustomerId: 'buyer-existing',
    productId: 'product-formal-3',
    productVersionId: 'product-formal-3-v1',
    staffId: 'staff-pre-sales',
  });

  db.exec(`

    INSERT INTO order_evidence_submissions (
      id, reservation_id, buyer_customer_id, marketplace_code,
      status, current_version_no, version,
      public_change_reason, internal_review_note,
      submitted_at, updated_at,
      verified_by_staff_id, verified_at,
      withdrawn_at, consumed_at, created_at
    ) VALUES
      ('evidence-submission-1', 'reservation-formal-1', 'buyer-1', 'JP',
       'PENDING_VERIFICATION', 1, 1, NULL, NULL,
       7000, 7000, NULL, NULL, NULL, NULL, 7000),
      ('evidence-submission-2', 'reservation-formal-2', 'buyer-1', 'JP',
       'PENDING_VERIFICATION', 1, 1, NULL, NULL,
       7000, 7000, NULL, NULL, NULL, NULL, 7000),
      ('evidence-submission-3', 'reservation-formal-3', 'buyer-existing', 'JP',
       'PENDING_VERIFICATION', 1, 1, NULL, NULL,
       7000, 7000, NULL, NULL, NULL, NULL, 7000);

    INSERT INTO order_evidence_versions (
      id, submission_id, reservation_id, buyer_customer_id,
      marketplace_code, version_no,
      amazon_order_number_raw, amazon_order_number_normalized,
      amazon_order_date,
      final_paid_jpy, submitted_by_buyer_id, buyer_note,
      order_instruction_id, order_instruction_version_id,
      instruction_deadline_snapshot,
      reference_order_amount_jpy_snapshot,
      buyer_self_pay_bps_snapshot, buyer_self_pay_jpy,
      buyer_refundable_principal_jpy, price_mismatch,
      price_difference_jpy, submitted_before_deadline,
      evidence_file_object_id, created_at
    ) VALUES
      ('evidence-version-1', 'evidence-submission-1',
       'reservation-formal-1', 'buyer-1', 'JP', 1,
       '123-1234567-1234567', '123-1234567-1234567',
       '2026-08-01',
       ${finalPaidJpy}, 'buyer-1', NULL,
       '${instructionOne.instructionId}',
       '${instructionOne.instructionVersionId}',
       ${instructionOne.deadlineAt}, 1980, 0, 0, ${finalPaidJpy},
       ${Number(finalPaidJpy !== 1980)}, ${finalPaidJpy - 1980}, 1,
       '${instructionOne.evidenceFileObjectId}', 7000),
      ('evidence-version-2', 'evidence-submission-2',
       'reservation-formal-2', 'buyer-1', 'JP', 1,
       '${secondOrder}', '${secondOrder}',
       '2026-08-01',
       ${finalPaidJpy}, 'buyer-1', NULL,
       '${instructionTwo.instructionId}',
       '${instructionTwo.instructionVersionId}',
       ${instructionTwo.deadlineAt}, 1980, 0, 0, ${finalPaidJpy},
       ${Number(finalPaidJpy !== 1980)}, ${finalPaidJpy - 1980}, 1,
       '${instructionTwo.evidenceFileObjectId}', 7000),
      ('evidence-version-3', 'evidence-submission-3',
       'reservation-formal-3', 'buyer-existing', 'JP', 1,
       '789-1234567-1234567', '789-1234567-1234567',
       '2026-08-01',
       ${finalPaidJpy}, 'buyer-existing', NULL,
       '${instructionThree.instructionId}',
       '${instructionThree.instructionVersionId}',
       ${instructionThree.deadlineAt}, 1980, 0, 0, ${finalPaidJpy},
       ${Number(finalPaidJpy !== 1980)}, ${finalPaidJpy - 1980}, 1,
       '${instructionThree.evidenceFileObjectId}', 7000);

    ${options.leaveEvidencePending ? '' : `
      UPDATE order_evidence_submissions
      SET status='VERIFIED', version=2,
          verified_by_staff_id='staff-pre-sales',
          verified_at=8000, updated_at=8000
      WHERE id IN (
        'evidence-submission-1',
        'evidence-submission-2',
        'evidence-submission-3'
      );
    `}

    INSERT INTO buyer_daily_exchange_rates (
      id, business_date, version_no, status, cny_per_jpy_e8,
      submitted_by_staff_id, submitted_at, decision_version,
      confirmed_by_staff_id, confirmed_at,
      rejected_by_staff_id, rejected_at, rejection_reason
    ) VALUES (
      'buyer-rate-v1', '${BUSINESS_DATE}', 1, 'SUBMITTED', ${buyerRateE8},
      'staff-owner', 1000, 1, NULL, NULL, NULL, NULL, NULL
    );
    UPDATE buyer_daily_exchange_rates
    SET status='CONFIRMED', decision_version=2,
        confirmed_by_staff_id='staff-owner', confirmed_at=2000
    WHERE id='buyer-rate-v1';

    ${principalPolicySql}

  `);

  await bindPhase3GEvidenceFixture(db, {
    suffix: 'formal-1',
    submissionId: 'evidence-submission-1',
    evidenceVersionId: 'evidence-version-1',
    reservationId: 'reservation-formal-1',
    buyerCustomerId: 'buyer-1',
    evidenceFileObjectId: instructionOne.evidenceFileObjectId,
    amazonOrderNumber: '123-1234567-1234567',
  });
  await bindPhase3GEvidenceFixture(db, {
    suffix: 'formal-2',
    submissionId: 'evidence-submission-2',
    evidenceVersionId: 'evidence-version-2',
    reservationId: 'reservation-formal-2',
    buyerCustomerId: 'buyer-1',
    evidenceFileObjectId: instructionTwo.evidenceFileObjectId,
    amazonOrderNumber: secondOrder,
    createClaim: !options.duplicateAmazonOrder,
  });
  await bindPhase3GEvidenceFixture(db, {
    suffix: 'formal-3',
    submissionId: 'evidence-submission-3',
    evidenceVersionId: 'evidence-version-3',
    reservationId: 'reservation-formal-3',
    buyerCustomerId: 'buyer-existing',
    evidenceFileObjectId: instructionThree.evidenceFileObjectId,
    amazonOrderNumber: '789-1234567-1234567',
  });

  seedConfirmedServiceFee(db, 'IMAGE', 'service-fee-image-v1', 2500);
  seedConfirmedServiceFee(db, 'TEXT', 'service-fee-text-v1', 1800);
  if (!options.omitVideoServiceFee) {
    seedConfirmedServiceFee(db, 'VIDEO', 'service-fee-video-v1', 3500);
  }
}

function seedAtomicApprovalWorkItem(db: SqliteDatabase): void {
  db.exec(`
    INSERT INTO buyer_staff_assignments (
      id, buyer_customer_id, duty_code, staff_id, status, source,
      assigned_by_actor_type, assigned_by_actor_id, reason, version,
      created_at, updated_at, revoked_at
    ) VALUES (
      'atomic-buyer-assignment', 'buyer-1', 'BUYER_PRE_SALES_OWNER',
      'zz-phase3h-test-owner', 'ACTIVE', 'OWNER_FALLBACK',
      'SYSTEM', NULL, NULL, 1, 7000, 7000, NULL
    );
    INSERT INTO staff_work_items (
      id, work_type, source_entity_type, source_entity_id,
      buyer_customer_id, seller_organization_id, store_id,
      duty_code, fixed_assignment_type, fixed_assignment_id,
      assigned_staff_id, status, version, created_at, updated_at,
      completed_at, cancelled_at
    ) VALUES (
      'atomic-evidence-work-item', 'ORDER_EVIDENCE_REVIEW',
      'ORDER_EVIDENCE', 'evidence-submission-1', 'buyer-1',
      'seller-org-formal', 'store-formal', 'BUYER_PRE_SALES_OWNER',
      'BUYER', 'atomic-buyer-assignment', 'zz-phase3h-test-owner',
      'OPEN', 1, 7000, 7000, NULL, NULL
    );
  `);
}

function atomicApprovalFactCounts(db: SqliteDatabase) {
  return db.raw.prepare(`
    SELECT
      (SELECT COUNT(*) FROM formal_orders) AS orders,
      (SELECT COUNT(*) FROM formal_order_financial_snapshots)
        AS financial_snapshots,
      (SELECT COUNT(*) FROM seller_principal_rate_snapshots)
        AS principal_snapshots,
      (SELECT COUNT(*) FROM seller_payables
        WHERE payable_type='SELLER_PRINCIPAL') AS principal_payables,
      (SELECT COUNT(*) FROM formal_order_events) AS order_events,
      (SELECT COUNT(*) FROM audit_events) AS audit_events,
      (SELECT COUNT(*) FROM integration_outbox) AS outbox_events
  `).get();
}

function seedConfirmedServiceFee(
  db: SqliteDatabase,
  reviewType: 'RATING' | 'TEXT' | 'IMAGE' | 'VIDEO',
  id: string,
  feeCnyFen: number,
): void {
  db.exec(`
    INSERT INTO seller_service_fee_versions (
      id, organization_id, review_type, version_no,
      status, fee_cny_fen, effective_from,
      submitted_by_staff_id, submitted_at, decision_version,
      confirmed_by_staff_id, confirmed_at,
      rejected_by_staff_id, rejected_at, rejection_reason
    ) VALUES (
      '${id}', 'seller-org-formal', '${reviewType}', 1,
      'SUBMITTED', ${feeCnyFen}, 3000,
      'staff-owner', 1000, 1, NULL, NULL, NULL, NULL, NULL
    );
    UPDATE seller_service_fee_versions
    SET status='CONFIRMED', decision_version=2,
        confirmed_by_staff_id='staff-owner', confirmed_at=2000
    WHERE id='${id}';
  `);
}
