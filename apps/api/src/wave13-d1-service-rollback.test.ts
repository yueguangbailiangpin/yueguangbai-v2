import { afterEach, describe, expect, it } from 'vitest';
import type {
  SqlAllResult,
  SqlDatabase,
  SqlRunResult,
  SqlStatement,
  StaffPermissionCode,
} from '@ygb/contracts';
import {
  createMigratedTestDatabase,
  type SqliteDatabase,
} from '@ygb/testkit';
import type { FileAuthorizationService } from './files/authorization';
import { approveOrderEvidenceAtomically } from './order-evidence/approve-order-evidence';
import { recordBuyerRefundPayment } from './buyer-refunds/record-buyer-refund-payment';
import { reverseBuyerRefundPayment } from './buyer-refunds/reverse-buyer-refund-payment';

let base: SqliteDatabase | null = null;
afterEach(() => {
  base?.close();
  base = null;
});

const ownerActor = Object.freeze({
  staffId: 'zz-phase3h-test-owner',
  displayName: 'Phase 3H Test Owner',
  roles: ['owner'] as const,
  permissions: new Set<StaffPermissionCode>([
    'ORDER_CONFIRM',
    'BUYER_REFUND_VIEW',
    'BUYER_REFUND_RECORD',
  ]),
});

const allowFileLink: FileAuthorizationService = {
  assertCanCreateUpload() {},
  assertCanUpload() {},
  assertCanCompleteUpload() {},
  assertCanLink() {},
  assertCanRead() {},
};

describe('Wave 13 service-level D1 rollback boundaries', () => {
  it('leaves no approval facts when the atomic approve batch fails', async () => {
    base = createMigratedTestDatabase();
    const database = new ServiceFaultDatabase(base, 'APPROVAL');
    await expect(approveOrderEvidenceAtomically(
      database,
      {
        submissionId: 'fault-evidence',
        expectedVersion: 1,
      },
      {
        actor: ownerActor,
        idempotencyKey: 'fault-atomic-approval',
        requestId: 'fault-atomic-approval-request',
        now: 1_722_528_000_000,
        sellerPrincipalRateEnforcementEnabled: true,
      },
    )).rejects.toMatchObject({ status: 503 });
    expect(count(base, 'formal_orders')).toBe(0);
    expect(count(base, 'formal_order_financial_snapshots')).toBe(0);
    expect(count(base, 'seller_payables')).toBe(0);
    expect(count(base, 'audit_events')).toBe(0);
    expect(count(base, 'integration_outbox')).toBe(0);
    expect(commandState(base, 'fault-atomic-approval')).toEqual({
      status: 'FAILED',
      error_code: 'DEPENDENCY_UNAVAILABLE',
    });
  });

  it('leaves no append-only Payment facts when the Refund batch fails', async () => {
    base = createMigratedTestDatabase();
    const database = new ServiceFaultDatabase(base, 'REFUND_PAYMENT');
    await expect(recordBuyerRefundPayment(
      database,
      allowFileLink,
      {
        obligationId: 'fault-refund',
        expectedVersion: 1,
        amountCnyFen: 100,
        paidAt: 1_722_528_001_000,
        chinaBusinessDate: '2024-08-02',
        paymentChannel: 'WECHAT',
        proofFiles: [{
          fileObjectId: 'fault-refund-proof',
          expectedFileVersion: 3,
        }],
        publicNote: null,
        internalNote: null,
      },
      {
        actor: ownerActor,
        idempotencyKey: 'fault-refund-payment',
        requestId: 'fault-refund-payment-request',
        now: 1_722_528_001_000,
      },
    )).rejects.toMatchObject({ status: 503 });
    expect(count(base, 'buyer_refund_payment_entries')).toBe(0);
    expect(count(base, 'buyer_refund_payment_entry_files')).toBe(0);
    expect(count(base, 'buyer_refund_events')).toBe(0);
    expect(count(base, 'file_entity_links')).toBe(0);
    expect(count(base, 'file_entity_audience_grants')).toBe(0);
    expect(count(base, 'audit_events')).toBe(0);
    expect(count(base, 'integration_outbox')).toBe(0);
    expect(commandState(base, 'fault-refund-payment')).toEqual({
      status: 'FAILED',
      error_code: 'DEPENDENCY_UNAVAILABLE',
    });
  });

  it('leaves no Reversal fact when the Refund reversal batch fails', async () => {
    base = createMigratedTestDatabase();
    const database = new ServiceFaultDatabase(base, 'REFUND_REVERSAL');
    await expect(reverseBuyerRefundPayment(
      database,
      {
        obligationId: 'fault-refund',
        originalPaymentEntryId: 'fault-original-payment',
        expectedVersion: 2,
        amountCnyFen: 100,
        reversedAt: 1_722_528_002_000,
        chinaBusinessDate: '2024-08-02',
        publicNote: 'fault reversal',
        internalNote: null,
      },
      {
        actor: ownerActor,
        idempotencyKey: 'fault-refund-reversal',
        requestId: 'fault-refund-reversal-request',
        now: 1_722_528_002_000,
      },
    )).rejects.toMatchObject({ status: 503 });
    expect(count(base, 'buyer_refund_payment_entries')).toBe(0);
    expect(count(base, 'buyer_refund_events')).toBe(0);
    expect(count(base, 'audit_events')).toBe(0);
    expect(count(base, 'integration_outbox')).toBe(0);
    expect(commandState(base, 'fault-refund-reversal')).toEqual({
      status: 'FAILED',
      error_code: 'DEPENDENCY_UNAVAILABLE',
    });
  });
});

