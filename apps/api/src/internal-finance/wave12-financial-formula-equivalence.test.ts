import { afterEach, describe, expect, it } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import {
  attributedCashNet,
  completedGrossProfit,
  projectedGrossProfit,
} from '@ygb/domain';

type FinanceFacts = {
  id: string;
  sellerExpectedPrincipalCnyFen: bigint;
  serviceFeeCnyFen: bigint;
  buyerExpectedPrincipalCnyFen: bigint;
  sellerAllocationGrossCnyFen: bigint;
  sellerAllocationReversalCnyFen: bigint;
  buyerRefundPaymentGrossCnyFen: bigint;
  buyerRefundPaymentReversalCnyFen: bigint;
};

type FinancePosition = {
  formal_order_id: string;
  projected_gross_profit_cny_fen: string | null;
  completed_gross_profit_cny_fen: string | null;
  attributed_cash_net_cny_fen: string;
  buyer_refund_outstanding_cny_fen: string;
  buyer_refund_overpaid_cny_fen: string;
  finance_status: string;
};

const STAFF_ID = 'zz-phase3h-test-owner';
const AT = 1_700_000_000_000;
const HASH = 'a'.repeat(64);
const EXACT_INTEGER_BOUNDARY_RESULT = '9007199254740993';

let database: SqliteDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe('Wave 12 financial formulas execute against the production SQL view', () => {
  it('matches domain formulas for zero, partial, reversal, overpayment, and integer-boundary facts', () => {
    database = createFormulaFixtureDatabase();
    expect(database.raw.prepare(`
      SELECT schema_version FROM app_schema_state WHERE singleton_id=1
    `).get()).toMatchObject({ schema_version: 75 });
    expect(database.raw.prepare('PRAGMA foreign_keys').get())
      .toMatchObject({ foreign_keys: 1 });
    for (const trigger of [
      'trg_formal_order_source_guard',
      'trg_formal_order_instruction_guard',
      'trg_formal_order_financial_snapshot_guard',
      'trg_formal_order_financial_self_pay_guard',
    ]) {
      expect(database.raw.prepare(`
        SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name=?
      `).get(trigger)).toBeDefined();
    }
    const cases: readonly FinanceFacts[] = [
      {
        id: 'zero',
        sellerExpectedPrincipalCnyFen: 0n,
        serviceFeeCnyFen: 0n,
        buyerExpectedPrincipalCnyFen: 0n,
        sellerAllocationGrossCnyFen: 0n,
        sellerAllocationReversalCnyFen: 0n,
        buyerRefundPaymentGrossCnyFen: 0n,
        buyerRefundPaymentReversalCnyFen: 0n,
      },
      {
        id: 'partial',
        sellerExpectedPrincipalCnyFen: 1_000n,
        serviceFeeCnyFen: 100n,
        buyerExpectedPrincipalCnyFen: 700n,
        sellerAllocationGrossCnyFen: 350n,
        sellerAllocationReversalCnyFen: 0n,
        buyerRefundPaymentGrossCnyFen: 250n,
        buyerRefundPaymentReversalCnyFen: 0n,
      },
      {
        id: 'reversal',
        sellerExpectedPrincipalCnyFen: 500n,
        serviceFeeCnyFen: 100n,
        buyerExpectedPrincipalCnyFen: 300n,
        sellerAllocationGrossCnyFen: 250n,
        sellerAllocationReversalCnyFen: 100n,
        buyerRefundPaymentGrossCnyFen: 200n,
        buyerRefundPaymentReversalCnyFen: 50n,
      },
      {
        id: 'overpayment',
        sellerExpectedPrincipalCnyFen: 400n,
        serviceFeeCnyFen: 50n,
        buyerExpectedPrincipalCnyFen: 200n,
        sellerAllocationGrossCnyFen: 400n,
        sellerAllocationReversalCnyFen: 0n,
        buyerRefundPaymentGrossCnyFen: 250n,
        buyerRefundPaymentReversalCnyFen: 0n,
      },
      {
        id: 'integer-boundary',
        sellerExpectedPrincipalCnyFen: 9_007_199_254_740_991n,
        serviceFeeCnyFen: 2n,
        buyerExpectedPrincipalCnyFen: 0n,
        sellerAllocationGrossCnyFen: 9_007_199_254_740_991n,
        sellerAllocationReversalCnyFen: 0n,
        buyerRefundPaymentGrossCnyFen: 0n,
        buyerRefundPaymentReversalCnyFen: 0n,
      },
    ];
    for (const facts of cases) seedFinanceFacts(database, facts);
    expect(database.raw.prepare('PRAGMA foreign_key_check').all()).toEqual([]);

    const positions = database.raw.prepare(`
      SELECT formal_order_id, projected_gross_profit_cny_fen,
        completed_gross_profit_cny_fen, attributed_cash_net_cny_fen,
        buyer_refund_outstanding_cny_fen, buyer_refund_overpaid_cny_fen,
        finance_status
      FROM internal_order_finance_positions
      WHERE formal_order_id LIKE 'formula-%'
      ORDER BY formal_order_id
    `).all() as FinancePosition[];

    expect(positions).toHaveLength(cases.length);
    for (const facts of cases) {
      const position = positions.find((row) => row.formal_order_id === `formula-${facts.id}`);
      expect(position).toBeDefined();
      expect(position?.finance_status).toBe('COMPLETED');
      expect(position?.projected_gross_profit_cny_fen).toBe(String(
        projectedGrossProfit({
          sellerExpectedPrincipalCnyFen: String(facts.sellerExpectedPrincipalCnyFen),
          serviceFeeCnyFen: String(facts.serviceFeeCnyFen),
          buyerExpectedPrincipalCnyFen: String(facts.buyerExpectedPrincipalCnyFen),
        }),
      ));
      expect(position?.completed_gross_profit_cny_fen).toBe(String(
        completedGrossProfit({
          sellerPrincipalPayableCnyFen: String(facts.sellerExpectedPrincipalCnyFen),
          sellerServiceFeePayableCnyFen: String(facts.serviceFeeCnyFen),
          buyerRefundDueCnyFen: String(facts.buyerExpectedPrincipalCnyFen),
        }),
      ));
      expect(position?.attributed_cash_net_cny_fen).toBe(String(
        attributedCashNet({
          sellerAllocatedNetCnyFen: String(
            facts.sellerAllocationGrossCnyFen - facts.sellerAllocationReversalCnyFen,
          ),
          buyerRefundNetPaidCnyFen: String(
            facts.buyerRefundPaymentGrossCnyFen
              - facts.buyerRefundPaymentReversalCnyFen,
          ),
        }),
      ));
    }

    const boundaryFacts = cases.find((facts) => facts.id === 'integer-boundary');
    if (boundaryFacts === undefined) throw new Error('integer_boundary_fixture_missing');
    expect(BigInt(EXACT_INTEGER_BOUNDARY_RESULT))
      .toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));
    expect(String(projectedGrossProfit({
      sellerExpectedPrincipalCnyFen: String(boundaryFacts.sellerExpectedPrincipalCnyFen),
      serviceFeeCnyFen: String(boundaryFacts.serviceFeeCnyFen),
      buyerExpectedPrincipalCnyFen: String(boundaryFacts.buyerExpectedPrincipalCnyFen),
    }))).toBe(EXACT_INTEGER_BOUNDARY_RESULT);
    expect(String(completedGrossProfit({
      sellerPrincipalPayableCnyFen: String(boundaryFacts.sellerExpectedPrincipalCnyFen),
      sellerServiceFeePayableCnyFen: String(boundaryFacts.serviceFeeCnyFen),
      buyerRefundDueCnyFen: String(boundaryFacts.buyerExpectedPrincipalCnyFen),
    }))).toBe(EXACT_INTEGER_BOUNDARY_RESULT);
    expect(positions.find((row) => row.formal_order_id === 'formula-integer-boundary'))
      .toMatchObject({
        projected_gross_profit_cny_fen: EXACT_INTEGER_BOUNDARY_RESULT,
        completed_gross_profit_cny_fen: EXACT_INTEGER_BOUNDARY_RESULT,
      });

    expect(positions.find((row) => row.formal_order_id === 'formula-partial'))
      .toMatchObject({
        projected_gross_profit_cny_fen: '400',
        completed_gross_profit_cny_fen: '400',
        attributed_cash_net_cny_fen: '100',
        buyer_refund_outstanding_cny_fen: '450',
        buyer_refund_overpaid_cny_fen: '0',
      });
    expect(positions.find((row) => row.formal_order_id === 'formula-reversal'))
      .toMatchObject({
        projected_gross_profit_cny_fen: '300',
        completed_gross_profit_cny_fen: '300',
        attributed_cash_net_cny_fen: '0',
        buyer_refund_outstanding_cny_fen: '150',
        buyer_refund_overpaid_cny_fen: '0',
      });
    expect(positions.find((row) => row.formal_order_id === 'formula-overpayment'))
      .toMatchObject({
        projected_gross_profit_cny_fen: '250',
        completed_gross_profit_cny_fen: '250',
        attributed_cash_net_cny_fen: '150',
        buyer_refund_outstanding_cny_fen: '0',
        buyer_refund_overpaid_cny_fen: '50',
      });
  });
});

