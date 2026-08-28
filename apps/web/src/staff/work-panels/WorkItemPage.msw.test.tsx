// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router';
import {
  afterEach, describe, expect, it 
} from 'vitest';
import '../../test/msw/lifecycle';
import { StaffSessionBoundary } from '../../auth/staff/StaffSessionBoundary';
import { apiUrl } from '../../test/msw/handlers';
import { renderWithMsw } from '../../test/msw/render';
import { server } from '../../test/msw/server';
import { StaffTaskQueuePage } from '../StaffTaskQueuePage';
import { StaffRefundDetailPage } from '../refunds/StaffRefundDetailPage';
import { staffTestAdapter, staffTestSession, staffTestWorkItem } from '../test-fixtures';
import { WorkItemPage } from './WorkItemPage';

afterEach(cleanup);

const demandWorkItem = {
  ...staffTestWorkItem,
  work_item_id: 'work-demand',
  work_type: 'DEMAND_REVIEW' as const,
  source_entity_type: 'DEMAND_BATCH',
  source_entity_id: 'demand-1',
};

const demandReviewContext = {
  demand_batch_id: 'demand-1',
  demand_version: 3,
  status: 'SUBMITTED',
  seller_organization_id: 'seller-1',
  store_id: 'store-1',
  product_id: 'product-1',
  product_version_no: 2,
  product_name: '月光产品',
  task_type: 'IMAGE',
  target_quantity: 20,
  reservation_deadline: 1_787_000_000_000,
  order_deadline: 1_788_000_000_000,
  cadence: { order_interval_days: 2, orders_per_run: 5 },
  main_image: {
    file_object_id: 'main-image-1',
    file_version: 1,
    client_file_name: 'main.webp',
  },
  ordering_guide_expected_amount_jpy: 2999,
  color_spec_mode: 'MAIN_IMAGE_VARIANT',
  buyer_self_pay_bps_snapshot: null,
  can_publish: true,
  timezone: 'Asia/Shanghai',
  data_as_of: 1_787_000_000_000,
};

const reviewWorkItem = {
  ...staffTestWorkItem,
  work_item_id: 'work-review',
  work_type: 'REVIEW_DECISION' as const,
  source_entity_type: 'REVIEW_CASE',
  source_entity_id: 'review-1',
  duty_code: 'BUYER_AFTER_SALES_OWNER' as const,
};

const staffReview = {
  review_case_id: 'review-1',
  formal_order_id: 'order-1',
  buyer_customer_id: 'buyer-1',
  seller_organization_id: 'seller-1',
  review_type: 'TEXT' as const,
  status: 'PENDING_REVIEW' as const,
  version: 3,
  current_evidence_version_no: 1,
  public_change_reason: null,
  internal_review_note: null,
  submitted_at: 1_787_000_000_000,
  updated_at: 1_787_000_000_000,
  decided_at: null,
  current_evidence: {
    evidence_version_id: 'review-evidence-1',
    version_no: 1,
    review_type: 'TEXT' as const,
    review_url: 'https://example.test/review',
    buyer_note: null,
    submitted_by_buyer_id: 'buyer-1',
    submitted_at: 1_787_000_000_000,
    files: [],
  },
};

const orderEvidenceWorkItem = {
  ...staffTestWorkItem,
  work_item_id: 'work-order',
  work_type: 'ORDER_EVIDENCE_REVIEW' as const,
  source_entity_type: 'ORDER_EVIDENCE',
  source_entity_id: 'evidence-1',
};

const orderEvidence = {
  submission_id: 'evidence-1',
  reservation_id: 'reservation-1',
  marketplace: 'AMAZON_JP' as const,
  status: 'PENDING_VERIFICATION' as const,
  version: 1,
  evidence_version_no: 1,
  amazon_order_number_raw: '250-7817503-1235036',
  amazon_order_number_normalized: '250-7817503-1235036',
  amazon_order_date: '2026-08-22',
  final_paid_jpy: '2999',
  buyer_note: null,
  public_change_reason: null,
  submitted_at: 1_787_000_000_000,
  updated_at: 1_787_000_000_000,
  verified_at: null,
  withdrawn_at: null,
  buyer_customer_id: 'buyer-1',
  internal_review_note: null,
  verified_by_staff_id: null,
  duplicate_signal_count: 0,
  reference_order_amount_jpy: '2999',
  price_difference_jpy: '0',
  price_mismatch: false,
  screenshot: {
    file_object_id: 'screenshot-1',
    file_version: 1,
    purpose: 'ORDER_EVIDENCE' as const,
    visibility: 'BUYER_VISIBLE' as const,
  },
  buyer: { buyer_customer_id: 'buyer-1', buyer_customer_no: null },
  instruction: {
    instruction_id: 'instruction-1',
    instruction_version_id: 'instruction-version-1',
    buyer_self_pay_bps: 0,
    buyer_self_pay_jpy: '0',
    buyer_refundable_principal_jpy: '2999',
  },
  reservation: {
    reservation_id: 'reservation-1',
    status: 'ORDER_EVIDENCE_SUBMITTED',
    version: 4,
  },
  version_history: [
    {
      evidence_version_id: 'evidence-version-1',
      version_no: 1,
      final_paid_jpy: '2999',
      submitted_at: 1_787_000_000_000,
    },
  ],
  workflow: {
    work_item_id: 'work-order',
    assigned_staff_id: 'staff-1',
    assigned_team_id: null,
    fixed_assignment_id: 'assignment-1',
  },
};

const refundWorkItem = {
  ...staffTestWorkItem,
  work_item_id: 'work-refund',
  work_type: 'BUYER_REFUND_PROCESSING' as const,
  source_entity_type: 'BUYER_REFUND_OBLIGATION',
  source_entity_id: 'refund-1',
  duty_code: 'BUYER_REFUND_OWNER' as const,
};