type Mode = 'APPROVAL' | 'REFUND_PAYMENT' | 'REFUND_REVERSAL';

class ServiceFaultDatabase implements SqlDatabase {
  constructor(
    private readonly target: SqlDatabase,
    private readonly mode: Mode,
  ) {}

  prepare(sql: string): SqlStatement {
    const normalized = sql.replace(/\s+/gu, ' ').trim();
    const overlay = readOverlay(normalized, this.mode);
    return overlay === null
      ? this.target.prepare(sql)
      : new ResultStatement(overlay, []);
  }

  batch(_statements: readonly SqlStatement[]): Promise<SqlRunResult[]> {
    return Promise.reject(new Error('injected_wave13_final_batch_failure'));
  }
}

type OverlayResult =
  | { kind: 'FIRST'; value: Record<string, unknown> }
  | { kind: 'ALL'; values: readonly Record<string, unknown>[] };

class ResultStatement implements SqlStatement {
  constructor(
    private readonly result: OverlayResult,
    private readonly bindings: readonly unknown[],
  ) {}
  bind(...values: unknown[]): SqlStatement {
    return new ResultStatement(this.result, values);
  }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    void this.bindings;
    if (this.result.kind === 'FIRST') return this.result.value as T;
    return (this.result.values[0] ?? null) as T | null;
  }
  async all<T = Record<string, unknown>>(): Promise<SqlAllResult<T>> {
    void this.bindings;
    return {
      results: (this.result.kind === 'ALL'
        ? this.result.values
        : [this.result.value]) as T[],
    };
  }
  async run(): Promise<SqlRunResult> {
    throw new Error('read_overlay_cannot_run');
  }
}