function createFormulaFixtureDatabase(): SqliteDatabase {
  const fixture = createMigratedTestDatabase();
  fixture.raw.prepare(`
    INSERT INTO buyer_daily_exchange_rates (
      id, business_date, version_no, status, cny_per_jpy_e8, submitted_by_staff_id,
      submitted_at, decision_version, confirmed_by_staff_id, confirmed_at,
      rejected_by_staff_id, rejected_at, rejection_reason
    ) VALUES ('formula-buyer-rate', '2023-11-14', 1, 'SUBMITTED', 1, ?, ?, 1,
      NULL, NULL, NULL, NULL, NULL)
  `).run(STAFF_ID, AT - 1);
  fixture.raw.prepare(`
    UPDATE buyer_daily_exchange_rates
    SET status='CONFIRMED', decision_version=2, confirmed_by_staff_id=?, confirmed_at=?
    WHERE id='formula-buyer-rate'
  `).run(STAFF_ID, AT);
  return fixture;
}

function seedFinanceFacts(database: SqliteDatabase, facts: FinanceFacts): void {
  const prefix = `formula-${facts.id}`;
  const snapshotId = `${prefix}-snapshot`;
  const caseId = `${prefix}-review`;
  const evidenceId = `${prefix}-evidence`;
  const dueEventId = `${prefix}-refund-due`;
  const principalPayableId = `${prefix}-principal`;
  const feePayableId = `${prefix}-fee`;
  const refundObligationId = `${prefix}-refund`;
  const orderNumber = `100-0000000-${String(
    ['zero', 'partial', 'reversal', 'overpayment', 'integer-boundary'].indexOf(facts.id) + 1,
  ).padStart(7, '0')}`;
  const raw = database.raw;

  seedLegalFormalOrderSources(database, facts, {
    prefix,
    orderNumber,
  });

  raw.prepare(`
    INSERT INTO formal_orders (
      id, order_evidence_submission_id, order_evidence_version_id,
      reservation_id, demand_batch_id, buyer_customer_id, buyer_customer_no,
      seller_organization_id, store_id, marketplace_code, product_id,
      product_version_id, product_version_no, asin_display, asin_normalized,
      product_name_snapshot, review_type, amazon_order_number_raw,
      amazon_order_number_normalized, final_paid_jpy, status, version,
      confirmed_by_staff_id, confirmed_at, confirmed_business_date, created_at,
      amazon_order_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'JP', ?, ?, 1, ?, ?, 'Formula fixture',
      'TEXT', ?, ?, ?, 'CONFIRMED', 1, ?,
      ?, '2023-11-14', ?, '2023-11-14')
  `).run(
    prefix, `${prefix}-submission`, `${prefix}-order-evidence`,
    `${prefix}-reservation`, `${prefix}-demand`, `${prefix}-buyer`,
    `P20231114F${['zero', 'partial', 'reversal', 'overpayment', 'integer-boundary']
      .indexOf(facts.id) + 1}`, `${prefix}-seller`, `${prefix}-store`,
    `${prefix}-product`, `${prefix}-product-version`, formulaAsin(facts.id),
    formulaAsin(facts.id), orderNumber, orderNumber,
    facts.sellerExpectedPrincipalCnyFen, STAFF_ID, AT, AT,
  );
  raw.prepare(`
    INSERT INTO formal_order_financial_snapshots (
      id, formal_order_id, snapshot_version, buyer_rate_version_id,
      buyer_rate_version_no, buyer_rate_business_date, buyer_rate_confirmed_at,
      buyer_cny_per_jpy_e8, service_fee_version_id, service_fee_version_no,
      service_fee_effective_from, service_fee_confirmed_at, service_fee_cny_fen,
      buyer_expected_principal_cny_fen, seller_expected_principal_cny_fen,
      rounding_rule, created_at
    ) VALUES (?, ?, 1, ?, 1, '2023-11-14', ?, 1, ?, 1, ?, ?, ?, ?, ?,
      'HALF_UP', ?)
  `).run(
    snapshotId, prefix, 'formula-buyer-rate', AT, `${prefix}-fee-version`,
    AT - 1, AT - 2, facts.serviceFeeCnyFen, facts.buyerExpectedPrincipalCnyFen,
    facts.sellerExpectedPrincipalCnyFen, AT,
  );
  raw.prepare(`
    INSERT INTO review_cases (
      id, formal_order_id, buyer_customer_id, seller_organization_id,
      review_type, status, current_evidence_version_no, version,
      public_change_reason, internal_review_note, submitted_at, updated_at,
      decided_by_staff_id, decided_at, withdrawn_at, created_at
    ) VALUES (?, ?, ?, ?, 'TEXT', 'PENDING_REVIEW', 1, 1, NULL, NULL, ?, ?,
      NULL, NULL, NULL, ?)
  `).run(caseId, prefix, `${prefix}-buyer`, `${prefix}-seller`, AT, AT, AT);
  raw.prepare(`
    INSERT INTO review_evidence_versions (
      id, review_case_id, formal_order_id, version_no, review_type,
      submitted_by_buyer_id, buyer_note, created_at, review_url
    ) VALUES (?, ?, ?, 1, 'TEXT', ?, NULL, ?, 'https://example.test/review')
  `).run(evidenceId, caseId, prefix, `${prefix}-buyer`, AT);
  raw.prepare(`
    UPDATE review_cases
    SET status='APPROVED', version=2, updated_at=?, decided_by_staff_id=?,
      decided_at=?
    WHERE id=?
  `).run(AT + 1, STAFF_ID, AT + 1, caseId);

  for (const [eventType, amount, snapshot] of [
    ['REVIEW_APPROVED', null, null],
    ['BUYER_REFUND_BECAME_DUE', facts.buyerExpectedPrincipalCnyFen, snapshotId],
    ['SELLER_SERVICE_FEE_ACCRUED', facts.serviceFeeCnyFen, snapshotId],
  ] as const) {
    raw.prepare(`
      INSERT INTO review_events (
        id, review_case_id, formal_order_id, evidence_version_id, event_type,
        actor_type, actor_id, previous_status, next_status, case_version,
        amount_cny_fen, formal_order_financial_snapshot_id, public_reason,
        internal_note, metadata_json, idempotency_key, created_at
      ) VALUES (?, ?, ?, ?, ?, 'STAFF', ?, 'PENDING_REVIEW', 'APPROVED', 2,
        ?, ?, NULL, NULL, '{}', ?, ?)
    `).run(
      eventType === 'REVIEW_APPROVED' ? `${prefix}-approved`
        : eventType === 'BUYER_REFUND_BECAME_DUE' ? dueEventId : `${prefix}-fee-due`,
      caseId, prefix, evidenceId, eventType, STAFF_ID, amount, snapshot,
      `${prefix}-${eventType.toLowerCase()}`, AT + 1,
    );
  }
  raw.prepare(`
    INSERT INTO buyer_refund_obligations (
      id, source_review_event_id, review_case_id, formal_order_id,
      buyer_customer_id, due_amount_cny_fen, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    refundObligationId, dueEventId, caseId, prefix, `${prefix}-buyer`,
    facts.buyerExpectedPrincipalCnyFen, AT + 1, AT + 1,
  );
  raw.prepare(`
    INSERT INTO seller_payables (
      id, seller_organization_id, formal_order_id, payable_type,
      amount_cny_fen, financial_snapshot_id, source_type, source_id, due_at,
      created_at
    ) VALUES
      (?, ?, ?, 'SELLER_PRINCIPAL', ?, ?, 'FORMAL_ORDER', ?, ?, ?),
      (?, ?, ?, 'SELLER_SERVICE_FEE', ?, ?, 'REVIEW_APPROVAL', ?, ?, ?)
  `).run(
    principalPayableId, `${prefix}-seller`, prefix,
    facts.sellerExpectedPrincipalCnyFen, snapshotId, prefix, AT, AT,
    feePayableId, `${prefix}-seller`, prefix,
    facts.serviceFeeCnyFen, snapshotId, caseId, AT + 1, AT + 1,
  );

  seedSellerAllocation(database, facts, prefix, principalPayableId);
  seedBuyerRefundPayment(database, facts, prefix, refundObligationId);
}

function seedLegalFormalOrderSources(
  database: SqliteDatabase,
  facts: FinanceFacts,
  input: { prefix: string; orderNumber: string },
): void {
  const { prefix, orderNumber } = input;
  const raw = database.raw;
  const sequence = ['zero', 'partial', 'reversal', 'overpayment', 'integer-boundary']
    .indexOf(facts.id) + 1;
  const buyerNo = `P20231114F${sequence}`;
  const subjectId = `${prefix}-buyer-subject`;
  const channelId = `${prefix}-buyer-channel`;
  const buyerId = `${prefix}-buyer`;
  const sellerId = `${prefix}-seller`;
  const storeId = `${prefix}-store`;
  const productId = `${prefix}-product`;
  const productVersionId = `${prefix}-product-version`;
  const demandId = `${prefix}-demand`;
  const reservationId = `${prefix}-reservation`;
  const memberId = `${prefix}-member`;
  const submissionId = `${prefix}-submission`;
  const evidenceId = `${prefix}-order-evidence`;
  const feeId = `${prefix}-fee-version`;
  const asin = formulaAsin(facts.id);

  executeFixtureSql(raw, `
    INSERT INTO seller_organizations (
      id, marketplace_code, seller_code, origin_channel_id, current_channel_id,
      seller_sequence, organization_name, status, version, created_at, updated_at,
      activated_at, disabled_at, next_member_number
    ) VALUES (?, 'JP', ?, 'seller-channel-ido-mango', 'seller-channel-ido-mango', ?,
      'Formula seller', 'ACTIVE', 1, ?, ?, ?, NULL, 2);
    INSERT INTO customer_identity_subjects (id, subject_type, created_at)
    VALUES (?, 'SELLER_ORG_MEMBER', ?), (?, 'BUYER_CUSTOMER', ?);
    INSERT INTO seller_organization_members (
      id, identity_subject_id, organization_id, member_number, username_fallback,
      display_name, role, primary_owner, status, version, created_at, updated_at,
      activated_at, disabled_at
    ) VALUES (?, ?, ?, 1, ?, 'Formula owner', 'OWNER', 1, 'ACTIVE', 1, ?, ?, ?, NULL);
    INSERT INTO buyer_channels (
      id, code, name, status, next_sequence, version, created_at, updated_at, disabled_at
    ) VALUES (?, ?, 'Formula channel', 'ACTIVE', 2, 1, ?, ?, NULL);
    INSERT INTO buyer_customers (
      id, identity_subject_id, marketplace_code, buyer_channel_id, buyer_customer_no,
      buyer_sequence, first_valid_order_business_date, display_name, access_status,
      identity_review_status, version, created_at, updated_at, activated_at, disabled_at
    ) VALUES (?, ?, 'JP', ?, ?, 1, '2023-11-14', 'Formula buyer', 'ACTIVE', 'CLEAR',
      1, ?, ?, ?, NULL);
    INSERT INTO seller_stores (
      id, organization_id, marketplace_code, display_name, normalized_name, status,
      version, created_at, updated_at, disabled_at
    ) VALUES (?, ?, 'JP', 'Formula store', 'Formula store', 'ACTIVE', 1, ?, ?, NULL);
    INSERT INTO products (
      id, organization_id, store_id, marketplace_code, asin_display, asin_normalized,
      status, current_version_no, version, created_at, updated_at, disabled_at
    ) VALUES (?, ?, ?, 'JP', ?, ?, 'ACTIVE', 1, 1, ?, ?, NULL);
    INSERT INTO product_versions (
      id, product_id, version_no, product_name, search_keywords_json, product_url,
      buyer_visible_notes, internal_notes, created_by_staff_id, created_at,
      ordering_guide_expected_amount_jpy, color_spec_mode
    ) VALUES (?, ?, 1, 'Formula fixture', '[]', NULL, NULL, NULL, ?, ?, 1980,
      'MAIN_IMAGE_VARIANT');
    INSERT INTO demand_batches (
      id, organization_id, store_id, marketplace_code, product_id, product_version_no,
      submitted_by_member_id, task_type, target_quantity, buyer_visible_notes, seller_notes,
      open_at, reservation_deadline, order_deadline, status, review_reason, close_reason,
      reviewed_by_staff_id, closed_by_staff_id, version, submitted_at, updated_at,
      reviewed_at, published_at, withdrawn_at, closed_at, held_reservation_count,
      approved_reservation_count
    ) VALUES (?, ?, ?, 'JP', ?, 1, ?, 'TEXT', 1, NULL, NULL, ?, ?, ?, 'PUBLISHED',
      NULL, NULL, ?, NULL, 2, ?, ?, ?, ?, NULL, NULL, 0, 1);
    INSERT INTO product_reservations (
      id, demand_batch_id, buyer_customer_id, organization_id, store_id, product_id,
      product_version_no, marketplace_code, status, precheck_snapshot_json, hold_expires_at,
      order_deadline_snapshot, version, submitted_at, updated_at, decided_by_staff_id,
      decision_reason, decided_at, cancelled_at, expired_at, reopened_count,
      buyer_self_pay_bps_snapshot, reference_order_amount_jpy_snapshot,
      estimated_self_pay_jpy_snapshot, estimated_refundable_principal_jpy_snapshot,
      buyer_self_pay_accepted_at, buyer_self_pay_accepted_demand_version
    ) VALUES (?, ?, ?, ?, ?, ?, 1, 'JP', 'APPROVED', '{}', ?, ?, 2, ?, ?, ?, NULL,
      ?, NULL, NULL, 0, 0, 1980, 0, 1980, ?, 2);
    INSERT INTO order_instruction_reconciliation_markers (
      id, reservation_id, instruction_id, disposition, metadata_json, created_at
    ) VALUES (?, ?, NULL, 'HISTORICAL_EVIDENCE_CONTEXT',
      '{"controlled_reconciliation":1,"schema_version":21}', ?);
  `, [
    sellerId, `${prefix}-seller-code`, sequence, AT, AT, AT,
    `${prefix}-seller-subject`, AT, subjectId, AT,
    memberId, `${prefix}-seller-subject`, sellerId, `${prefix}-member`, AT, AT, AT,
    channelId, `F${sequence}`, AT, AT,
    buyerId, subjectId, channelId, buyerNo, AT, AT, AT,
    storeId, sellerId, AT, AT,
    productId, sellerId, storeId, asin, asin, AT, AT,
    productVersionId, productId, STAFF_ID, AT,
    demandId, sellerId, storeId, productId, memberId, AT - 3, AT - 2, AT + 10,
    STAFF_ID, AT - 4, AT - 1, AT - 2, AT - 2,
    reservationId, demandId, buyerId, sellerId, storeId, productId, AT + 1, AT + 10,
    AT - 4, AT - 1, STAFF_ID, AT - 1, AT - 4,
    `${prefix}-historical-marker`, reservationId, AT,
  ]);

  raw.prepare(`
    INSERT INTO order_evidence_submissions (
      id, reservation_id, buyer_customer_id, marketplace_code, status, current_version_no,
      version, public_change_reason, internal_review_note, submitted_at, updated_at,
      verified_by_staff_id, verified_at, withdrawn_at, consumed_at, created_at
    ) VALUES (?, ?, ?, 'JP', 'PENDING_VERIFICATION', 1, 1, NULL, NULL, ?, ?, NULL,
      NULL, NULL, NULL, ?)
  `).run(submissionId, reservationId, buyerId, AT, AT, AT);
  raw.prepare(`
    INSERT INTO order_evidence_versions (
      id, submission_id, reservation_id, buyer_customer_id, marketplace_code, version_no,
      amazon_order_number_raw, amazon_order_number_normalized, amazon_order_date,
      final_paid_jpy, submitted_by_buyer_id, buyer_note, order_instruction_id,
      order_instruction_version_id, instruction_deadline_snapshot,
      reference_order_amount_jpy_snapshot, buyer_self_pay_bps_snapshot, buyer_self_pay_jpy,
      buyer_refundable_principal_jpy, price_mismatch, price_difference_jpy,
      submitted_before_deadline, evidence_file_object_id, created_at
    ) VALUES (?, ?, ?, ?, 'JP', 1, ?, ?, '2023-11-14', ?, ?, NULL, NULL, NULL, NULL,
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?)
  `).run(evidenceId, submissionId, reservationId, buyerId, orderNumber, orderNumber,
    facts.sellerExpectedPrincipalCnyFen, buyerId, AT);
  raw.prepare(`
    UPDATE order_evidence_submissions
    SET status='VERIFIED', version=2, verified_by_staff_id=?, verified_at=?, updated_at=?
    WHERE id=?
  `).run(STAFF_ID, AT, AT, submissionId);
  raw.prepare(`
    INSERT INTO seller_service_fee_versions (
      id, organization_id, review_type, version_no, status, fee_cny_fen, effective_from,
      submitted_by_staff_id, submitted_at, decision_version, confirmed_by_staff_id,
      confirmed_at, rejected_by_staff_id, rejected_at, rejection_reason
    ) VALUES (?, ?, 'TEXT', 1, 'SUBMITTED', ?, ?, ?, ?, 1, NULL, NULL, NULL, NULL, NULL)
  `).run(feeId, sellerId, facts.serviceFeeCnyFen, AT - 1, STAFF_ID, AT - 3);
  raw.prepare(`
    UPDATE seller_service_fee_versions
    SET status='CONFIRMED', decision_version=2, confirmed_by_staff_id=?, confirmed_at=?
    WHERE id=?
  `).run(STAFF_ID, AT - 2, feeId);
}

function formulaAsin(caseId: string): string {
  return `B00000000${['zero', 'partial', 'reversal', 'overpayment', 'integer-boundary']
    .indexOf(caseId) + 1}`;
}

function executeFixtureSql(
  raw: SqliteDatabase['raw'],
  sql: string,
  values: readonly (string | number | bigint)[],
): void {
  let next = 0;
  const statement = sql.replaceAll('?', () => {
    const value = values[next];
    next += 1;
    if (value === undefined) throw new Error('fixture_sql_binding_mismatch');
    if (typeof value === 'bigint' || typeof value === 'number') return String(value);
    return `'${value.replaceAll("'", "''")}'`;
  });
  if (next !== values.length) throw new Error('fixture_sql_binding_mismatch');
  for (const clause of statement.split(';')) {
    if (clause.trim() === '') continue;
    try {
      raw.exec(clause);
    } catch (error) {
      throw new Error(`fixture_sql_failed: ${clause.trim().slice(0, 80)}`, {
        cause: error,
      });
    }
  }
}

