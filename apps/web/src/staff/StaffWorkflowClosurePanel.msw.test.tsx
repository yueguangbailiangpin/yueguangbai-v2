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
import { StaffWorkflowClosurePanel } from './StaffWorkflowClosurePanel';
import { staffTestAdapter, staffTestSession } from './test-fixtures';

afterEach(cleanup);

const workItem = {
  work_item_id: 'work-reservation',
  work_type: 'RESERVATION_DECISION' as const,
  source_entity_id: 'reservation-1',
  status: 'OPEN' as const,
};

const reviewContext = {
  reservation_id: 'reservation-1',
  organization_id: 'seller-org-1',
  buyer: {
    id: 'buyer-1', customer_no: null, name: '测试买家', wechat: 'buyer_wechat_001',
  },
  store: { id: 'store-1', display_name: '测试店铺' },
  marketplace_code: 'JP',
  status: 'PENDING_REVIEW',
  version: 1,
  submitted_at: 1_000,
  hold_expires_at: 2_000,
  order_deadline_snapshot: 3_000,
  buyer_self_pay_bps_snapshot: 0,
  reference_order_amount_jpy_snapshot: '11980',
  estimated_self_pay_jpy_snapshot: '0',
  estimated_refundable_principal_jpy_snapshot: '11980',
  demand: {
    demand_batch_id: 'demand-1',
    product_name: '行车记录仪',
    task_type: 'TEXT',
    reservation_deadline: 2_000,
    order_deadline: 3_000,
  },
};

describe('Staff reservation workflow closure', () => {
  it('shows buyer identity and closes after approval without refetching completed facts', async () => {
    let contextReads = 0;
    server.use(
      http.get(apiUrl('/api/staff/me/work-items/work-reservation'), () =>
        HttpResponse.json({
          data: { work_item: workItem }, meta: { request_id: 'work-item-read' },
        })),
      http.get(apiUrl('/api/staff/reservations/reservation-1/review-context'), () => {
        contextReads += 1;
        return HttpResponse.json({
          data: { review_context: reviewContext }, meta: { request_id: 'context-read' },
        });
      }),
      http.post(apiUrl('/api/staff/reservations/reservation-1/decision'), () =>
        HttpResponse.json({
          data: {
            reservation_decision: {
              reservation_id: 'reservation-1', demand_batch_id: 'demand-1',
              buyer_customer_id: 'buyer-1', status: 'APPROVED', version: 2,
              decision_reason: null, replayed: false,
            },
          },
          meta: { request_id: 'decision-success' },
        })),
    );
    const user = userEvent.setup();
    renderPanel();

    expect(await screen.findByText('测试买家')).toBeVisible();
    expect(screen.getByText('buyer_wechat_001')).toBeVisible();
    expect(screen.getByText('首次正式订单后生成')).toBeVisible();
    expect(screen.getByText('buyer-1')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '批准预约并创建下单指引' }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '批准预约并创建下单指引' }))
        .not.toBeInTheDocument(),
    );
    expect(contextReads).toBe(1);
  });

  it('shows the real safe API code and request id when approval fails', async () => {
    server.use(
      http.get(apiUrl('/api/staff/me/work-items/work-reservation'), () =>
        HttpResponse.json({
          data: { work_item: workItem }, meta: { request_id: 'work-item-read' },
        })),
      http.get(apiUrl('/api/staff/reservations/reservation-1/review-context'), () =>
        HttpResponse.json({
          data: { review_context: reviewContext }, meta: { request_id: 'context-read' },
        })),
      http.post(apiUrl('/api/staff/reservations/reservation-1/decision'), () =>
        HttpResponse.json({
          error: { code: 'VERSION_CONFLICT', message: 'conflict', details: null },
          meta: { request_id: 'decision-conflict-001' },
        }, { status: 409 })),
    );
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole('button', {
      name: '批准预约并创建下单指引',
    }));

    expect(await screen.findByText(/VERSION_CONFLICT/u)).toBeVisible();
    expect(screen.getByText(/decision-conflict-001/u)).toBeVisible();
  });
});

function renderPanel(): ReturnType<typeof renderWithMsw> {
  return renderWithMsw(
    <StaffSessionBoundary adapter={staffTestAdapter(staffTestSession('owner', [
      'RESERVATION_VIEW', 'RESERVATION_DECIDE',
    ]))}>
      <StaffWorkflowClosurePanel />
    </StaffSessionBoundary>,
    { route: '/staff?work_item=work-reservation' },
  );
}