const buyerRefund = {
  obligation_id: 'refund-1',
  buyer_customer_id: 'buyer-1',
  formal_order_id: 'order-1',
  due_amount_cny_fen: '10000',
  gross_paid_cny_fen: '5000',
  reversed_cny_fen: '0',
  net_paid_cny_fen: '5000',
  outstanding_amount_cny_fen: '5000',
  overpaid_amount_cny_fen: '0',
  status: 'PARTIALLY_PAID' as const,
  version: 2,
  created_at: 1_787_000_000_000,
  updated_at: 1_787_000_000_000,
  review_approved_at: 1_787_000_000_000,
  promise_deadline_at: 1_787_606_400_000,
  reminder_count: 2,
  last_reminded_at: 1_787_000_100_000,
  buyer: { buyer_customer_id: 'buyer-1', buyer_customer_no: 'B-1' },
  order: {
    formal_order_id: 'order-1',
    marketplace: 'AMAZON_JP' as const,
    amazon_order_number_normalized: '503-5555555-6666666',
    product_id: 'product-1',
    asin: 'B000000001',
  },
  workflow: {
    work_item_id: 'work-refund',
    assigned_staff_id: 'staff-1',
    assigned_team_id: null,
    fixed_assignment_id: 'assignment-1',
  },
  source_review_event_id: 'review-event-1',
  review_case_id: 'review-1',
  payments: [
    {
      payment_entry_id: 'payment-1',
      amount_cny_fen: '5000',
      paid_at: 1_787_000_000_000,
      china_business_date: '2026-08-12',
      payment_channel: 'WECHAT' as const,
      public_note: null,
      internal_note: null,
      proofs: [],
    },
  ],
  reversals: [],
};

function renderWorkItemPage(
  workItemId: string,
  permissions: string[] = [],
): ReturnType<typeof renderWithMsw> {
  // 完成待办后会返回任务队列首页；给列表端点一个可被覆盖的默认响应。
  server.use(
    http.get(apiUrl('/api/staff/me/work-items'), () =>
      HttpResponse.json({
        data: { work_items: [], next_cursor: null },
        meta: { request_id: 'queue-default' },
      }),
    ),
  );
  return renderWithMsw(
    <StaffSessionBoundary adapter={staffTestAdapter(staffTestSession('owner', permissions))}>
      <Routes>
        <Route path="/staff/work/:workItemId" element={<WorkItemPage />} />
        <Route path="/staff/refunds/:obligationId" element={<StaffRefundDetailPage />} />
        <Route path="/staff" element={<StaffTaskQueuePage />} />
      </Routes>
    </StaffSessionBoundary>,
    { route: `/staff/work/${workItemId}` },
  );
}

function respondWorkItem(item: typeof staffTestWorkItem): Response {
  return HttpResponse.json({
    data: { work_item: item },
    meta: { request_id: `work-item-${item.work_item_id}` },
  });
}

function approvalNextStepProduct(demands: unknown[] = []) {
  return {
    product_id: 'product-1',
    seller_organization_id: 'seller-org-1',
    store_id: 'store-1',
    store_name: '测试店铺',
    marketplace_code: 'AMAZON_JP',
    asin: 'B000000001',
    status: 'ACTIVE',
    aggregate_version: 1,
    current_version_no: 1,
    product_name: '咖啡秤',
    cadence: { order_interval_days: 1, orders_per_run: 1 },
    updated_at: 1_000,
    versions: [{
      product_version_id: 'product-version-1',
      version_no: 1,
      product_name: '咖啡秤',
      search_keywords: ['咖啡秤'],
      ordering_guide_expected_amount_jpy: 2999,
      color_spec_mode: 'MAIN_IMAGE_VARIANT',
      default_buyer_self_pay_bps: 0,
      product_url: null,
      buyer_visible_notes: null,
      internal_notes: null,
      cadence: { order_interval_days: 1, orders_per_run: 1 },
      main_image: null,
      created_at: 1_000,
    }],
    demands,
    timezone: 'Asia/Shanghai',
    data_as_of: 1_000,
  };
}

describe('work item page dispatch', () => {
  it('shows the panel error when the work item detail read is concealed', async () => {
    server.use(
      http.get(apiUrl('/api/staff/me/work-items/work-order'), () =>
        HttpResponse.json(
          {
            error: { code: 'NOT_FOUND', message: 'not found', details: null },
            meta: { request_id: 'detail-hidden' },
          },
          { status: 404 },
        ),
      ),
    );
    renderWorkItemPage('work-order');
    expect(await screen.findByText('资源不存在或无权访问')).toBeVisible();
    expect(screen.getByText(/detail-hidden/u)).toBeVisible();
  });

  it('explains that a completed work item no longer renders its panel', async () => {
    server.use(
      http.get(apiUrl('/api/staff/me/work-items/work-demand'), () =>
        respondWorkItem({ ...demandWorkItem, status: 'COMPLETED', completed_at: 1_787_000_100_000 }),
      ),
    );
    renderWorkItemPage('work-demand');
    expect(await screen.findByText('该待办已处理完成')).toBeVisible();
    expect(screen.getByRole('button', { name: '返回任务队列' })).toBeVisible();
  });
});

