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

describe('Staff product application workflow closure', () => {
  it('prefills the Seller amount and closes after approval without rereading completed facts', async () => {
    let contextReads = 0;
    server.use(
      http.get(apiUrl('/api/staff/me/work-items/work-product'), () =>
        HttpResponse.json({
          data: {
            work_item: {
              work_item_id: 'work-product',
              work_type: 'PRODUCT_APPLICATION_REVIEW',
              source_entity_id: 'application-1',
              status: 'OPEN',
            },
          },
          meta: { request_id: 'work-product-read' },
        })),
      http.get(apiUrl('/api/staff/product-applications/application-1/review-context'), () => {
        contextReads += 1;
        return HttpResponse.json({
          data: {
            review_context: {
              application_id: 'application-1',
              store: { id: 'store-1', display_name: '测试店铺' },
              marketplace_code: 'JP',
              asin: 'B000000001',
              product_name: '咖啡秤',
              search_keywords: ['咖啡秤'],
              product_url: null,
              buyer_visible_notes: null,
              seller_notes: null,
              ordering_guide_expected_amount_jpy: '2999',
              status: 'SUBMITTED',
              version: 1,
              submitted_at: 1_000,
            },
          },
          meta: { request_id: 'product-context-read' },
        });
      }),
      http.post(apiUrl('/api/staff/product-applications/application-1/review'), () =>
        HttpResponse.json({
          data: {
            product_application_review: {
              application_id: 'application-1',
              status: 'APPROVED',
              application_version: 2,
              product_id: 'product-1',
              product_version_id: 'product-version-1',
              review_reason: null,
              replayed: false,
            },
          },
          meta: { request_id: 'product-decision-success' },
        })),
    );
    const user = userEvent.setup();
    renderPanel('/staff?work_item=work-product', [
      'PRODUCT_VIEW', 'PRODUCT_REVIEW', 'DEMAND_PUBLISH',
    ]);

    expect(await screen.findByDisplayValue('2999')).toBeVisible();
    expect(screen.getByText('2999 JPY')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '批准并创建正式产品' }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '批准并创建正式产品' }))
        .not.toBeInTheDocument(),
    );
    expect(contextReads).toBe(1);
  });
});

describe('Staff order instruction publication', () => {
  it('publishes existing keyword text directly without preparing keyword images', async () => {
    let publishedBody: Record<string, unknown> | null = null;
    server.use(
      http.get(apiUrl('/api/staff/me/work-items/work-instruction'), () =>
        HttpResponse.json({
          data: {
            work_item: {
              work_item_id: 'work-instruction',
              work_type: 'ORDER_INSTRUCTION_PUBLISH',
              source_entity_id: 'instruction-1',
              status: 'OPEN',
            },
          },
          meta: { request_id: 'work-instruction-read' },
        })),
      http.get(apiUrl('/api/staff/order-instructions/instruction-1'), () =>
        HttpResponse.json({
          data: {
            order_instruction: {
              instruction_id: 'instruction-1',
              reservation_id: 'reservation-1',
              status: publishedBody ? 'ACTIVE' : 'UNPUBLISHED',
              current_version_no: publishedBody ? 1 : 0,
              version: publishedBody ? 2 : 1,
              published_at: publishedBody ? 2_000 : null,
              initial_deadline_at: publishedBody ? 3_000 : null,
            },
          },
          meta: { request_id: 'instruction-read' },
        })),
      http.post(apiUrl('/api/staff/order-instructions/instruction-1/publish'), async ({ request }) => {
        publishedBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json({
          data: {
            publication: {
              instruction: {
                instruction_id: 'instruction-1', status: 'ACTIVE', version: 2,
              },
              instruction_version_id: 'instruction-version-1',
              content_hash: 'a'.repeat(64),
              replayed: false,
              unchanged: false,
            },
          },
          meta: { request_id: 'instruction-publish' },
        }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderPanel('/staff?work_item=work-instruction', [
      'ORDER_INSTRUCTION_VIEW', 'ORDER_INSTRUCTION_PUBLISH',
    ]);

    expect(await screen.findByText(/店铺名称、搜索关键词/u)).toBeVisible();
    expect(screen.queryByRole('button', { name: /准备关键词图片/u }))
      .not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '直接发布下单指引' }));

    await waitFor(() => expect(publishedBody).toEqual({
      expected_version: 1,
      staff_public_note: null,
    }));
    expect(screen.queryByRole('button', { name: '直接发布下单指引' }))
      .not.toBeInTheDocument();
  });
});

function renderPanel(
  route = '/staff?work_item=work-reservation',
  permissions = ['RESERVATION_VIEW', 'RESERVATION_DECIDE'],
): ReturnType<typeof renderWithMsw> {
  return renderWithMsw(
    <StaffSessionBoundary adapter={staffTestAdapter(staffTestSession('owner', permissions))}>
      <StaffWorkflowClosurePanel />
    </StaffSessionBoundary>,
    { route },
  );
}