function readOverlay(sql: string, mode: Mode): OverlayResult | null {
  if (mode === 'APPROVAL') {
    if (sql.includes('AS evidence_file_count')
      && sql.includes('FROM order_evidence_submissions submission')) {
      return first(approvalSource());
    }
    if (sql.includes('FROM order_instructions instruction')
      && sql.includes('JOIN order_evidence_versions evidence')) {
      return first({
        instruction_id: 'fault-instruction',
        instruction_version_id: 'fault-instruction-version',
        instruction_aggregate_version: 1,
        instruction_status: 'ACTIVE',
        buyer_self_pay_bps: 0,
        buyer_self_pay_jpy: 0,
        buyer_refundable_principal_jpy: 1980,
      });
    }
    if (sql.includes('FROM formal_order_number_claims')
      && sql.includes("status='PROVISIONAL'")) {
      return first({ found: 1 });
    }
    if (sql.includes('FROM buyer_daily_exchange_rates')
      && sql.includes("status='CONFIRMED'")) {
      return first({
        id: 'fault-buyer-rate',
        business_date: '2024-08-02',
        version_no: 1,
        cny_per_jpy_e8: 5_000_000,
        confirmed_at: 1_722_528_000_000,
      });
    }
    if (sql.includes('FROM buyer_daily_currency_rate_versions')
      && sql.includes("quote_currency_code='CNY'")) {
      return first({
        id: 'currency-fault-buyer-rate',
        business_date: '2024-08-02',
        version_no: 1,
        rate_value: 5_000_000,
        rate_scale: 100_000_000,
        confirmed_at: 1_722_528_000_000,
      });
    }
    if (sql.includes('FROM seller_principal_rate_policy_versions')
      && sql.includes("status='CONFIRMED'")) {
      return first({
        id: 'fault-principal-policy',
        scope_type: 'SELLER_ORGANIZATION',
        seller_organization_id: 'fault-org',
        source_currency_code: 'JPY',
        quote_currency_code: 'CNY',
        version_no: 1,
        decision_version: 2,
        status: 'CONFIRMED',
        markup_rate_value: 0,
        rate_scale: 100_000_000,
        effective_from: 1_700_000_000_000,
        submitted_at: 1_700_000_000_000,
        confirmed_at: 1_700_000_000_001,
        rejection_reason: null,
      });
    }
    if (sql.includes('FROM seller_agreement_rate_versions')
      && sql.includes("status='CONFIRMED'")) {
      return first(sellerRule('fault-seller-rate', null, 5_000_000));
    }
    if (sql.includes('FROM seller_service_fee_versions')
      && sql.includes("status='CONFIRMED'")) {
      return first(sellerRule('fault-service-fee', 'TEXT', 1_000));
    }
  }

  if (sql.includes('FROM staff_work_items')
    && sql.includes('source_entity_type=?')
    && sql.includes('source_entity_id=?')) {
    if (sql.includes('duty_code')) {
      return first({
        id: 'fault-work-item',
        duty_code: mode === 'APPROVAL'
          ? 'BUYER_PRE_SALES_OWNER'
          : 'BUYER_REFUND_OWNER',
        fixed_assignment_id: 'fault-assignment',
        assigned_staff_id: 'zz-phase3h-test-owner',
      });
    }
    return first({
      id: 'fault-work-item',
      assigned_staff_id: 'zz-phase3h-test-owner',
    });
  }

  if ((mode === 'REFUND_PAYMENT' || mode === 'REFUND_REVERSAL')
    && sql.includes('FROM buyer_refund_ledger_balances')
    && sql.includes('WHERE obligation_id=?')) {
    return first(refundLedger(mode));
  }

  if (mode === 'REFUND_PAYMENT') {
    if (sql.includes('FROM file_objects object')
      && sql.includes('WHERE object.id IN')) {
      return all([proofFile()]);
    }
    if (sql.includes('FROM file_objects object')
      && sql.includes('WHERE object.id=?')) {
      return first({
        id: 'fault-refund-proof',
        upload_intent_id: 'fault-refund-intent',
        purpose: 'BUYER_REFUND_PROOF',
        visibility: 'INTERNAL_ONLY',
        status: 'VERIFIED',
        version: 3,
        owner_actor_type: 'STAFF',
        owner_actor_id: 'zz-phase3h-test-owner',
        intent_status: 'VERIFIED',
      });
    }
  }

  if (mode === 'REFUND_REVERSAL'
    && sql.includes('FROM buyer_refund_payment_entries payment')
    && sql.includes("payment.entry_type='PAYMENT'")) {
    return first({
      payment_entry_id: 'fault-original-payment',
      obligation_id: 'fault-refund',
      amount_cny_fen: 500,
      payment_channel: 'WECHAT',
      recorded_by_staff_id: 'zz-phase3h-test-owner',
      paid_at: 1_722_528_000_000,
      china_business_date: '2024-08-02',
      public_note: null,
      reversed_amount_cny_fen: 0,
    });
  }
  return null;
}