describe('demand review panel', () => {
  it('publishes a demand with its authoritative version, first date and idempotency key', async () => {
    let body: unknown;
    let key: string | null = null;
    installDemandHandlers(async (request) => {
      body = await request.json();
      key = request.headers.get('Idempotency-Key');
      return HttpResponse.json({
        data: {
          demand_review: {
            demand_batch_id: 'demand-1',
            status: 'PUBLISHED',
            version: 4,
            review_reason: null,
            replayed: false,
            schedule: null,
          },
        },
        meta: { request_id: 'demand-published' },
      });
    });
    const user = userEvent.setup();
    renderWorkItemPage('work-demand');
    expect(await screen.findByText('需求发布事实')).toBeVisible();
    expect(screen.getByText('月光产品 · v2')).toBeVisible();
    expect(screen.getByText('每 2 天 / 5 单')).toBeVisible();
    await user.type(screen.getByLabelText('首个下单日期'), '2026-08-11');
    await user.click(screen.getByRole('button', { name: '通过并发布' }));
    await waitFor(() =>
      expect(body).toEqual({
        expected_version: 3,
        decision: 'PUBLISH',
        first_order_date: '2026-08-11',
      }),
    );
    expect(key).toMatch(/\S/u);
    // 完成后返回任务队列首页。
    expect(await screen.findByRole('heading', { name: /^我的待办/u })).toBeVisible();
    expect(screen.queryByRole('button', { name: '通过并发布' })).not.toBeInTheDocument();
  });

  it('never re-reads the completed demand facts after publishing', async () => {
    let contextReads = 0;
    let published = false;
    server.use(
      http.get(apiUrl('/api/staff/me/work-items'), () =>
        HttpResponse.json({
          data: { work_items: published ? [] : [demandWorkItem], next_cursor: null },
          meta: { request_id: 'queue-read' },
        }),
      ),
      http.get(apiUrl('/api/staff/me/work-items/work-demand'), () =>
        respondWorkItem(demandWorkItem),
      ),
      http.get(apiUrl('/api/staff/demand-batches/demand-1/review-context'), () => {
        contextReads += 1;
        return HttpResponse.json({
          data: { review_context: demandReviewContext },
          meta: { request_id: `demand-context-${contextReads}` },
        });
      }),
      http.post(apiUrl('/api/staff/demand-batches/demand-1/review'), () => {
        published = true;
        return HttpResponse.json({
          data: {
            demand_review: {
              demand_batch_id: 'demand-1',
              status: 'PUBLISHED',
              version: 4,
              review_reason: null,
              replayed: false,
              schedule: null,
            },
          },
          meta: { request_id: 'demand-published' },
        });
      }),
    );
    const user = userEvent.setup();
    renderWorkItemPage('work-demand');
    expect(await screen.findByText('需求发布事实')).toBeVisible();
    await user.type(screen.getByLabelText('首个下单日期'), '2026-08-11');
    await user.click(screen.getByRole('button', { name: '通过并发布' }));
    expect(await screen.findByRole('heading', { name: /^我的待办/u })).toBeVisible();
    expect(contextReads).toBe(1);
  });

  it.each([
    [
      'a version conflict',
      'VERSION_CONFLICT',
      'demand-version-conflict',
      () =>
        HttpResponse.json(
          {
            error: { code: 'VERSION_CONFLICT', message: 'version conflict', details: null },
            meta: { request_id: 'demand-version-conflict' },
          },
          { status: 409 },
        ),
    ],
    [
      'an invalid first order date',
      'VALIDATION_ERROR',
      'demand-invalid-date',
      () =>
        HttpResponse.json(
          {
            error: { code: 'VALIDATION_ERROR', message: 'invalid date', details: null },
            meta: { request_id: 'demand-invalid-date' },
          },
          { status: 400 },
        ),
    ],
    [
      'a permission denial',
      'FORBIDDEN',
      'demand-forbidden',
      () =>
        HttpResponse.json(
          {
            error: { code: 'FORBIDDEN', message: 'forbidden', details: null },
            meta: { request_id: 'demand-forbidden' },
          },
          { status: 403 },
        ),
    ],
  ])('shows the error code and request id when the publish fails with %s', async (_case, code, requestId, failure) => {
    installDemandHandlers(async () => failure());
    const user = userEvent.setup();
    renderWorkItemPage('work-demand');
    expect(await screen.findByText('需求发布事实')).toBeVisible();
    await user.type(screen.getByLabelText('首个下单日期'), '2026-08-11');
    await user.click(screen.getByRole('button', { name: '通过并发布' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(`错误码：${code}`);
    expect(screen.getByText(new RegExp(requestId, 'u'))).toBeVisible();
    expect(screen.queryByRole('button', { name: '重试原请求' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '通过并发布' })).toBeEnabled();
  });

  it('names the missing product readiness field when publish fails the 409 validation gate', async () => {
    installDemandHandlers(async () =>
      HttpResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: '请求参数不正确',
            details: {
              field: 'main_image',
              reason: '产品版本没有已验证的主图，需先上传并绑定主图再发布。',
            },
          },
          meta: { request_id: 'demand-readiness' },
        },
        { status: 409 },
      ),
    );
    const user = userEvent.setup();
    renderWorkItemPage('work-demand');
    expect(await screen.findByText('需求发布事实')).toBeVisible();
    await user.type(screen.getByLabelText('首个下单日期'), '2026-08-11');
    await user.click(screen.getByRole('button', { name: '通过并发布' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('需先上传并绑定主图再发布');
    expect(alert).toHaveTextContent('错误码：VALIDATION_ERROR');
    expect(alert).not.toHaveTextContent('请检查首个下单日期');
    expect(screen.getByText(/demand-readiness/u)).toBeVisible();
  });

  it('sends exactly one publish request while the button is pending', async () => {
    let requestCount = 0;
    let finish: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    installDemandHandlers(async () => {
      requestCount += 1;
      await gate;
      return HttpResponse.json({
        data: {
          demand_review: {
            demand_batch_id: 'demand-1',
            status: 'PUBLISHED',
            version: 4,
            review_reason: null,
            replayed: false,
            schedule: null,
          },
        },
        meta: { request_id: 'demand-published' },
      });
    });
    const user = userEvent.setup();
    renderWorkItemPage('work-demand');
    expect(await screen.findByText('需求发布事实')).toBeVisible();
    await user.type(screen.getByLabelText('首个下单日期'), '2026-08-11');
    await user.click(screen.getByRole('button', { name: '通过并发布' }));
    const pending = await screen.findByRole('button', { name: '处理中…' });
    expect(pending).toBeDisabled();
    pending.click();
    expect(requestCount).toBe(1);
    finish();
    await screen.findByRole('heading', { name: /^我的待办/u });
    expect(requestCount).toBe(1);
  });

  it('retries the identical publish with the same idempotency key after an ambiguous failure', async () => {
    const keys: string[] = [];
    let attempts = 0;
    installDemandHandlers(async (request) => {
      attempts += 1;
      keys.push(request.headers.get('Idempotency-Key') ?? '');
      if (attempts === 1) return HttpResponse.error();
      return HttpResponse.json({
        data: {
          demand_review: {
            demand_batch_id: 'demand-1',
            status: 'PUBLISHED',
            version: 4,
            review_reason: null,
            replayed: true,
            schedule: null,
          },
        },
        meta: { request_id: 'demand-published-replay' },
      });
    });
    const user = userEvent.setup();
    renderWorkItemPage('work-demand');
    expect(await screen.findByText('需求发布事实')).toBeVisible();
    await user.type(screen.getByLabelText('首个下单日期'), '2026-08-11');
    await user.click(screen.getByRole('button', { name: '通过并发布' }));
    expect(await screen.findByRole('button', { name: '重试原请求' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: '重试原请求' }));
    await screen.findByRole('heading', { name: /^我的待办/u });
    expect(attempts).toBe(2);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  it('rejects a demand through the dedicated review action', async () => {
    let body: unknown;
    installDemandHandlers(async (request) => {
      body = await request.json();
      return HttpResponse.json({
        data: {
          demand_review: {
            demand_batch_id: 'demand-1',
            status: 'REJECTED',
            version: 4,
            review_reason: '资料需要补充',
            schedule: null,
            replayed: false,
          },
        },
        meta: { request_id: 'demand-rejected' },
      });
    });
    const user = userEvent.setup();
    renderWorkItemPage('work-demand');
    await screen.findByText('需求发布事实');
    await user.type(screen.getByLabelText('拒绝原因'), '资料需要补充');
    await user.click(screen.getByRole('button', { name: '拒绝' }));
    await waitFor(() =>
      expect(body).toEqual({
        expected_version: 3,
        decision: 'REJECT',
        rejection_reason: '资料需要补充',
      }),
    );
  });

  it('lets a base demand reviewer reject while hiding publication', async () => {
    server.use(
      http.get(apiUrl('/api/staff/me/work-items/work-demand'), () =>
        respondWorkItem(demandWorkItem),
      ),
      http.get(apiUrl('/api/staff/demand-batches/demand-1/review-context'), () =>
        HttpResponse.json({
          data: { review_context: { ...demandReviewContext, can_publish: false } },
          meta: { request_id: 'demand-context-base' },
        }),
      ),
      http.post(apiUrl('/api/staff/files/main-image-1/read-intents'), () =>
        HttpResponse.json({
          data: {
            read_intent_id: 'demand-main-image-intent',
            file_object_id: 'main-image-1',
            access_token: 'demand-main-image-token'.padEnd(40, 'x'),
            access_token_available: true,
            expires_at: 99,
            replayed: false,
          },
          meta: { request_id: 'demand-main-image-read' },
        }),
      ),
      http.get(apiUrl('/api/staff/file-read-intents/demand-main-image-intent/content'), () =>
        new Response(Uint8Array.of(5, 6), {
          headers: {
            'Content-Type': 'image/webp',
            'Content-Length': '2',
            'Cache-Control': 'private, max-age=300',
            'X-Content-Type-Options': 'nosniff',
          },
        }),
      ),
    );
    renderWorkItemPage('work-demand');
    expect(await screen.findByText('需求发布事实')).toBeVisible();
    expect(screen.queryByLabelText('首个下单日期')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '通过并发布' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '拒绝' })).toBeVisible();
  });
});

describe('review decision panel', () => {
  it('closes a completed review decision without re-reading the completed review fact', async () => {
    let reviewReads = 0;
    let decided = false;
    server.use(
      http.get(apiUrl('/api/staff/me/work-items'), () =>
        HttpResponse.json({
          data: { work_items: decided ? [] : [reviewWorkItem], next_cursor: null },
          meta: { request_id: 'review-queue' },
        }),
      ),
      http.get(apiUrl('/api/staff/me/work-items/work-review'), () =>
        respondWorkItem(reviewWorkItem),
      ),
      http.get(apiUrl('/api/staff/reviews/review-1'), () => {
        reviewReads += 1;
        return HttpResponse.json({
          data: { review: staffReview },
          meta: { request_id: `review-detail-${reviewReads}` },
        });
      }),
      http.post(apiUrl('/api/staff/reviews/review-1/approve'), () => {
        decided = true;
        return HttpResponse.json({
          data: {
            review: {
              review_case_id: 'review-1',
              formal_order_id: 'order-1',
              status: 'APPROVED',
              version: 4,
              current_evidence_version_no: 1,
              current_evidence_version_id: 'review-evidence-1',
              approved_event_id: 'review-event-1',
              financial_events: [],
              replayed: false,
            },
          },
          meta: { request_id: 'review-approved' },
        });
      }),
    );
    const user = userEvent.setup();
    renderWorkItemPage('work-review');
    expect(await screen.findByText('评论资料')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '通过' }));
    expect(await screen.findByRole('heading', { name: /^我的待办/u })).toBeVisible();
    expect(screen.queryByText('评论资料暂时无法加载。')).not.toBeInTheDocument();
    expect(reviewReads).toBe(1);
  });

  it('keeps the review mutation error code and offers a safe fact refresh', async () => {
    installReviewHandlers(async () =>
      HttpResponse.json(
        {
          error: { code: 'VERSION_CONFLICT', message: 'version conflict', details: null },
          meta: { request_id: 'review-version-conflict' },
        },
        { status: 409 },
      ),
    );
    const user = userEvent.setup();
    renderWorkItemPage('work-review');
    await user.click(await screen.findByRole('button', { name: '通过' }));
    expect(await screen.findByText(/错误码：VERSION_CONFLICT/u)).toBeVisible();
    expect(screen.getByText(/review-version-conflict/u)).toBeVisible();
    expect(screen.getByRole('button', { name: '刷新评论事实' })).toBeVisible();
  });
});

describe('order evidence review panel', () => {
  it('closes a successfully approved work item without re-reading completed facts', async () => {
    let completed = false;
    let detailReads = 0;
    let requestBody: unknown;
    let idempotencyKey: string | null = null;
    installOrderHandlers({
      detail: () => {
        detailReads += 1;
        return orderEvidence;
      },
      mutate: async (request) => {
        requestBody = await request.json();
        idempotencyKey = request.headers.get('Idempotency-Key');
        completed = true;
        return HttpResponse.json({
          data: {
            formal_order_id: 'formal-order-1',
            order_evidence_submission_id: 'evidence-1',
            status: 'CONFIRMED',
            version: 1,
            reference_order_amount_jpy: '2999',
            final_paid_jpy: '2999',
            price_difference_jpy: '0',
            price_mismatch_acknowledged: false,
            confirmed_at: 1_787_000_100_000,
            replayed: false,
          },
          meta: { request_id: 'order-approved' },
        });
      },
      queue: () => (completed ? [] : [orderEvidenceWorkItem]),
    });
    const user = userEvent.setup();
    renderWorkItemPage('work-order', ['ORDER_VIEW', 'ORDER_CONFIRM']);
    expect(await screen.findByText('订单资料')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '通过' }));
    expect(await screen.findByRole('heading', { name: /^我的待办/u })).toBeVisible();
    expect(detailReads).toBe(1);
    expect(requestBody).toEqual({ expected_version: 1 });
    expect(idempotencyKey).toMatch(/\S/u);
  });

  it('shows the safe prerequisite code, actionable hint and request id', async () => {
    installOrderHandlers({
      mutate: async () =>
        HttpResponse.json(
          {
            error: {
              code: 'BUYER_DAILY_EXCHANGE_RATE_NOT_FOUND',
              message: 'BUYER_DAILY_EXCHANGE_RATE_NOT_FOUND',
              details: null,
            },
            meta: { request_id: 'order-missing-rate' },
          },
          { status: 404 },
        ),
    });
    const user = userEvent.setup();
    renderWorkItemPage('work-order', ['ORDER_VIEW', 'ORDER_CONFIRM']);
    expect(await screen.findByText('订单资料')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '通过' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('缺少订单日期对应的买家日汇率');
    expect(alert).toHaveTextContent('错误码：BUYER_DAILY_EXCHANGE_RATE_NOT_FOUND');
    expect(screen.getByText(/order-missing-rate/u)).toBeVisible();
    expect(screen.getByRole('button', { name: '刷新订单事实' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '重试原请求' })).not.toBeInTheDocument();
  });

  it('retries an ambiguous approval with the identical body and idempotency key', async () => {
    let completed = false;
    let attempts = 0;
    const keys: string[] = [];
    const bodies: unknown[] = [];
    installOrderHandlers({
      queue: () => (completed ? [] : [orderEvidenceWorkItem]),
      mutate: async (request) => {
        attempts += 1;
        keys.push(request.headers.get('Idempotency-Key') ?? '');
        bodies.push(await request.json());
        if (attempts === 1) return HttpResponse.error();
        completed = true;
        return HttpResponse.json({
          data: {
            formal_order_id: 'formal-order-1',
            order_evidence_submission_id: 'evidence-1',
            status: 'CONFIRMED',
            version: 1,
            reference_order_amount_jpy: '2999',
            final_paid_jpy: '2999',
            price_difference_jpy: '0',
            price_mismatch_acknowledged: false,
            confirmed_at: 1_787_000_100_000,
            replayed: true,
          },
          meta: { request_id: 'order-approved-replay' },
        });
      },
    });
    const user = userEvent.setup();
    renderWorkItemPage('work-order', ['ORDER_VIEW', 'ORDER_CONFIRM']);
    expect(await screen.findByText('订单资料')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '通过' }));
    await user.click(await screen.findByRole('button', { name: '重试原请求' }));
    expect(await screen.findByRole('heading', { name: /^我的待办/u })).toBeVisible();
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    expect(bodies).toEqual([{ expected_version: 1 }, { expected_version: 1 }]);
  });

  it('closes a successful request-changes decision because its work item is complete', async () => {
    let completed = false;
    let path = '';
    let requestBody: unknown;
    installOrderHandlers({
      queue: () => (completed ? [] : [orderEvidenceWorkItem]),
      mutate: async (request) => {
        path = new URL(request.url).pathname;
        requestBody = await request.json();
        completed = true;
        return HttpResponse.json({
          data: {
            submission_id: 'evidence-1',
            reservation_id: 'reservation-1',
            buyer_customer_id: 'buyer-1',
            marketplace: 'AMAZON_JP',
            status: 'CHANGES_REQUESTED',
            version: 2,
            current_evidence_version_no: 1,
            current_evidence_version_id: 'evidence-version-1',
            replayed: false,
            public_change_reason: '订单截图不完整',
          },
          meta: { request_id: 'order-changes-requested' },
        });
      },
    });
    const user = userEvent.setup();
    renderWorkItemPage('work-order', ['ORDER_VIEW', 'ORDER_CONFIRM']);
    expect(await screen.findByText('订单资料')).toBeVisible();
    await user.type(screen.getByLabelText('要求修改原因'), '订单截图不完整');
    await user.click(screen.getByRole('button', { name: '要求修改' }));
    expect(await screen.findByRole('heading', { name: /^我的待办/u })).toBeVisible();
    expect(path).toBe('/api/staff/order-evidence/evidence-1/request-changes');
    expect(requestBody).toEqual({
      expected_version: 1,
      public_reason: '订单截图不完整',
    });
  });
});

