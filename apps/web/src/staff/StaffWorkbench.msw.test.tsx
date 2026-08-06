// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import '../test/msw/lifecycle';
import { apiUrl } from '../test/msw/handlers';
import { renderWithMsw } from '../test/msw/render';
import { server } from '../test/msw/server';
import { StaffWorkbench } from './StaffWorkbench';

afterEach(cleanup);

const workItem = {
  work_item_id: 'work-1', work_type: 'ORDER_EVIDENCE_REVIEW',
  source_entity_type: 'ORDER_EVIDENCE', source_entity_id: 'evidence-1',
  buyer_customer_id: 'buyer-1', seller_organization_id: 'seller-1', store_id: 'store-1',
  duty_code: 'BUYER_PRE_SALES_OWNER', fixed_assignment_id: 'assignment-1', assigned_staff_id: 'staff-1',
  status: 'OPEN', version: 1, created_at: 1_787_000_000_000, updated_at: 1_787_000_000_000,
  completed_at: null, cancelled_at: null,
};

describe('Staff internal operations workbench', () => {
  it('loads the scoped queue and keeps it usable when selected detail is concealed', async () => {
    server.use(
      http.get(apiUrl('/api/staff/me/work-items'), () => HttpResponse.json({
        data: { work_items: [workItem], next_cursor: null }, meta: { request_id: 'queue-request' },
      })),
      http.get(apiUrl('/api/staff/order-evidence/evidence-1'), () => HttpResponse.json({
        error: { code: 'NOT_FOUND', message: 'not found', details: null }, meta: { request_id: 'detail-hidden' },
      }, { status: 404 })),
    );
    const user = userEvent.setup();
    renderWithMsw(<StaffWorkbench />, { route: '/staff?status=OPEN' });
    expect(await screen.findByRole('button', { name: /订单证据核对/u })).toBeVisible();
    await user.click(screen.getByRole('button', { name: /订单证据核对/u }));
    expect(await screen.findByText('资源不存在或当前无权访问')).toBeVisible();
    expect(screen.getByText(/detail-hidden/u)).toBeVisible();
    expect(screen.getByRole('button', { name: /订单证据核对/u })).toBeVisible();
  });

  it('does not infer totals when the cursor says another page exists', async () => {
    server.use(http.get(apiUrl('/api/staff/me/work-items'), () => HttpResponse.json({
      data: { work_items: [workItem], next_cursor: 'opaque-next' }, meta: { request_id: 'queue-request' },
    })));
    renderWithMsw(<StaffWorkbench />);
    expect(await screen.findByText('1 项（本页）')).toBeVisible();
    expect(screen.queryByText(/共 1/u)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下一页' })).toBeEnabled();
  });

  it('keeps seller principal, service fee, payment and protected proof independent', async () => {
    const sellerItem = { ...workItem, work_item_id: 'work-seller', work_type: 'PRODUCT_APPLICATION_REVIEW', source_entity_id: 'product-1' };
    server.use(
      http.get(apiUrl('/api/staff/me/work-items'), () => HttpResponse.json({ data: { work_items: [sellerItem], next_cursor: null }, meta: { request_id: 'queue' } })),
      http.get(apiUrl('/api/staff/seller-settlements/seller-1/summary'), () => HttpResponse.json({ data: { settlement: { outstanding_principal_cny_fen: '80000', outstanding_service_fee_cny_fen: '12000', total_outstanding_cny_fen: '92000', unallocated_credit_cny_fen: '3000' } }, meta: { request_id: 'summary' } })),
      http.get(apiUrl('/api/staff/seller-settlements/seller-1/payables'), () => HttpResponse.json({ data: { items: [
        { payable_id: 'principal-1', formal_order_id: 'order-1', amazon_order_number: 'ORDER-1', store: { id: 'store-1', display_name: '美国店铺' }, product: { id: 'product-1', asin: 'B000000001', name: '产品' }, payable_type: 'SELLER_PRINCIPAL', due_amount_cny_fen: '80000', paid_amount_cny_fen: '0', outstanding_amount_cny_fen: '80000', status: 'UNPAID', due_at: 1_787_000_000_000, created_at: 1_787_000_000_000 },
        { payable_id: 'fee-1', formal_order_id: 'order-1', amazon_order_number: 'ORDER-1', store: { id: 'store-1', display_name: '美国店铺' }, product: { id: 'product-1', asin: 'B000000001', name: '产品' }, payable_type: 'SELLER_SERVICE_FEE', due_amount_cny_fen: '12000', paid_amount_cny_fen: '0', outstanding_amount_cny_fen: '12000', status: 'UNPAID', due_at: 1_787_000_000_000, created_at: 1_787_000_000_000 },
      ], page: { limit: 25, next_cursor: null } }, meta: { request_id: 'payables' } })),
      http.get(apiUrl('/api/staff/seller-settlements/seller-1/payments'), () => HttpResponse.json({ data: { items: [{ payment_id: 'payment-1', amount_cny_fen: '3000', paid_at: 1_787_000_000_000, recorded_at: 1_787_000_000_000, allocated_amount_cny_fen: '0', unallocated_amount_cny_fen: '3000', status: 'UNALLOCATED', version: 1, allocations: [], proof: { file_object_id: 'proof-1', file_version: 2, purpose: 'SELLER_SETTLEMENT_PROOF', visibility: 'INTERNAL_ONLY' } }], page: { limit: 25, next_cursor: null } }, meta: { request_id: 'payments' } })),
    );
    renderWithMsw(<StaffWorkbench />, { route: '/staff?work_item=work-seller' });
    expect((await screen.findAllByText('¥800.00 CNY')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('¥120.00 CNY').length).toBeGreaterThan(0);
    expect(screen.getAllByText('本金').length).toBeGreaterThan(0);
    expect(screen.getAllByText('服务费').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '查看卖家结算凭证' })).toBeVisible();
  });
});
