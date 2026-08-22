import { describe, expect, it } from 'vitest';
import type { InternalOrderFinancePositionDto } from '@ygb/contracts';
import { buildFinanceOrderDetail } from './order-detail';

describe('Wave 12 internal finance order detail isolation', () => {
  it('returns frozen facts and explicit calculation processes', () => {
    const detail = buildFinanceOrderDetail(position());
    expect(detail.frozen_snapshot).toEqual({
      financial_snapshot_id: 'snapshot-1',
      buyer_self_pay_bps: 1000,
      buyer_self_pay_jpy: '1000',
      buyer_expected_principal_cny_fen: '45000',
      seller_expected_principal_cny_fen: '50000',
      service_fee_cny_fen: '3000',
      rate_detail: null,
    });
    expect(detail.seller_payables).toMatchObject({
      principal_due_cny_fen: '50000',
      principal_collected_cny_fen: '40000',
      service_fee_due_cny_fen: '3000',
      service_fee_collected_cny_fen: '1000',
    });
    expect(detail.buyer_refund).toEqual({
      due_cny_fen: '45000',
      net_paid_cny_fen: '46000',
      outstanding_cny_fen: '0',
      overpaid_cny_fen: '1000',
    });
    expect(detail.attributed_cash).toEqual({
      seller_allocated_net_cny_fen: '41000',
      buyer_refund_net_paid_cny_fen: '46000',
      net_cny_fen: '-5000',
    });
    expect(detail.calculations.projected_gross_profit).toMatchObject({
      result_cny_fen: '8000',
      formula:
        'SELLER_EXPECTED_PRINCIPAL_PLUS_SERVICE_FEE_MINUS_BUYER_EXPECTED_PRINCIPAL',
    });
    expect(detail.calculations.completed_gross_profit).toMatchObject({
      eligible: true,
      result_cny_fen: '8000',
    });
    expect(detail.calculations.current_attributed_cash.result_cny_fen)
      .toBe('-5000');
  });

  it('returns exception guidance without guessing completed profit', () => {
    const detail = buildFinanceOrderDetail({
      ...position(),
      finance_status: 'AMOUNT_MISMATCH',
      completed_gross_profit_cny_fen: null,
    });
    expect(detail.calculations.completed_gross_profit).toMatchObject({
      eligible: false,
      result_cny_fen: null,
    });
    expect(detail.exception_codes).toEqual(['AMOUNT_MISMATCH']);
    expect(detail.suggested_actions).toEqual([
      'MANUAL_INTERNAL_INVESTIGATION',
    ]);
  });

  it('does not expose proofs, file storage, contacts or session data', () => {
    const serialized = JSON.stringify(buildFinanceOrderDetail(position()));
    expect(serialized).not.toMatch(
      /proof|object_key|file_url|permanent_url|wechat|password|session|idempotency|internal_note/iu,
    );
  });
});

function position(): InternalOrderFinancePositionDto {
  return {
    formal_order_id: 'formal-1',
    amazon_order_number: '123-1234567-1234567',
    seller_organization_id: 'seller-1',
    store_id: 'store-1',
    product_id: 'product-1',
    asin: 'B000000001',
    product_name: '产品一',
    review_type: 'IMAGE',
    confirmed_at: 1000,
    confirmed_business_date: '2026-08-01',
    review_approved_at: 2000,
    review_approved_business_date: '2026-08-01',
    last_cash_business_date: '2026-08-02',
    final_paid_jpy: '10000',
    financial_snapshot_id: 'snapshot-1',
    buyer_self_pay_bps: 1000,
    buyer_self_pay_jpy: '1000',
    buyer_expected_principal_cny_fen: '45000',
    seller_expected_principal_cny_fen: '50000',
    service_fee_snapshot_cny_fen: '3000',
    projected_gross_profit_cny_fen: '8000',
    completed_gross_profit_cny_fen: '8000',
    seller_principal_due_cny_fen: '50000',
    seller_principal_collected_cny_fen: '40000',
    seller_principal_outstanding_cny_fen: '10000',
    seller_service_fee_due_cny_fen: '3000',
    seller_service_fee_collected_cny_fen: '1000',
    seller_service_fee_outstanding_cny_fen: '2000',
    buyer_refund_due_cny_fen: '45000',
    buyer_refund_net_paid_cny_fen: '46000',
    buyer_refund_outstanding_cny_fen: '0',
    buyer_refund_overpaid_cny_fen: '1000',
    attributed_cash_net_cny_fen: '-5000',
    finance_status: 'COMPLETED',
  };
}