describe('buyer refund work item routing', () => {
  it('forwards BUYER_REFUND_PROCESSING work items to the refunds workbench', async () => {
    installRefundHandlers(async () => refundConflict());
    renderWorkItemPage('work-refund');
    expect(
      await screen.findByText('返款处理'),
    ).toBeVisible();
    expect(screen.getByText(/返回返款工作台/u)).toBeVisible();
  });
});

describe('reservation decision panel', () => {
  const reservationWorkItem = {
    ...staffTestWorkItem,
    work_item_id: 'work-reservation',
    work_type: 'RESERVATION_DECISION' as const,
    source_entity_type: 'RESERVATION',
    source_entity_id: 'reservation-1',
  };
  const reservationContext = {
    reservation_id: 'reservation-1',
    organization_id: 'seller-org-1',
    buyer: {
      id: 'buyer-1',
      customer_no: null,
      name: '测试买家',
      wechat: 'buyer_wechat_001',
    },
    store: { id: 'store-1', display_name: '测试店铺' },
    marketplace_code: 'AMAZON_JP',
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

  it('shows buyer identity and closes after approval without refetching completed facts', async () => {
    let contextReads = 0;
    server.use(
      http.get(apiUrl('/api/staff/me/work-items/work-reservation'), () =>
        respondWorkItem(reservationWorkItem),
      ),
      http.get(apiUrl('/api/staff/reservations/reservation-1/review-context'), () => {
        contextReads += 1;
        return HttpResponse.json({
          data: { review_context: reservationContext },
          meta: { request_id: 'context-read' },
        });
      }),
      http.post(apiUrl('/api/staff/reservations/reservation-1/decision'), () =>
        HttpResponse.json({
          data: {
            reservation_decision: {
              reservation_id: 'reservation-1',
              demand_batch_id: 'demand-1',
              buyer_customer_id: 'buyer-1',
              status: 'APPROVED',
              version: 2,
              decision_reason: null,
              replayed: false,
            },
          },
          meta: { request_id: 'decision-success' },
        })),
    );
    const user = userEvent.setup();
    renderWorkItemPage('work-reservation', ['RESERVATION_VIEW', 'RESERVATION_DECIDE']);

    expect(await screen.findByText('测试买家')).toBeVisible();
    expect(screen.getByText('buyer_wechat_001')).toBeVisible();
    expect(screen.getByText('首次正式订单后生成')).toBeVisible();
    expect(screen.getByText('buyer-1')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '批准预约并创建下单指引' }));

    expect(await screen.findByRole('heading', { name: /^我的待办/u })).toBeVisible();
    expect(contextReads).toBe(1);
  });

  it('shows the real safe API code and request id when approval fails', async () => {
    server.use(
      http.get(apiUrl('/api/staff/me/work-items/work-reservation'), () =>
        respondWorkItem(reservationWorkItem),
      ),
      http.get(apiUrl('/api/staff/reservations/reservation-1/review-context'), () =>
        HttpResponse.json({
          data: { review_context: reservationContext },
          meta: { request_id: 'context-read' },
        }),
      ),
      http.post(apiUrl('/api/staff/reservations/reservation-1/decision'), () =>
        HttpResponse.json(
          {
            error: { code: 'VERSION_CONFLICT', message: 'conflict', details: null },
            meta: { request_id: 'decision-conflict-001' },
          },
          { status: 409 },
        )),
    );
    const user = userEvent.setup();
    renderWorkItemPage('work-reservation', ['RESERVATION_VIEW', 'RESERVATION_DECIDE']);
    await user.click(
      await screen.findByRole('button', { name: '批准预约并创建下单指引' }),
    );
    expect(await screen.findByText(/VERSION_CONFLICT/u)).toBeVisible();
    expect(screen.getByText(/decision-conflict-001/u)).toBeVisible();
  });
});

