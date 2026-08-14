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

let database: SqliteDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe('Wave 12 financial formulas execute against the production SQL view', () => {
  it('matches domain formulas for zero, partial, reversal, overpayment, and integer-boundary facts', () => {
    database = createFormulaFixtureDatabase();
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
        serviceFeeCnyFen: 0n,
        buyerExpectedPrincipalCnyFen: 9_007_199_254_740_991n,
        sellerAllocationGrossCnyFen: 9_007_199_254_740_991n,
        sellerAllocationReversalCnyFen: 0n,
        buyerRefundPaymentGrossCnyFen: 9_007_199_254_740_991n,
        buyerRefundPaymentReversalCnyFen: 0n,
      },
    ];
    for (const facts of cases) seedFinanceFacts(database, facts);

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
  fixture.exec(`
    PRAGMA foreign_keys = OFF;
    DROP TRIGGER trg_formal_order_source_guard;
    DROP TRIGGER trg_formal_order_instruction_guard;
    DROP TRIGGER trg_formal_order_financial_snapshot_guard;
    DROP TRIGGER trg_formal_order_financial_self_pay_guard;
  `);
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'JP', ?, ?, 1, 'B000000001',
      'B000000001', 'Formula fixture', 'TEXT', ?, ?, ?, 'CONFIRMED', 1, ?,
      ?, '2023-11-14', ?, '2023-11-14')
  `).run(
    prefix, `${prefix}-submission`, `${prefix}-order-evidence`,
    `${prefix}-reservation`, `${prefix}-demand`, `${prefix}-buyer`,
    `${prefix}-buyer-no`, `${prefix}-seller`, `${prefix}-store`,
    `${prefix}-product`, `${prefix}-product-version`, orderNumber, orderNumber,
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
    snapshotId, prefix, `${prefix}-buyer-rate`, AT, `${prefix}-fee-version`,
    AT, AT, facts.serviceFeeCnyFen, facts.buyerExpectedPrincipalCnyFen,
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
