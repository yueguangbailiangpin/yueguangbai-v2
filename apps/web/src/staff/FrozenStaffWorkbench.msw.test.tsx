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
import { FrozenStaffWorkbench } from './FrozenStaffWorkbench';
import { staffTestAdapter, staffTestSession, staffTestWorkItem } from './test-fixtures';

afterEach(cleanup);

const demandWorkItem = {
  ...staffTestWorkItem,
  work_item_id: 'work-demand', work_type: 'DEMAND_REVIEW' as const,
  source_entity_type: 'DEMAND_BATCH', source_entity_id: 'demand-1',
};

const demandReviewContext = {
  demand_batch_id: 'demand-1', demand_version: 3, status: 'SUBMITTED',
  seller_organization_id: 'seller-1', store_id: 'store-1',
  product_id: 'product-1', product_version_no: 2, product_name: '月光产品',
  task_type: 'IMAGE', target_quantity: 20,
  reservation_deadline: 1_787_000_000_000, order_deadline: 1_788_000_000_000,
  cadence: { order_interval_days: 2, orders_per_run: 5 }, can_publish: true,
  timezone: 'Asia/Shanghai', data_as_of: 1_787_000_000_000,
};

describe('canonical Frozen Staff workbench', () => {
  it('keeps the scoped queue usable when the selected detail is concealed', async () => {
    server.use(
      http.get(apiUrl('/api/staff/me/work-items'), () => HttpResponse.json({ data: { work_items: [staffTestWorkItem], next_cursor: null }, meta: { request_id: 'queue-request' } })),
      http.get(apiUrl('/api/staff/order-evidence/evidence-1'), () => HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'not found', details: null }, meta: { request_id: 'detail-hidden' } }, { status: 404 })),
    );
    const user = userEvent.setup();
    renderWorkbench('/staff?status=OPEN');
    expect(await screen.findByRole('button', { name: /订单资料核对/u })).toBeVisible();
    await user.click(screen.getByRole('button', { name: /订单资料核对/u }));
    expect(await screen.findByText('资源不存在或当前无权访问')).toBeVisible();
    expect(screen.getByText(/detail-hidden/u)).toBeVisible();
    expect(screen.getByRole('button', { name: /订单资料核对/u })).toBeVisible();
  });

  it('does not infer a total when an opaque next cursor exists', async () => {
    server.use(http.get(apiUrl('/api/staff/me/work-items'), () => HttpResponse.json({ data: { work_items: [staffTestWorkItem], next_cursor: 'opaque-next' }, meta: { request_id: 'queue-request' } })));
    renderWorkbench('/staff');
    expect(await screen.findByRole('button', { name: /订单资料核对/u })).toBeVisible();
    expect(screen.queryByText(/共 1|总计 1/u)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下一页' })).toBeEnabled();
  });

  it('publishes a demand with its authoritative version, first date and idempotency key', async () => {
    let body: unknown;
    let key: string | null = null;
    installDemandHandlers(async (request) => {
      body = await request.json(); key = request.headers.get('Idempotency-Key');
      return HttpResponse.json({ data: { demand_review: {
        demand_batch_id: 'demand-1', status: 'PUBLISHED', version: 4, review_reason: null, replayed: false,
        schedule: { schedule_version_id: 'schedule-1', version_no: 1, demand_version: 4, first_order_date: '2026-08-11', theoretical_last_order_date: '2026-08-17', order_interval_days: 2, orders_per_run: 5, affected_reservation_count: 0, preview_hash: 'a'.repeat(64), change_reason: '首次发布需求', changed_by_staff_id: 'staff-1', created_at: 1_787_000_000_000 },
      } }, meta: { request_id: 'demand-published' } });
    });
    const user = userEvent.setup();
    renderWorkbench('/staff?work_item=work-demand');
    expect(await screen.findByText('需求发布事实')).toBeVisible();
    expect(screen.getByText('月光产品 · v2')).toBeVisible();
    expect(screen.getByText('每 2 天 / 5 单')).toBeVisible();
    await user.type(screen.getByLabelText('首个下单日期'), '2026-08-11');
    await user.click(screen.getByRole('button', { name: '通过并发布' }));
    await waitFor(() => expect(body).toEqual({ expected_version: 3, decision: 'PUBLISH', first_order_date: '2026-08-11' }));
    expect(key).toMatch(/\S/u);
  });

  it('rejects a demand through the dedicated review action', async () => {
    let body: unknown;
    installDemandHandlers(async (request) => {
      body = await request.json();
      return HttpResponse.json({ data: { demand_review: { demand_batch_id: 'demand-1', status: 'REJECTED', version: 4, review_reason: '资料需要补充', schedule: null, replayed: false } }, meta: { request_id: 'demand-rejected' } });
    });
    const user = userEvent.setup();
    renderWorkbench('/staff?work_item=work-demand');
    await screen.findByText('需求发布事实');
    await user.type(screen.getByLabelText('拒绝原因'), '资料需要补充');
    await user.click(screen.getByRole('button', { name: '拒绝' }));
    await waitFor(() => expect(body).toEqual({ expected_version: 3, decision: 'REJECT', rejection_reason: '资料需要补充' }));
  });

  it('lets a base demand reviewer reject while hiding publication', async () => {
    server.use(
      http.get(apiUrl('/api/staff/me/work-items'), () => HttpResponse.json({ data: { work_items: [demandWorkItem], next_cursor: null }, meta: { request_id: 'queue-demand' } })),
      http.get(apiUrl('/api/staff/demand-batches/demand-1/review-context'), () => HttpResponse.json({ data: { review_context: { ...demandReviewContext, can_publish: false } }, meta: { request_id: 'demand-context-base' } })),
    );
    renderWorkbench('/staff?work_item=work-demand');
    expect(await screen.findByText('需求发布事实')).toBeVisible();
    expect(screen.queryByLabelText('首个下单日期')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '通过并发布' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '拒绝' })).toBeVisible();
  });
});

function renderWorkbench(route: string): void {
  const session = staffTestSession('owner', ['SELLER_SETTLEMENT_VIEW', 'SELLER_SETTLEMENT_RECORD', 'FINANCIAL_CORRECT']);
  renderWithMsw(<StaffSessionBoundary adapter={staffTestAdapter(session)}><FrozenStaffWorkbench /></StaffSessionBoundary>, { route });
}

function installDemandHandlers(
  mutation: (request: Request) => Promise<Response>,
): void {
  server.use(
    http.get(apiUrl('/api/staff/me/work-items'), () => HttpResponse.json({ data: { work_items: [demandWorkItem], next_cursor: null }, meta: { request_id: 'queue-demand' } })),
    http.get(apiUrl('/api/staff/demand-batches/demand-1/review-context'), () => HttpResponse.json({ data: { review_context: demandReviewContext }, meta: { request_id: 'demand-context' } })),
    http.post(apiUrl('/api/staff/demand-batches/demand-1/review'), ({ request }) => mutation(request)),
  );
}