describe('product application review panel', () => {
  it('prefills the seller amount and closes after approval without rereading completed facts', async () => {
    const productWorkItem = {
      ...staffTestWorkItem,
      work_item_id: 'work-product',
      work_type: 'PRODUCT_APPLICATION_REVIEW' as const,
      source_entity_type: 'PRODUCT_APPLICATION',
      source_entity_id: 'application-1',
    };
    let contextReads = 0;
    server.use(
      http.get(apiUrl('/api/staff/me/work-items/work-product'), () =>
        respondWorkItem(productWorkItem),
      ),
      http.get(apiUrl('/api/staff/product-applications/application-1/review-context'), () => {
        contextReads += 1;
        return HttpResponse.json({
          data: {
            review_context: {
              application_id: 'application-1',
              store: { id: 'store-1', display_name: '测试店铺' },
              marketplace_code: 'AMAZON_JP',
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
              images: [],
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
              main_image_file_object_id: null,
              review_reason: null,
              replayed: false,
            },
          },
          meta: { request_id: 'product-decision-success' },
        })),
    );
    server.use(
      http.get(apiUrl('/api/staff/catalog/products/product-1'), () =>
        HttpResponse.json({
          data: { product: approvalNextStepProduct() },
          meta: { request_id: 'product-detail-next-step' },
        }),
      ),
    );
    const user = userEvent.setup();
    renderWorkItemPage('work-product', ['PRODUCT_VIEW', 'PRODUCT_REVIEW', 'DEMAND_PUBLISH']);

    expect(await screen.findByDisplayValue('2999')).toBeVisible();
    expect(screen.getByText('2999 JPY')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '批准并创建正式产品' }));

    expect(await screen.findByText('已通过并创建正式产品。')).toBeVisible();
    expect(screen.getByText('连审第二步：发布数量计划')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '返回任务队列' }));

    expect(await screen.findByRole('heading', { name: /^我的待办/u })).toBeVisible();
    expect(contextReads).toBe(1);
  });

  it('shows application images and submits the selected main image with approval', async () => {
    const productWorkItem = {
      ...staffTestWorkItem,
      work_item_id: 'work-product-image',
      work_type: 'PRODUCT_APPLICATION_REVIEW' as const,
      source_entity_type: 'PRODUCT_APPLICATION',
      source_entity_id: 'application-1',
    };
    const submittedBodies: Record<string, unknown>[] = [];
    server.use(
      http.get(apiUrl('/api/staff/me/work-items/work-product-image'), () =>
        respondWorkItem(productWorkItem),
      ),
      http.get(apiUrl('/api/staff/product-applications/application-1/review-context'), () =>
        HttpResponse.json({
          data: {
            review_context: {
              application_id: 'application-1',
              store: { id: 'store-1', display_name: '测试店铺' },
              marketplace_code: 'AMAZON_JP',
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
              images: [
                {
                  file_object_id: 'application-image-1',
                  file_version: 1,
                  client_file_name: 'front.png',
                },
                {
                  file_object_id: 'application-image-2',
                  file_version: 1,
                  client_file_name: 'side.png',
                },
              ],
            },
          },
          meta: { request_id: 'product-context-read' },
        }),
      ),
      http.post(apiUrl('/api/staff/product-applications/application-1/review'), async ({ request }) => {
        submittedBodies.push(await request.json() as Record<string, unknown>);
        return HttpResponse.json({
          data: {
            product_application_review: {
              application_id: 'application-1',
              status: 'APPROVED',
              application_version: 2,
              product_id: 'product-1',
              product_version_id: 'product-version-1',
              main_image_file_object_id: 'application-image-1',
              review_reason: null,
              replayed: false,
            },
          },
          meta: { request_id: 'product-decision-image' },
        });
      }),
      http.post(apiUrl('/api/staff/files/application-image-1/read-intents'), () =>
        HttpResponse.json({
          data: {
            read_intent_id: 'application-image-1-intent',
            file_object_id: 'application-image-1',
            access_token: 'application-image-1-token'.padEnd(40, 'x'),
            access_token_available: true,
            expires_at: 99,
            replayed: false,
          },
          meta: { request_id: 'application-image-1-read' },
        }),
      ),
      http.get(apiUrl('/api/staff/file-read-intents/application-image-1-intent/content'), () =>
        new Response(Uint8Array.of(1, 2), {
          headers: {
            'Content-Type': 'image/png',
            'Content-Length': '2',
            'Cache-Control': 'private, max-age=300',
            'X-Content-Type-Options': 'nosniff',
          },
        }),
      ),
      http.post(apiUrl('/api/staff/files/application-image-2/read-intents'), () =>
        HttpResponse.json({
          data: {
            read_intent_id: 'application-image-2-intent',
            file_object_id: 'application-image-2',
            access_token: 'application-image-2-token'.padEnd(40, 'x'),
            access_token_available: true,
            expires_at: 99,
            replayed: false,
          },
          meta: { request_id: 'application-image-2-read' },
        }),
      ),
      http.get(apiUrl('/api/staff/file-read-intents/application-image-2-intent/content'), () =>
        new Response(Uint8Array.of(3, 4), {
          headers: {
            'Content-Type': 'image/png',
            'Content-Length': '2',
            'Cache-Control': 'private, max-age=300',
            'X-Content-Type-Options': 'nosniff',
          },
        }),
      ),
    );
    server.use(
      http.get(apiUrl('/api/staff/catalog/products/product-1'), () =>
        HttpResponse.json({
          data: { product: approvalNextStepProduct() },
          meta: { request_id: 'product-detail-next-step-image' },
        }),
      ),
    );
    const user = userEvent.setup();
    renderWorkItemPage('work-product-image', ['PRODUCT_VIEW', 'PRODUCT_REVIEW', 'DEMAND_PUBLISH']);

    expect(await screen.findByText('申请图（勾选一张作为正式产品主图）')).toBeVisible();
    expect(screen.getByText(/第 1 张（默认）/u)).toBeVisible();
    expect(screen.getByText(/第 2 张/u)).toBeVisible();

    await user.click(screen.getByRole('radio', { name: /第 2 张/u }));
    await user.click(screen.getByRole('button', { name: '批准并创建正式产品' }));

    expect(await screen.findByText('已通过并创建正式产品。')).toBeVisible();
    expect(screen.getByText('已绑定（审批时勾选的申请图）')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '返回任务队列' }));

    expect(await screen.findByRole('heading', { name: /^我的待办/u })).toBeVisible();
    expect(submittedBodies).toHaveLength(1);
    expect(submittedBodies[0]).toMatchObject({
      decision: 'APPROVE',
      main_image_file_object_id: 'application-image-2',
    });
  });

  it('offers the connected demand publish step once the seller submits a quantity plan', async () => {
    const productWorkItem = {
      ...staffTestWorkItem,
      work_item_id: 'work-product-connected',
      work_type: 'PRODUCT_APPLICATION_REVIEW' as const,
      source_entity_type: 'PRODUCT_APPLICATION',
      source_entity_id: 'application-1',
    };
    server.use(
      http.get(apiUrl('/api/staff/me/work-items/work-product-connected'), () =>
        respondWorkItem(productWorkItem),
      ),
      http.get(apiUrl('/api/staff/product-applications/application-1/review-context'), () =>
        HttpResponse.json({
          data: {
            review_context: {
              application_id: 'application-1',
              store: { id: 'store-1', display_name: '测试店铺' },
              marketplace_code: 'AMAZON_JP',
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
              images: [],
            },
          },
          meta: { request_id: 'product-context-connected' },
        }),
      ),
      http.post(apiUrl('/api/staff/product-applications/application-1/review'), () =>
        HttpResponse.json({
          data: {
            product_application_review: {
              application_id: 'application-1',
              status: 'APPROVED',
              application_version: 2,
              product_id: 'product-1',
              product_version_id: 'product-version-1',
              main_image_file_object_id: null,
              review_reason: null,
              replayed: false,
            },
          },
          meta: { request_id: 'product-decision-connected' },
        })),
      http.get(apiUrl('/api/staff/catalog/products/product-1'), () =>
        HttpResponse.json({
          data: {
            product: approvalNextStepProduct([
              {
                demand_batch_id: 'demand-9',
                status: 'SUBMITTED',
                target_quantity: 8,
                effective_reservation_count: 0,
                order_deadline: 1_788_000_000_000,
                demand_version: 1,
                schedule_version: null,
                first_order_date: null,
              },
            ]),
          },
          meta: { request_id: 'product-detail-demand-waiting' },
        }),
      ),
    );
    const user = userEvent.setup();
    renderWorkItemPage('work-product-connected', ['PRODUCT_VIEW', 'PRODUCT_REVIEW', 'DEMAND_PUBLISH']);
    // renderWorkItemPage 注册默认空队列 handler（server.use 后注册优先），
    // 必须在其后再覆盖带 work_type 分支的队列响应。
    server.use(
      http.get(apiUrl('/api/staff/me/work-items'), ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get('work_type') === 'DEMAND_REVIEW') {
          return HttpResponse.json({
            data: {
              work_items: [
                {
                  ...staffTestWorkItem,
                  work_item_id: 'work-demand-connected',
                  work_type: 'DEMAND_REVIEW',
                  source_entity_type: 'DEMAND_BATCH',
                  source_entity_id: 'demand-9',
                },
              ],
              next_cursor: null,
            },
            meta: { request_id: 'queue-demand-review' },
          });
        }
        return HttpResponse.json({
          data: { work_items: [], next_cursor: null },
          meta: { request_id: 'queue-empty' },
        });
      }),
    );

    expect(await screen.findByDisplayValue('2999')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '批准并创建正式产品' }));

    expect(await screen.findByRole('button', { name: '去发布数量计划（8 单）' })).toBeVisible();
    expect(screen.getByText('连审第二步：发布数量计划')).toBeVisible();
  });
});