function seedSellerAllocation(
  database: SqliteDatabase,
  facts: FinanceFacts,
  prefix: string,
  payableId: string,
): void {
  if (facts.sellerAllocationGrossCnyFen === 0n) return;
  const raw = database.raw;
  const paymentId = `${prefix}-seller-payment`;
  const allocationId = `${prefix}-seller-allocation`;
  raw.prepare(`
    INSERT INTO seller_payments (
      id, seller_organization_id, amount_cny_fen, paid_at, recorded_at,
      recorded_by_staff_id, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    paymentId, `${prefix}-seller`, facts.sellerAllocationGrossCnyFen,
    AT + 2, AT + 2, STAFF_ID, AT + 2, AT + 2,
  );
  raw.prepare(`
    INSERT INTO seller_payment_allocations (
      id, payment_id, payable_id, seller_organization_id, amount_cny_fen,
      allocated_by_staff_id, allocated_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    allocationId, paymentId, payableId, `${prefix}-seller`,
    facts.sellerAllocationGrossCnyFen, STAFF_ID, AT + 2, AT + 2,
  );
  if (facts.sellerAllocationReversalCnyFen === 0n) return;
  raw.prepare(`
    INSERT INTO seller_payment_allocation_reversals (
      id, allocation_id, payment_id, payable_id, seller_organization_id,
      amount_cny_fen, reason, reversed_by_staff_id, reversed_at,
      idempotency_key, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'formula fixture reversal', ?, ?, ?, ?)
  `).run(
    `${prefix}-seller-allocation-reversal`, allocationId, paymentId, payableId,
    `${prefix}-seller`, facts.sellerAllocationReversalCnyFen, STAFF_ID, AT + 3,
    `${prefix}-seller-allocation-reversal`, AT + 3,
  );
}

function seedBuyerRefundPayment(
  database: SqliteDatabase,
  facts: FinanceFacts,
  prefix: string,
  obligationId: string,
): void {
  if (facts.buyerRefundPaymentGrossCnyFen === 0n) return;
  const raw = database.raw;
  const paymentId = `${prefix}-buyer-refund-payment`;
  raw.prepare(`
    INSERT INTO buyer_refund_payment_entries (
      id, obligation_id, entry_type, original_payment_entry_id,
      amount_cny_fen, paid_at, reversed_at, china_business_date,
      payment_channel, recorded_by_staff_id, public_note, internal_note,
      idempotency_key, request_hash, created_at
    ) VALUES (?, ?, 'PAYMENT', NULL, ?, ?, NULL, '2023-11-14', 'WECHAT', ?,
      NULL, NULL, ?, ?, ?)
  `).run(
    paymentId, obligationId, facts.buyerRefundPaymentGrossCnyFen, AT + 2,
    STAFF_ID, paymentId, HASH, AT + 2,
  );
  if (facts.buyerRefundPaymentReversalCnyFen === 0n) return;
  raw.prepare(`
    INSERT INTO buyer_refund_payment_entries (
      id, obligation_id, entry_type, original_payment_entry_id,
      amount_cny_fen, paid_at, reversed_at, china_business_date,
      payment_channel, recorded_by_staff_id, public_note, internal_note,
      idempotency_key, request_hash, created_at
    ) VALUES (?, ?, 'REVERSAL', ?, ?, NULL, ?, '2023-11-14', 'WECHAT', ?,
      NULL, NULL, ?, ?, ?)
  `).run(
    `${prefix}-buyer-refund-reversal`, obligationId, paymentId,
    facts.buyerRefundPaymentReversalCnyFen, AT + 3, STAFF_ID,
    `${prefix}-buyer-refund-reversal`, HASH, AT + 3,
  );
}
