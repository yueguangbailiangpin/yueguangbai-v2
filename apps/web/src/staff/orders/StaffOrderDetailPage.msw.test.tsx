// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import '../../test/msw/lifecycle';
import { StaffSessionBoundary } from '../../auth/staff/StaffSessionBoundary';
import type { StaffAuthApiAdapter, StaffSession } from '../../auth/staff/staff-auth-api';
import { apiUrl } from '../../test/msw/handlers';
import { Route, Routes } from 'react-router';
import { renderWithMsw } from '../../test/msw/render';
import { server } from '../../test/msw/server';
import { StaffOrderDetailPage } from './StaffOrderDetailPage';

afterEach(cleanup);

describe('员工订单详情页', () => {
  it('Owner 看到订单信息、计价明细、进度与全链路时间线', async () => {
    server.use(
      http.get(apiUrl('/api/staff/finance/orders/:id'), () =>
        HttpResponse.json({
          data: { order: financeOrderFixture() },
          meta: { request_id: 'finance-order-read' },
        }),
      ),
      http.get(apiUrl('/api/staff/order-integrity/:id'), () =>
        HttpResponse.json({
          data: {
            order_integrity: {
              formal_order_id: 'order-1',
              canonical_marketplace_code: 'AMAZON_JP',
              operational_state: 'NORMAL',
              events: [
                {
                  event_id: 'event-1',
                  formal_order_id: 'order-1',
                  event_type: 'RETURN_REFUND',
                  reason: '买家退货',
                  actor_staff_id: 'staff-1',
                  created_at: 1_787_430_000_000,
                },
              ],
              adjustments: [],
            },
          },
          meta: { request_id: 'order-integrity-read' },
        }),
      ),
    );
    renderWithMsw(
      <StaffSessionBoundary adapter={adapter(owner())}>
        <Routes>
          <Route path="/staff/orders/:orderId" element={<StaffOrderDetailPage />} />
        </Routes>
      </StaffSessionBoundary>,
      { route: '/staff/orders/order-1' },
    );
    expect(await screen.findByRole('heading', { name: '订单详情' })).toBeVisible();
    expect(await screen.findByRole('heading', { name: '订单信息' })).toBeVisible();
    expect(screen.getByRole('heading', { name: '计价明细' })).toBeVisible();
    expect(screen.getByRole('heading', { name: '返款进度（买家）' })).toBeVisible();
    expect(screen.getByRole('heading', { name: '结算进度（卖家）' })).toBeVisible();
    expect(await screen.findByRole('heading', { name: '全链路时间线' })).toBeVisible();
    expect(await screen.findByText('订单确认')).toBeVisible();
    expect(await screen.findByText('退货退款')).toBeVisible();
  });

  it('非 Owner 只看到时间线骨架，不请求内部财务接口', async () => {
    let financeRequested = false;
    server.use(
      http.get(apiUrl('/api/staff/finance/orders/:id'), () => {
        financeRequested = true;
        return HttpResponse.json({}, { status: 403 });
      }),
      http.get(apiUrl('/api/staff/order-integrity/:id'), () =>
        HttpResponse.json({
          data: {
            order_integrity: {
              formal_order_id: 'order-1',
              canonical_marketplace_code: 'AMAZON_JP',
              operational_state: 'NORMAL',
              events: [],
              adjustments: [],
            },
          },
          meta: { request_id: 'order-integrity-read' },
        }),
      ),
    );
    renderWithMsw(
      <StaffSessionBoundary adapter={adapter(sellerOps())}>
        <Routes>
          <Route path="/staff/orders/:orderId" element={<StaffOrderDetailPage />} />
        </Routes>
      </StaffSessionBoundary>,
      { route: '/staff/orders/order-1' },
    );
    expect(await screen.findByRole('heading', { name: '订单详情' })).toBeVisible();
    expect(screen.getByText(/计价与财务金额仅 Owner 可见/u)).toBeVisible();
    expect(await screen.findByRole('heading', { name: '全链路时间线' })).toBeVisible();
    expect(screen.getByText('暂无事件记录。')).toBeVisible();
    expect(financeRequested).toBe(false);
  });
});

function adapter(value: StaffSession): StaffAuthApiAdapter {
  return {
    bootstrap: async () => ({
      data: { session: value, access_email: 'staff@example.com' },
      requestId: 'bootstrap',
    }),
    readSession: async () => ({ data: { session: value }, requestId: 'session' }),
    logout: async () => ({
      data: { logged_out: true, all_devices_logged_out: false },
      requestId: 'logout',
    }),
    logoutAll: async () => ({
      data: { logged_out: true, all_devices_logged_out: true, session_version: 2 },
      requestId: 'logout-all',
    }),
  };
}

function session(role: 'owner' | 'seller_ops', permissions: string[]): StaffSession {
  return {
    staff_id: 'staff-1',
    display_name: '测试员工',
    role:
      role === 'owner'
        ? { code: 'owner', display_name: '总管理员' }
        : { code: 'seller_ops', display_name: '卖家对接' },
    permissions,
    data_scope:
      role === 'owner'
        ? {
            type: 'GLOBAL',
            marketplaceCodes: [],
            buyerCustomerIds: [],
            sellerOrganizationIds: [],
            teamIds: [],
          }
        : {
            type: 'ASSIGNED_SELLER_ORGANIZATIONS',
            marketplaceCodes: ['AMAZON_JP'],
            buyerCustomerIds: [],
            sellerOrganizationIds: ['seller-1'],
            teamIds: [],
          },
    authorization_version: 1,
    session_version: 1,
    expires_at: Date.now() + 100_000,
  };
}

function owner(): StaffSession {
  return session('owner', ['SELLER_MANAGE', 'FINANCIAL_CORRECT', 'FINANCIAL_VIEW']);
}
function sellerOps(): StaffSession {
  return session('seller_ops', ['SELLER_MANAGE']);
}

function financeOrderFixture() {
  const position = {
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
  };
  return {
    position,
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