describe('order instruction publish panel', () => {
  it('publishes existing keyword text directly without preparing keyword images', async () => {
    const instructionWorkItem = {
      ...staffTestWorkItem,
      work_item_id: 'work-instruction',
      work_type: 'ORDER_INSTRUCTION_PUBLISH' as const,
      source_entity_type: 'ORDER_INSTRUCTION',
      source_entity_id: 'instruction-1',
    };
    let publishedBody: Record<string, unknown> | null = null;
    server.use(
      http.get(apiUrl('/api/staff/me/work-items/work-instruction'), () =>
        respondWorkItem(instructionWorkItem),
      ),
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
                instruction_id: 'instruction-1',
                status: 'ACTIVE',
                version: 2,
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
    renderWorkItemPage('work-instruction', [
      'ORDER_INSTRUCTION_VIEW',
      'ORDER_INSTRUCTION_PUBLISH',
    ]);

    expect(await screen.findByText(/店铺名称、搜索关键词/u)).toBeVisible();
    expect(screen.queryByRole('button', { name: /准备关键词图片/u })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '直接发布下单指引' }));

    await waitFor(() =>
      expect(publishedBody).toEqual({
        expected_version: 1,
        staff_public_note: null,
      }),
    );
    expect(await screen.findByRole('heading', { name: /^我的待办/u })).toBeVisible();
  });
});

