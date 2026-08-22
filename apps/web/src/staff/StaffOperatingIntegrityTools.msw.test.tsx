// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import '../test/msw/lifecycle';
import { StaffSessionBoundary } from '../auth/staff/StaffSessionBoundary';
import { apiUrl } from '../test/msw/handlers';
import { renderWithMsw } from '../test/msw/render';
import { server } from '../test/msw/server';
import { StaffOperatingIntegrityTools } from './StaffOperatingIntegrityTools';
import { staffTestAdapter, staffTestSession } from './test-fixtures';

afterEach(cleanup);

describe('Staff operating integrity mutation closure', () => {
  it('keeps a successful event successful when the follow-up order read fails', async () => {
    let lookupCount = 0;
    let eventBody: unknown;
    server.use(
      http.get(/\/api\/staff\/operating-integrity\/order-lookup/u, () => {
        lookupCount += 1;
        if (lookupCount > 1) {
          return HttpResponse.json(
            {
              error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'temporary read failure', details: null },
              meta: { request_id: 'order-refresh-failed' },
            },
            { status: 503 },
          );
        }
        return HttpResponse.json({ data: { order: orderFixture() }, meta: { request_id: 'order-read' } });
      }),
      http.post(apiUrl('/api/staff/order-integrity/order-1/events'), async ({ request }) => {
        eventBody = await request.json();
        return HttpResponse.json({
          data: {
            event: {
              event_id: 'event-1',
              formal_order_id: 'order-1',
              event_type: 'PLATFORM_CANCELLED',
              reason: '平台取消',
              actor_staff_id: 'staff-1',
              created_at: 1_787_000_000_001,
            },
          },
          meta: { request_id: 'event-written' },
        }, { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderWithMsw(
      <StaffSessionBoundary adapter={staffTestAdapter(staffTestSession('seller_ops', []))}>
        <StaffOperatingIntegrityTools />
      </StaffSessionBoundary>,
      { route: '/staff' },
    );

    await user.type(await screen.findByLabelText('Amazon 订单号'), 'ORDER-1');
    await user.click(screen.getByRole('button', { name: '查找正式订单' }));
    await user.type(await screen.findByLabelText('原因'), '平台取消');
    await user.click(screen.getByRole('button', { name: '记录订单状态' }));

    await waitFor(() => expect(eventBody).toEqual({
      event_type: 'PLATFORM_CANCELLED',
      reason: '平台取消',
    }));
    expect(await screen.findByText(/订单状态已记录为 平台取消。.*服务器写入已成功/u)).toBeVisible();
    expect(screen.getByText(/错误码：DEPENDENCY_UNAVAILABLE/u)).toBeVisible();
    expect(screen.getByText(/order-refresh-failed/u)).toBeVisible();
    expect(screen.queryByText(/记录订单状态未完成/u)).not.toBeInTheDocument();
  });
});

function orderFixture() {
  return {
    formal_order_id: 'order-1',
    amazon_order_number: 'ORDER-1',
    buyer_customer_id: 'buyer-1',
    seller_organization_id: 'seller-1',
    marketplace_code: 'AMAZON_JP',
    product_name: '测试产品',
    confirmed_at: 1_787_000_000_000,
    marketplace_business_date: null,
    review_case_id: null,
    review_status: null,
    has_refund_obligation: null,
    advance_full_amount_cny_fen: null,
    advance_net_cny_fen: null,
    active_advance_payment_id: null,
    operational_state: 'NORMAL',
    actions: {
      record_order_event: { allowed: true, reason: null },
      record_review_visibility: { allowed: false, reason: 'NO_REVIEW' },
      approve_review: { allowed: false, reason: 'NO_REVIEW' },
      record_advance_principal: { allowed: false, reason: 'ROLE_NOT_ALLOWED' },
      record_profit_adjustment: { allowed: false, reason: 'ROLE_NOT_ALLOWED' },
    },
  };
}