function approvalSource(): Record<string, unknown> {
  return {
    submission_id: 'fault-evidence',
    reservation_id: 'fault-reservation',
    buyer_customer_id: 'fault-buyer',
    marketplace_code: 'JP',
    evidence_status: 'PENDING_VERIFICATION',
    evidence_current_version_no: 1,
    evidence_aggregate_version: 1,
    evidence_version_id: 'fault-evidence-version',
    amazon_order_date: '2024-08-02',
    amazon_order_number_raw: '123-1234567-1234567',
    amazon_order_number_normalized: '123-1234567-1234567',
    final_paid_jpy: 1980,
    reference_order_amount_jpy: 1980,
    price_difference_jpy: 0,
    price_mismatch: 0,
    evidence_file_object_id: 'fault-evidence-file',
    evidence_file_count: 1,
    file_status: 'VERIFIED',
    file_purpose: 'ORDER_EVIDENCE',
    file_visibility: 'BUYER_VISIBLE',
    file_version: 3,
    file_owner_actor_type: 'BUYER_CUSTOMER',
    file_owner_actor_id: 'fault-buyer',
    reservation_status: 'APPROVED',
    reservation_version: 2,
    demand_batch_id: 'fault-demand',
    seller_organization_id: 'fault-org',
    store_id: 'fault-store',
    product_id: 'fault-product',
    product_version_no: 1,
    review_type: 'TEXT',
    asin_display: 'B0FAULT001',
    asin_normalized: 'B0FAULT001',
    product_version_id: 'fault-product-version',
    product_name: 'Fault Product',
    buyer_access_status: 'ACTIVE',
    buyer_customer_no: 'P202408020001',
    buyer_sequence: 1,
    first_valid_order_business_date: '2024-08-02',
    buyer_channel_id: 'buyer-channel-preorder',
    buyer_version: 1,
    channel_code: 'P',
    channel_status: 'ACTIVE',
    channel_next_sequence: 2,
    channel_version: 1,
    existing_formal_order_id: null,
  };
}

function sellerRule(
  id: string,
  reviewType: string | null,
  value: number,
): Record<string, unknown> {
  return {
    id,
    organization_id: 'fault-org',
    review_type: reviewType,
    version_no: 1,
    status: 'CONFIRMED',
    value,
    effective_from: 1_700_000_000_000,
    submitted_by_staff_id: 'zz-phase3h-test-owner',
    submitted_at: 1_700_000_000_000,
    decision_version: 2,
    confirmed_at: 1_700_000_000_001,
  };
}

function refundLedger(mode: Mode): Record<string, unknown> {
  const reversal = mode === 'REFUND_REVERSAL';
  return {
    obligation_id: 'fault-refund',
    source_review_event_id: 'fault-review-event',
    review_case_id: 'fault-review',
    formal_order_id: 'fault-formal-order',
    buyer_customer_id: 'fault-buyer',
    due_amount_cny_fen: 1000,
    gross_paid_cny_fen: reversal ? 500 : 0,
    reversed_cny_fen: 0,
    net_paid_cny_fen: reversal ? 500 : 0,
    status: reversal ? 'PARTIALLY_PAID' : 'DUE',
    version: reversal ? 2 : 1,
    created_at: 1_700_000_000_000,
    updated_at: 1_700_000_000_000,
  };
}

function proofFile(): Record<string, unknown> {
  return {
    id: 'fault-refund-proof',
    upload_intent_id: 'fault-refund-intent',
    purpose: 'BUYER_REFUND_PROOF',
    visibility: 'INTERNAL_ONLY',
    status: 'VERIFIED',
    version: 3,
    intent_status: 'VERIFIED',
    intent_purpose: 'BUYER_REFUND_PROOF',
    intent_visibility: 'INTERNAL_ONLY',
    owner_actor_type: 'STAFF',
    owner_actor_id: 'zz-phase3h-test-owner',
  };
}

function first(value: Record<string, unknown>): OverlayResult {
  return { kind: 'FIRST', value };
}
function all(values: readonly Record<string, unknown>[]): OverlayResult {
  return { kind: 'ALL', values };
}
function count(target: SqliteDatabase, table: string): number {
  const row = target.raw.prepare(
    `SELECT COUNT(*) AS count FROM ${table}`,
  ).get() as { count: number | bigint };
  return Number(row.count);
}
function commandState(target: SqliteDatabase, key: string) {
  return target.raw.prepare(`
    SELECT status, error_code FROM command_idempotency_records
    WHERE idempotency_key=?
  `).get(key);
}