function installDemandHandlers(mutation: (request: Request) => Promise<Response>): void {
  server.use(
    http.get(apiUrl('/api/staff/me/work-items'), () =>
      HttpResponse.json({
        data: { work_items: [demandWorkItem], next_cursor: null },
        meta: { request_id: 'queue-demand' },
      }),
    ),
    http.get(apiUrl('/api/staff/me/work-items/work-demand'), () =>
      respondWorkItem(demandWorkItem),
    ),
    http.get(apiUrl('/api/staff/demand-batches/demand-1/review-context'), () =>
      HttpResponse.json({
        data: { review_context: demandReviewContext },
        meta: { request_id: 'demand-context' },
      }),
    ),
    http.post(apiUrl('/api/staff/demand-batches/demand-1/review'), ({ request }) =>
      mutation(request),
    ),
    http.post(apiUrl('/api/staff/files/main-image-1/read-intents'), () =>
      HttpResponse.json({
        data: {
          read_intent_id: 'demand-main-image-intent',
          file_object_id: 'main-image-1',
          access_token: 'demand-main-image-token'.padEnd(40, 'x'),
          access_token_available: true,
          expires_at: 99,
          replayed: false,
        },
        meta: { request_id: 'demand-main-image-read' },
      }),
    ),
    http.get(apiUrl('/api/staff/file-read-intents/demand-main-image-intent/content'), () =>
      new Response(Uint8Array.of(5, 6), {
        headers: {
          'Content-Type': 'image/webp',
          'Content-Length': '2',
          'Cache-Control': 'private, max-age=300',
          'X-Content-Type-Options': 'nosniff',
        },
      }),
    ),
  );
}

