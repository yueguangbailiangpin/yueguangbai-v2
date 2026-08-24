// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import '../../test/msw/lifecycle';
import { StaffSessionBoundary } from '../../auth/staff/StaffSessionBoundary';
import { apiUrl } from '../../test/msw/handlers';
import { renderWithMsw } from '../../test/msw/render';
import { server } from '../../test/msw/server';
import { staffTestAdapter, staffTestSession } from '../test-fixtures';
import { StaffRefundDetailPage } from './StaffRefundDetailPage';
import { StaffRefundsPage } from './StaffRefundsPage';

afterEach(cleanup);

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
  reminder_count: 2,
  last_reminded_at: 1_787_000_100_000,
  buyer: { buyer_customer_id: 'buyer-1', buyer_customer_no: 'B-1' },
  order: {
    formal_order_id: 'order-1',
    marketplace: 'JP' as const,
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

function refundListItem() {
  // 列表项是 detail DTO 的严格子集；剥掉 detail 扩展字段。
  const {
    source_review_event_id: _sourceReviewEventId,
    review_case_id: _reviewCaseId,
    payments: _payments,
    reversals: _reversals,
    ...listItem
  } = structuredClone(buyerRefund);
  return listItem;
}

function installRefundHandlers(mutation: () => Promise<Response>): void {
  server.use(
    http.get(apiUrl('/api/staff/buyer-refunds'), () =>
      HttpResponse.json({
        data: { items: [refundListItem()], next_cursor: null },
        meta: { request_id: 'refund-list' },
      }),
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

function renderRefundsPage(): ReturnType<typeof renderWithMsw> {
  return renderWithMsw(
    <StaffSessionBoundary adapter={staffTestAdapter(staffTestSession('owner'))}>
      <Routes>
        <Route path="/staff/refunds" element={<StaffRefundsPage />} />
        <Route path="/staff/refunds/:obligationId" element={<StaffRefundDetailPage />} />
      </Routes>
    </StaffSessionBoundary>,
    { route: '/staff/refunds' },
  );
}

function renderRefundDetail(): ReturnType<typeof renderWithMsw> {
  return renderWithMsw(
    <StaffSessionBoundary adapter={staffTestAdapter(staffTestSession('owner'))}>
      <Routes>
        <Route path="/staff/refunds" element={<StaffRefundsPage />} />
        <Route path="/staff/refunds/:obligationId" element={<StaffRefundDetailPage />} />
      </Routes>
    </StaffSessionBoundary>,
    { route: '/staff/refunds/refund-1' },
  );
}

describe('staff refunds workbench list', () => {
  it('lists refund obligations with amounts, status and a direct handling link', async () => {
    installRefundHandlers(async () => refundConflict());
    renderRefundsPage();
    expect(await screen.findByText(/待结清 1 笔/u)).toBeVisible();
    expect(screen.getByText(/503-5555555-6666666/u)).toBeVisible();
    expect(screen.getByText(/ASIN B000000001/u)).toBeVisible();
    expect(screen.getByText(/应返 ¥100\.00 CNY/u)).toBeVisible();
    expect(screen.getByText(/待返 ¥50\.00 CNY/u)).toBeVisible();
    expect(screen.getByText(/买家催办 2 次/u)).toBeVisible();
    expect(screen.getByRole('link', { name: '去处理' })).toHaveAttribute(
      'href',
      '/staff/refunds/refund-1',
    );
  });

  it('shows an empty state when there are no refund obligations', async () => {
    server.use(
      http.get(apiUrl('/api/staff/buyer-refunds'), () =>
        HttpResponse.json({
          data: { items: [], next_cursor: null },
          meta: { request_id: 'refund-list-empty' },
        }),
      ),
    );
    renderRefundsPage();
    expect(await screen.findByText('暂无返款记录。评论通过后返款义务会自动出现在这里。')).toBeVisible();
  });

  it('reports a clear failure when the buyer_refund role is missing', async () => {
    server.use(
      http.get(apiUrl('/api/staff/buyer-refunds'), () =>
        HttpResponse.json(
          {
            error: { code: 'FORBIDDEN', message: 'forbidden', details: null },
            meta: { request_id: 'refund-list-forbidden' },
          },
          { status: 403 },
        ),
      ),
    );
    renderRefundsPage();
    expect(await screen.findByText(/返款列表读取失败/u)).toBeVisible();
  });
});

describe('staff refund detail', () => {
  it('keeps refund confirmation disabled while a financial request is pending', async () => {
    let requestCount = 0;
    let finish: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    installRefundHandlers(async () => {
      requestCount += 1;
      await gate;
      return refundConflict();
    });
    const user = userEvent.setup();
    renderRefundDetail();
    await user.click(await screen.findByRole('button', { name: '冲正' }));
    await user.click(screen.getByRole('button', { name: '确认冲正' }));
    expect(await screen.findByRole('button', { name: '处理中…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
    screen.getByRole('button', { name: '处理中…' }).click();
    expect(requestCount).toBe(1);
    finish();
    expect(
      await screen.findByText(
        '冲正未完成。返款事实已被其他人更新，请刷新返款事实后再操作。（错误码：VERSION_CONFLICT）',
      ),
    ).toBeVisible();
  });

  it('shows the request id and a server-fact refresh after a rejected refund mutation', async () => {
    installRefundHandlers(async () => refundConflict());
    const user = userEvent.setup();
    renderRefundDetail();
    await user.click(await screen.findByRole('button', { name: '冲正' }));
    await user.click(screen.getByRole('button', { name: '确认冲正' }));
    expect(await screen.findByText(/refund-version-conflict/u)).toBeVisible();
    expect(screen.getByRole('button', { name: '刷新返款事实' })).toBeVisible();
  });

  it('shows buyer reminder facts without adding a task action', async () => {
    installRefundHandlers(async () => refundConflict());
    renderRefundDetail();
    expect(await screen.findByText(/催办次数：2/u)).toBeVisible();
    expect(screen.getByText(/催办次数：2/u)).toBeVisible();
    expect(screen.getByText(/最后催办：/u)).toBeVisible();
    expect(screen.queryByRole('button', { name: /催返款/u })).not.toBeInTheDocument();
  });

  it('records a payment converting yuan input into integer fen', async () => {
    const paymentBodies: Record<string, unknown>[] = [];
    installRefundHandlers(async () => refundConflict());
    server.use(
      http.post(apiUrl('/api/staff/file-uploads/buyer-refund-proofs/intents'), () =>
        HttpResponse.json({
          data: {
            upload_intent_id: 'proof-intent', purpose: 'BUYER_REFUND_PROOF',
            visibility: 'INTERNAL_ONLY', status: 'ISSUED', version: 1,
            expires_at: 1_900_000_000_000,
            uploads: [{
              file_object_id: 'proof-file-1', slot_no: 1,
              upload_token: 'proof-token'.padEnd(40, 'x'),
              upload_token_available: true, expires_at: 1_900_000_000_000,
            }],
            replayed: false,
          },
          meta: { request_id: 'proof-intent' },
        })),
      http.put(apiUrl('/api/staff/file-uploads/proof-file-1/content'), () =>
        HttpResponse.json({
          data: {
            file_object_id: 'proof-file-1', upload_intent_id: 'proof-intent',
            status: 'UPLOADED', detected_mime: 'image/png', byte_size: 4,
            sha256: 'a'.repeat(64), version: 2, replayed: false,
          },
          meta: { request_id: 'proof-upload' },
        })),
      http.post(apiUrl('/api/staff/file-upload-intents/proof-intent/complete'), () =>
        HttpResponse.json({
          data: {
            upload_intent_id: 'proof-intent', status: 'VERIFIED', version: 2,
            files: [{
              file_object_id: 'proof-file-1', purpose: 'BUYER_REFUND_PROOF',
              visibility: 'INTERNAL_ONLY', detected_mime: 'image/png',
              byte_size: 4, sha256: 'a'.repeat(64), version: 3,
            }],
            replayed: false,
          },
          meta: { request_id: 'proof-complete' },
        })),
      http.post(apiUrl('/api/staff/buyer-refunds/refund-1/payments'), async ({ request }) => {
        paymentBodies.push(await request.json() as Record<string, unknown>);
        return HttpResponse.json({
          data: {
            obligation: buyerRefund,
            payment: {
              payment_entry_id: 'payment-2', amount_cny_fen: '14995',
              paid_at: 1_787_100_000_000, china_business_date: '2026-08-23',
              payment_channel: 'WECHAT', public_note: null, internal_note: null,
              proofs: [],
            },
            replayed: false,
          },
          meta: { request_id: 'refund-payment' },
        });
      }),
    );
    const user = userEvent.setup();
    renderRefundDetail();
    await user.upload(
      await screen.findByLabelText('买家返款凭证'),
      new File([new Uint8Array([1, 2, 3, 4])], 'proof.png', { type: 'image/png' }),
    );
    expect(await screen.findByText('凭证：VERIFIED')).toBeVisible();
    await user.type(screen.getByLabelText(/实际返款（元/), '149.95');
    await user.click(screen.getByRole('button', { name: '记录' }));
    expect(await screen.findByText('149.95 元')).toBeVisible();
    expect(screen.getByText(/提交 14995 分/u)).toBeVisible();
    await user.click(screen.getByRole('button', { name: '确认' }));
    await screen.findByText(/催办次数：/u);
    expect(paymentBodies).toHaveLength(1);
    expect(paymentBodies[0]).toMatchObject({
      amount_cny_fen: '14995',
      proof_files: [{ file_object_id: 'proof-file-1', expected_file_version: 3 }],
    });
  });

  it('stops accepting payments once the obligation is settled', async () => {
    server.use(
      http.get(apiUrl('/api/staff/buyer-refunds/refund-1'), () =>
        HttpResponse.json({
          data: {
            buyer_refund: {
              ...buyerRefund,
              due_amount_cny_fen: '10000',
              gross_paid_cny_fen: '10000',
              net_paid_cny_fen: '10000',
              outstanding_amount_cny_fen: '0',
              status: 'PAID' as const,
              payments: [],
            },
          },
          meta: { request_id: 'refund-detail-paid' },
        }),
      ),
    );
    renderRefundDetail();
    expect(await screen.findByText('已结清')).toBeVisible();
    expect(screen.getByText('该返款已结清；如需调整请先冲正对应付款。')).toBeVisible();
    expect(screen.queryByRole('button', { name: '记录' })).not.toBeInTheDocument();
  });
});
