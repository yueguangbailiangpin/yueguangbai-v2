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
import { Route, Routes } from 'react-router';
import { WorkItemPage } from './work-panels/WorkItemPage';
import {
  sellerSettlementWorkItem,
  settlementPayables,
  settlementPayment,
  settlementSummary,
  staffTestAdapter,
  staffTestSession,
} from './test-fixtures';
import type { SettlementPayable, SettlementPayment, SettlementSummary } from './test-fixtures';

afterEach(cleanup);

describe('canonical Seller Settlement panel', () => {
  it('keeps principal, service fee, payment and protected proof independent and offers only accepted proof MIME types', async () => {
    installSettlementReads();
    renderWorkbench(
      staffTestSession('seller_ops', ['SELLER_SETTLEMENT_VIEW', 'SELLER_SETTLEMENT_RECORD']),
    );
    expect(await screen.findByRole('heading', { name: '卖家结算' })).toBeVisible();
    expect((await screen.findAllByText('¥800.00 CNY')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('¥120.00 CNY').length).toBeGreaterThan(0);
    expect(screen.getAllByText('本金').length).toBeGreaterThan(0);
    expect(screen.getAllByText('服务费').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '查看凭证' })).toBeVisible();
    // P16：卖家收款账户缺失=温和提示（卖家结算无承诺期限，不标红）。
    expect(
      screen.getByText(/未填写——可请卖家在设置页补充后带出/u),
    ).toBeVisible();
    expect(screen.getByLabelText('卖家结算付款凭证')).toHaveAttribute(
      'accept',
      'image/jpeg,image/png,image/webp',
    );
    expect(screen.getByRole('button', { name: '确认记录卖家付款' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '整笔冲正' })).not.toBeInTheDocument();
  });

  it('allocates with the authoritative payment version and refreshes all three settlement reads', async () => {
    const counts = { summary: 0, payables: 0, payments: 0 };
    let body: unknown;
    let key: string | null = null;
    installSettlementReads(counts);
    server.use(
      http.post(apiUrl('/api/staff/seller-payments/payment-1/allocations'), async ({ request }) => {
        body = await request.json();
        key = request.headers.get('Idempotency-Key');
        return HttpResponse.json({
          data: {
            payment: {
              ...settlementPayment,
              allocated_amount_cny_fen: '1000',
              unallocated_amount_cny_fen: '2000',
              status: 'PARTIALLY_ALLOCATED',
              version: 2,
              allocations: [
                {
                  allocation_id: 'allocation-1',
                  payable_id: 'principal-1',
                  payable_type: 'SELLER_PRINCIPAL',
                  allocated_amount_cny_fen: '1000',
                  reversed_amount_cny_fen: '0',
                  net_amount_cny_fen: '1000',
                  allocated_at: 1_787_000_000_001,
                },
              ],
            },
            replayed: false,
          },
          meta: { request_id: 'allocation' },
        });
      }),
    );
    const user = userEvent.setup();
    renderWorkbench(
      staffTestSession('seller_ops', ['SELLER_SETTLEMENT_VIEW', 'SELLER_SETTLEMENT_RECORD']),
    );
    await user.selectOptions(await screen.findByLabelText('分配至本金或服务费项目'), 'principal-1');
    await user.type(screen.getByLabelText('分配金额（人民币分）'), '1000');
    await user.click(screen.getByRole('button', { name: '确认分配' }));
    await waitFor(() =>
      expect(body).toEqual({
        payable_id: 'principal-1',
        amount_cny_fen: '1000',
        expected_payment_version: 1,
      }),
    );
    expect(key).toMatch(/\S/u);
    await waitFor(() => expect(counts).toEqual({ summary: 2, payables: 2, payments: 2 }));
  });

  it('records a verified seller payment with the canonical proof version, idempotency key, and refreshed server facts', async () => {
    const counts = { summary: 0, payables: 0, payments: 0 };
    let body: unknown;
    let key: string | null = null;
    let readState: SettlementReadState = initialSettlementReadState;
    const recordedPayment = {
      ...settlementPayment,
      payment_id: 'payment-2',
      amount_cny_fen: '5000',
      paid_at: 1_787_000_000_001,
      recorded_at: 1_787_000_000_001,
      unallocated_amount_cny_fen: '5000',
      proof: { ...settlementPayment.proof, file_object_id: 'settlement-proof-1', file_version: 3 },
    } satisfies SettlementPayment;
    const recordedReadState = {
      summary: { ...settlementSummary, unallocated_credit_cny_fen: '8000' },
      payables: settlementPayables,
      payments: [settlementPayment, recordedPayment],
    } satisfies SettlementReadState;
    installSettlementReads(counts, () => readState);
    installSellerSettlementProofUpload();
    server.use(
      http.post(apiUrl('/api/staff/seller-settlements/seller-1/payments'), async ({ request }) => {
        body = await request.json();
        key = request.headers.get('Idempotency-Key');
        readState = recordedReadState;
        return HttpResponse.json(
          {
            data: { payment: recordedPayment, replayed: false },
            meta: { request_id: 'record-payment' },
          },
          { status: 201 },
        );
      }),
    );
    const user = userEvent.setup();
    renderWorkbench(
      staffTestSession('seller_ops', ['SELLER_SETTLEMENT_VIEW', 'SELLER_SETTLEMENT_RECORD']),
    );
    await user.upload(
      await screen.findByLabelText('卖家结算付款凭证'),
      new File(['proof'], 'settlement.png', { type: 'image/png' }),
    );
    expect(await screen.findByText('凭证状态：VERIFIED')).toBeVisible();
    await user.type(screen.getByLabelText('付款金额（人民币分）'), '5000');
    await user.click(screen.getByRole('button', { name: '确认记录卖家付款' }));
    await waitFor(() =>
      expect(body).toEqual({
        amount_cny_fen: '5000',
        paid_at: expect.any(Number),
        proof_file: { file_object_id: 'settlement-proof-1', expected_file_version: 3 },
      }),
    );
    expect(key).toMatch(/\S/u);
    await waitFor(() => {
      expect(counts).toEqual({ summary: 2, payables: 2, payments: 2 });
      expect(screen.getByText(/¥50\.00 CNY .* UNALLOCATED/u)).toBeVisible();
    });
  });

  it('reverses a whole seller payment with its authoritative version, idempotency key, and refreshed server facts', async () => {
    const counts = { summary: 0, payables: 0, payments: 0 };
    let body: unknown;
    let key: string | null = null;
    let readState: SettlementReadState = initialSettlementReadState;
    const reversedPayment = {
      ...settlementPayment,
      allocated_amount_cny_fen: '0',
      unallocated_amount_cny_fen: '0',
      status: 'REVERSED',
      version: 2,
    } satisfies SettlementPayment;
    const reversedReadState = {
      summary: { ...settlementSummary, unallocated_credit_cny_fen: '0' },
      payables: settlementPayables,
      payments: [reversedPayment],
    } satisfies SettlementReadState;
    installSettlementReads(counts, () => readState);
    server.use(
      http.post(apiUrl('/api/staff/seller-payments/payment-1/reverse'), async ({ request }) => {
        body = await request.json();
        key = request.headers.get('Idempotency-Key');
        readState = reversedReadState;
        return HttpResponse.json(
          {
            data: { payment: reversedPayment, replayed: false },
            meta: { request_id: 'reverse-payment' },
          },
          { status: 201 },
        );
      }),
    );
    const user = userEvent.setup();
    renderWorkbench(
      staffTestSession('owner', [
        'SELLER_SETTLEMENT_VIEW',
        'SELLER_SETTLEMENT_RECORD',
        'FINANCIAL_CORRECT',
      ]),
    );
    expect(await screen.findByText(/¥30\.00 CNY .* UNALLOCATED/u)).toBeVisible();
    await user.type(await screen.findByLabelText('整笔冲正原因'), '付款凭证重复');
    await user.click(screen.getByRole('button', { name: '整笔冲正' }));
    await waitFor(() => expect(body).toEqual({ expected_version: 1, reason: '付款凭证重复' }));
    expect(key).toMatch(/\S/u);
    await waitFor(() => {
      expect(counts).toEqual({ summary: 2, payables: 2, payments: 2 });
      expect(screen.getByText(/¥30\.00 CNY .* REVERSED/u)).toBeVisible();
      expect(screen.queryByText(/¥30\.00 CNY .* UNALLOCATED/u)).not.toBeInTheDocument();
    });
  });

  it('surfaces a backend financial conflict with its request ID and never invents success', async () => {
    installSettlementReads();
    server.use(
      http.post(apiUrl('/api/staff/seller-payments/payment-1/allocations'), () =>
        HttpResponse.json(
          {
            error: { code: 'VERSION_CONFLICT', message: 'stale payment', details: null },
            meta: { request_id: 'allocation-conflict' },
          },
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderWorkbench(
      staffTestSession('seller_ops', ['SELLER_SETTLEMENT_VIEW', 'SELLER_SETTLEMENT_RECORD']),
    );
    await user.selectOptions(await screen.findByLabelText('分配至本金或服务费项目'), 'principal-1');
    await user.type(screen.getByLabelText('分配金额（人民币分）'), '1000');
    await user.click(screen.getByRole('button', { name: '确认分配' }));
    expect(await screen.findByText('当前面板加载失败')).toBeVisible();
    expect(screen.getByText(/allocation-conflict/u)).toBeVisible();
    expect(screen.queryByText(/操作成功|分配成功/u)).not.toBeInTheDocument();
    expect(screen.getByText(/¥30\.00 CNY/u)).toBeVisible();
  });
});

function renderWorkbench(session: ReturnType<typeof staffTestSession>): void {
  renderWithMsw(
    <StaffSessionBoundary adapter={staffTestAdapter(session)}>
      <Routes>
        <Route path="/staff/work/:workItemId" element={<WorkItemPage />} />
      </Routes>
    </StaffSessionBoundary>,
    {
      route: '/staff/work/work-seller',
    },
  );
}

type SettlementReadState = {
  summary: SettlementSummary;
  payables: SettlementPayable[];
  payments: SettlementPayment[];
};

const initialSettlementReadState = {
  summary: settlementSummary,
  payables: settlementPayables,
  payments: [settlementPayment],
} satisfies SettlementReadState;

function installSettlementReads(
  counts = { summary: 0, payables: 0, payments: 0 },
  readState: () => SettlementReadState = () => initialSettlementReadState,
): void {
  server.use(
    http.get(apiUrl('/api/staff/me/work-items'), () =>
      HttpResponse.json({
        data: { work_items: [sellerSettlementWorkItem], next_cursor: null },
        meta: { request_id: 'queue' },
      }),
    ),
    http.get(apiUrl('/api/staff/me/work-items/work-seller'), () =>
      HttpResponse.json({
        data: { work_item: sellerSettlementWorkItem },
        meta: { request_id: 'work-item' },
      }),
    ),
    http.get(apiUrl('/api/staff/product-applications/product-1/review-context'), () =>
      HttpResponse.json({
        data: {
          review_context: {
            application_id: 'product-1',
            store: { id: 'store-1', display_name: '测试店铺' },
            marketplace_code: 'JP',
            asin: 'B000000001',
            product_name: '结算关联产品',
            search_keywords: [],
            product_url: null,
            buyer_visible_notes: null,
            seller_notes: null,
            ordering_guide_expected_amount_jpy: '1000',
            status: 'SUBMITTED',
            version: 1,
            submitted_at: 1_000,
          },
        },
        meta: { request_id: 'product-context' },
      }),
    ),
    http.get(apiUrl('/api/staff/seller-settlements/seller-1/summary'), () => {
      counts.summary += 1;
      return HttpResponse.json({
        data: { settlement: readState().summary },
        meta: { request_id: 'summary' },
      });
    }),
    http.get(apiUrl('/api/staff/seller-settlements/seller-1/payables'), () => {
      counts.payables += 1;
      return HttpResponse.json({
        data: { items: readState().payables, page: { limit: 25, next_cursor: null } },
        meta: { request_id: 'payables' },
      });
    }),
    http.get(apiUrl('/api/staff/seller-settlements/seller-1/payments'), () => {
      counts.payments += 1;
      return HttpResponse.json({
        data: { items: readState().payments, page: { limit: 25, next_cursor: null } },
        meta: { request_id: 'payments' },
      });
    }),
  );
}

function installSellerSettlementProofUpload(): void {
  server.use(
    http.post(apiUrl('/api/staff/file-uploads/seller-settlement-proofs/intents'), () =>
      HttpResponse.json({
        data: {
          upload_intent_id: 'settlement-intent-1',
          purpose: 'SELLER_SETTLEMENT_PROOF',
          visibility: 'INTERNAL_ONLY',
          status: 'ISSUED',
          version: 1,
          expires_at: 1_900_000_000_000,
          uploads: [
            {
              file_object_id: 'settlement-proof-1',
              slot_no: 1,
              upload_token: 'x'.repeat(40),
              upload_token_available: true,
              expires_at: 1_900_000_000_000,
            },
          ],
          replayed: false,
        },
        meta: { request_id: 'proof-intent' },
      }),
    ),
    http.put(apiUrl('/api/staff/file-uploads/settlement-proof-1/content'), () =>
      HttpResponse.json({
        data: {
          file_object_id: 'settlement-proof-1',
          upload_intent_id: 'settlement-intent-1',
          status: 'UPLOADED',
          detected_mime: 'image/png',
          byte_size: 5,
          sha256: 'a'.repeat(64),
          version: 2,
          replayed: false,
        },
        meta: { request_id: 'proof-content' },
      }),
    ),
    http.post(apiUrl('/api/staff/file-upload-intents/settlement-intent-1/complete'), () =>
      HttpResponse.json({
        data: {
          upload_intent_id: 'settlement-intent-1',
          status: 'VERIFIED',
          version: 2,
          files: [
            {
              file_object_id: 'settlement-proof-1',
              purpose: 'SELLER_SETTLEMENT_PROOF',
              visibility: 'INTERNAL_ONLY',
              detected_mime: 'image/png',
              byte_size: 5,
              sha256: 'a'.repeat(64),
              version: 3,
            },
          ],
          replayed: false,
        },
        meta: { request_id: 'proof-complete' },
      }),
    ),
  );
}