function installReviewHandlers(mutation: () => Promise<Response>): void {
  server.use(
    http.get(apiUrl('/api/staff/me/work-items'), () =>
      HttpResponse.json({
        data: { work_items: [reviewWorkItem], next_cursor: null },
        meta: { request_id: 'queue-review' },
      }),
    ),
    http.get(apiUrl('/api/staff/me/work-items/work-review'), () =>
      respondWorkItem(reviewWorkItem),
    ),
    http.get(apiUrl('/api/staff/reviews/review-1'), () =>
      HttpResponse.json({
        data: { review: staffReview },
        meta: { request_id: 'review-detail' },
      }),
    ),
    http.post(apiUrl('/api/staff/reviews/review-1/approve'), () => mutation()),
  );
}

function installOrderHandlers(options: {
  queue?: () => (typeof staffTestWorkItem)[];
  detail?: () => typeof orderEvidence;
  mutate: (request: Request) => Promise<Response>;
}): void {
  server.use(
    http.get(apiUrl('/api/staff/me/work-items'), () =>
      HttpResponse.json({
        data: {
          work_items: options.queue?.() ?? [orderEvidenceWorkItem],
          next_cursor: null,
        },
        meta: { request_id: 'order-queue' },
      }),
    ),
    http.get(apiUrl('/api/staff/me/work-items/work-order'), () =>
      respondWorkItem(orderEvidenceWorkItem),
    ),
    http.get(apiUrl('/api/staff/order-evidence/evidence-1'), () =>
      HttpResponse.json({
        data: { order_evidence: options.detail?.() ?? orderEvidence },
        meta: { request_id: 'order-detail' },
      }),
    ),
    http.post(apiUrl('/api/staff/files/screenshot-1/read-intents'), () =>
      HttpResponse.json({
        data: {
          read_intent_id: 'order-screenshot-intent',
          file_object_id: 'screenshot-1',
          access_token: 'order-screenshot-token'.padEnd(40, 'x'),
          access_token_available: true,
          expires_at: 99,
          replayed: false,
        },
        meta: { request_id: 'order-screenshot-read' },
      }),
    ),
    http.get(apiUrl('/api/staff/file-read-intents/order-screenshot-intent/content'), () =>
      new Response(Uint8Array.of(1, 2), {
        headers: {
          'Content-Type': 'image/png',
          'Content-Length': '2',
          'Cache-Control': 'private, max-age=300',
          'X-Content-Type-Options': 'nosniff',
        },
      }),
    ),
    http.get(apiUrl('/api/staff/order-evidence/evidence-1/preflight'), () =>
      HttpResponse.json({
        data: {
          preflight: {
            submission_id: 'evidence-1',
            amazon_order_date: '2026-08-22',
            ready: true,
            checks: [
              {
                code: 'ORDER_DAY_BASE_RATE',
                status: 'READY',
                message: '订单日基础汇率已确认。',
                action_path: '/staff/finance?section=base-rate&business_date=2026-08-22',
                required_access: '总管理员 + 财务更正权限',
              },
              {
                code: 'SELLER_PRINCIPAL_MARKUP',
                status: 'READY',
                message: '卖家本金汇率加点已确认。',
                action_path: '/staff/finance?section=seller-markup&business_date=2026-08-22',
                required_access: '总管理员 + 财务更正权限',
              },
              {
                code: 'SELLER_SERVICE_FEE',
                status: 'READY',
                message: '卖家服务费规则已确认。',
                action_path: '/staff/seller-service-fees',
                required_access: '总管理员 + 财务更正权限',
              },
            ],
          },
        },
        meta: { request_id: 'order-preflight' },
      }),
    ),
    http.post(apiUrl('/api/staff/order-evidence/evidence-1/approve'), ({ request }) =>
      options.mutate(request),
    ),
    http.post(apiUrl('/api/staff/order-evidence/evidence-1/request-changes'), ({ request }) =>
      options.mutate(request),
    ),
  );
}

function installRefundHandlers(mutation: () => Promise<Response>): void {
  server.use(
    http.get(apiUrl('/api/staff/me/work-items'), () =>
      HttpResponse.json({
        data: { work_items: [refundWorkItem], next_cursor: null },
        meta: { request_id: 'queue-refund' },
      }),
    ),
    http.get(apiUrl('/api/staff/me/work-items/work-refund'), () =>
      respondWorkItem(refundWorkItem),
    ),
    http.get(apiUrl('/api/staff/buyer-refunds/refund-1'), () =>
      HttpResponse.json({
        data: { buyer_refund: buyerRefund },
        meta: { request_id: 'refund-detail' },
      }),
    ),
    http.post(apiUrl('/api/staff/buyer-refunds/refund-1/payments/payment-1/reversals'), () =>
      mutation(),
    ),
  );
}

function refundConflict(): Response {
  return HttpResponse.json(
    {
      error: { code: 'VERSION_CONFLICT', message: 'version conflict', details: null },
      meta: { request_id: 'refund-version-conflict' },
    },
    { status: 409 },
  );
}
