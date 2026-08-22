// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithMsw } from '../../test/msw/render';
import { PricingBreakdownCard } from './PricingBreakdownCard';
import type { FinanceOrderDetail } from './PricingBreakdownCard';

afterEach(cleanup);

describe('PricingBreakdownCard', () => {
  it('renders the frozen pricing elements, amounts, and named formulas', () => {
    renderWithMsw(
      <PricingBreakdownCard detail={fixture()} orderId="order-1" />,
      { route: '/staff/finance' },
    );
    expect(screen.getByRole('heading', { name: '计价明细' })).toBeVisible();
    expect(screen.getByText(/0.046 CNY \/ JPY（2026-08-22 生效）/u)).toBeVisible();
    expect(screen.getByText(/\+0\.004（币种对默认加点 v3）/u)).toBeVisible();
    expect(screen.getByText(/¥12\.50/u)).toBeVisible();
    expect(screen.getByText(/实付金额：¥3980 JPY/u)).toBeVisible();
    expect(
      screen.getByText(/预估毛利 = 卖家应收本金 \+ 服务费 − 买家应收本金/u),
    ).toBeVisible();
    expect(screen.getByText(/正式订单 ID：order-1/u)).toBeVisible();
  });

  it('marks missing snapshot facts instead of throwing', () => {
    const detail = fixture();
    detail.frozen_snapshot.rate_detail = null;
    detail.frozen_snapshot.service_fee_cny_fen = null;
    renderWithMsw(<PricingBreakdownCard detail={detail} orderId="order-2" />, {
      route: '/staff/finance',
    });
    expect(screen.getAllByText(/快照缺失/u).length).toBeGreaterThanOrEqual(3);
  });
});

function fixture(): FinanceOrderDetail {
  return {
    position: {
      formal_order_id: 'order-1',
      amazon_order_number: '123-4567890-1234567',
      seller_organization_id: 'seller-1',
      store_id: 'store-1',
      product_id: 'product-1',
      asin: 'B0TEST0001',
      product_name: '测试产品',
      review_type: 'RATING',
      confirmed_at: 1_787_424_000_000,
      confirmed_business_date: '2026-08-22',
      review_approved_at: null,
      review_approved_business_date: null,
      last_cash_business_date: null,
      final_paid_jpy: '3980',
      financial_snapshot_id: 'snapshot-1',
      buyer_self_pay_bps: 1000,
      buyer_self_pay_jpy: '398',
      buyer_expected_principal_cny_fen: '165000',
      seller_expected_principal_cny_fen: '182500',
      service_fee_snapshot_cny_fen: '1250',
      projected_gross_profit_cny_fen: '18750',
      completed_gross_profit_cny_fen: null,
      seller_principal_due_cny_fen: '182500',
      seller_principal_collected_cny_fen: '0',
      seller_principal_outstanding_cny_fen: '182500',
      seller_service_fee_due_cny_fen: '1250',
      seller_service_fee_collected_cny_fen: '0',
      seller_service_fee_outstanding_cny_fen: '1250',
      buyer_refund_due_cny_fen: '165000',
      buyer_refund_net_paid_cny_fen: '0',
      buyer_refund_outstanding_cny_fen: '165000',
      buyer_refund_overpaid_cny_fen: '0',
      attributed_cash_net_cny_fen: '0',
      finance_status: 'PROJECTED_ONLY',
    },
    frozen_snapshot: {
      financial_snapshot_id: 'snapshot-1',
      buyer_self_pay_bps: 1000,
      buyer_self_pay_jpy: '398',
      buyer_expected_principal_cny_fen: '165000',
      seller_expected_principal_cny_fen: '182500',
      service_fee_cny_fen: '1250',
      rate_detail: {
        buyer_rate_business_date: '2026-08-22',
        buyer_cny_per_jpy_e8: '4600000',
        markup_rate_value: '400000',
        final_rate_value: '5000000',
        policy_scope_type: 'CURRENCY_PAIR_DEFAULT',
        policy_version_no: 3,
        policy_effective_from: 1_787_000_000_000,
      },
    },
    seller_payables: {
      principal_due_cny_fen: '182500',
      principal_collected_cny_fen: '0',
      principal_outstanding_cny_fen: '182500',
      service_fee_due_cny_fen: '1250',
      service_fee_collected_cny_fen: '0',
      service_fee_outstanding_cny_fen: '1250',
    },
    buyer_refund: {
      due_cny_fen: '165000',
      net_paid_cny_fen: '0',
      outstanding_cny_fen: '165000',
      overpaid_cny_fen: '0',
    },
    attributed_cash: {
      seller_allocated_net_cny_fen: '0',
      buyer_refund_net_paid_cny_fen: '0',
      net_cny_fen: '0',
    },
    calculations: {
      projected_gross_profit: {
        formula: 'SELLER_EXPECTED_PRINCIPAL_PLUS_SERVICE_FEE_MINUS_BUYER_EXPECTED_PRINCIPAL',
        seller_expected_principal_cny_fen: '182500',
        service_fee_cny_fen: '1250',
        buyer_expected_principal_cny_fen: '165000',
        result_cny_fen: '18750',
      },
      completed_gross_profit: {
        formula: 'SELLER_PRINCIPAL_PAYABLE_PLUS_SERVICE_FEE_PAYABLE_MINUS_BUYER_REFUND_DUE',
        eligible: false,
        seller_principal_payable_cny_fen: '182500',
        seller_service_fee_payable_cny_fen: '1250',
        buyer_refund_due_cny_fen: '165000',
        result_cny_fen: null,
      },
      current_attributed_cash: {
        formula: 'SELLER_CURRENT_NET_ALLOCATION_MINUS_BUYER_REFUND_NET_PAID',
        seller_current_net_allocation_cny_fen: '0',
        buyer_refund_net_paid_cny_fen: '0',
        result_cny_fen: '0',
      },
    },
    finance_status: 'PROJECTED_ONLY',
    exception_codes: [],
    suggested_actions: [],
  };
}
