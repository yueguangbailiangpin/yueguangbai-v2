// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import '../../test/msw/lifecycle';
import { apiUrl } from '../../test/msw/handlers';
import { renderWithMsw } from '../../test/msw/render';
import { server } from '../../test/msw/server';
import { SellerLayout } from '../routes/SellerLayout';
import { SellerRoutePage } from '../routes/SellerRouteModule';

/**
 * Stage 7.5R-2 component coverage for the seller settlement batch list +
 * read-only detail: list→detail entry, member cursor pagination with no
 * duplicates or gaps (250 members across two pages), failure recovery, the
 * safe concealed-404 state, and per-role readability. All responses are
 * parsed with the shared strict schemas from `@ygb/contracts`.
 */

afterEach(cleanup);

function ok(data: unknown, requestId = 'batch-detail-test') {
  return HttpResponse.json({ data, meta: { request_id: requestId } });
}

function sellerMe(role: string) {
  return {
    account_id: 'seller-account',
    member: {
      id: 'seller-member',
      display_name: '卖家',
      role,
      primary_owner: role === 'OWNER',
    },
    organization: {
      id: 'seller-organization',
      seller_code: 'seller-1',
      name: '卖家组织',
      marketplace_code: 'AMAZON_JP',
      status: 'ACTIVE',
      settlement_account_name: null,
      settlement_account_identifier: null,
    },
    access: {
      read_scope: 'ORGANIZATION',
      store_ids: ['store-1'],
      can_submit_product_applications: false,
      can_submit_demand_batches: false,
    },
  };
}

const BATCH_ID = 'batch-detail-0001';
const BATCH = {
  batch_id: BATCH_ID,
  status: 'CONFIRMED',
  frozen_total_cny_fen: '250000',
  frozen_payable_count: 250,
  paid_amount_cny_fen: '0',
  outstanding_amount_cny_fen: '250000',
  confirmed_at: 1_787_900_100_000,
};

function member(index: number) {
  const pad = String(index).padStart(3, '0');
  return {
    amazon_order_number: `900-${pad}-${pad}`,
    payable_type: index % 2 === 0 ? 'SELLER_PRINCIPAL' : 'SELLER_SERVICE_FEE',
    frozen_amount_cny_fen: '1000',
    paid_amount_cny_fen: '0',
    outstanding_amount_cny_fen: '1000',
  };
}

function mockSellerBasics(role: string): void {
  server.use(
    http.get(apiUrl('/api/seller-portal/me'), () => ok({ me: sellerMe(role) }, 'me')),
    http.get(apiUrl('/api/seller-portal/stores'), () =>
      ok({ items: [], page: { limit: 100, next_cursor: null } }, 'stores')),
    // OWNER/FINANCE land on the full financial page; keep its reads quiet.
    http.get(apiUrl('/api/seller-portal/settlement/summary'), () =>
      ok({ settlement: {
        outstanding_principal_cny_fen: '0',
        outstanding_service_fee_cny_fen: '0',
        total_outstanding_cny_fen: '0',
        unallocated_credit_cny_fen: '0',
        settlement_account_name: null,
        settlement_account_identifier: null,
      } }, 'summary')),
    http.get(apiUrl('/api/seller-portal/settlement/payables'), () =>
      ok({ items: [], page: { limit: 100, next_cursor: null } }, 'payables')),
    http.get(apiUrl('/api/seller-portal/settlement/payments'), () =>
      ok({ items: [], page: { limit: 100, next_cursor: null } }, 'payments')),
    http.get(apiUrl('/api/seller-portal/formal-orders'), () =>
      ok({ items: [], page: { limit: 20, next_cursor: null } }, 'orders')),
  );
}

function renderAt(route: string) {
  return renderWithMsw(
    <SellerLayout>
      <SellerRoutePage />
    </SellerLayout>,
    { route },
  );
}

describe('seller settlement batch detail (7.5R-2)', () => {
  it('navigates from the batch list to the read-only detail', async () => {
    mockSellerBasics('OWNER');
    server.use(
      http.get(apiUrl('/api/seller-portal/settlement/batches'), () =>
        ok({
          batches: [{ ...BATCH, frozen_payable_count: 2, frozen_total_cny_fen: '2000', outstanding_amount_cny_fen: '2000' }],
          next_cursor: null,
        }, 'batches')),
      http.get(apiUrl(`/api/seller-portal/settlement/batches/${BATCH_ID}`), () =>
        ok({
          batch: {
            ...BATCH,
            frozen_payable_count: 2,
            frozen_total_cny_fen: '2000',
            outstanding_amount_cny_fen: '2000',
            members: [member(1), member(2)],
            members_next_cursor: null,
          },
        }, 'detail')),
    );
    renderAt('/seller/settlements');

    const entry = await screen.findByRole('link', { name: '查看详情' });
    await userEvent.click(entry);

    expect(await screen.findByText('批次概况')).toBeVisible();
    expect(screen.getByText('批次成员')).toBeVisible();
    expect(screen.getByText('订单 900-001-001')).toBeVisible();
    expect(screen.getByText('订单 900-002-002')).toBeVisible();
    // Member rows never expose internal ids.
    expect(screen.queryByText(/member_id/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/payable_id/u)).not.toBeInTheDocument();
  });

  it('loads 250 members across two cursor pages without duplicates or gaps', async () => {
    mockSellerBasics('VIEWER');
    const firstPage = Array.from({ length: 200 }, (_, index) => member(index + 1));
    const secondPage = Array.from({ length: 50 }, (_, index) => member(index + 201));
    server.use(
      http.get(apiUrl(`/api/seller-portal/settlement/batches/${BATCH_ID}`), ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('members_cursor');
        if (cursor === null) {
          return ok({ batch: { ...BATCH, members: firstPage, members_next_cursor: 'cursor-page-2' } }, 'detail-p1');
        }
        if (cursor === 'cursor-page-2') {
          return ok({ batch: { ...BATCH, members: secondPage, members_next_cursor: null } }, 'detail-p2');
        }
        return HttpResponse.json({
          error: { code: 'VALIDATION_ERROR', message: 'bad cursor', details: null },
          meta: { request_id: 'bad-cursor' },
        }, { status: 400 });
      }),
    );
    renderAt(`/seller/settlements/${BATCH_ID}`);

    expect(await screen.findByText('批次概况')).toBeVisible();
    expect(screen.getByText('订单 900-001-001')).toBeVisible();
    await userEvent.click(await screen.findByRole('button', { name: '加载更多成员' }));
    expect(await screen.findByText('订单 900-250-250')).toBeVisible();

    const numbers = screen
      .getAllByText(/^订单 900-\d{3}-\d{3}$/u)
      .map((node) => node.textContent!.replace('订单 ', ''));
    expect(numbers).toHaveLength(250);
    expect(new Set(numbers).size).toBe(250);
    // Every member appears exactly once: page 1 (1..200) then page 2 (201..250).
    for (let index = 1; index <= 250; index += 1) {
      const pad = String(index).padStart(3, '0');
      expect(numbers).toContain(`900-${pad}-${pad}`);
    }
    // The cursor is exhausted: no further load-more button.
    expect(screen.queryByRole('button', { name: '加载更多成员' })).not.toBeInTheDocument();
  });

  it('recovers from a failed detail read through the retry control', async () => {
    mockSellerBasics('OWNER');
    let failures = 0;
    server.use(
      http.get(apiUrl(`/api/seller-portal/settlement/batches/${BATCH_ID}`), () => {
        if (failures === 0) {
          failures += 1;
          return HttpResponse.json({
            error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'down', details: null },
            meta: { request_id: 'detail-down' },
          }, { status: 503 });
        }
        return ok({
          batch: { ...BATCH, members: [member(1)], members_next_cursor: null },
        }, 'detail-recovered');
      }),
    );
    renderAt(`/seller/settlements/${BATCH_ID}`);

    expect(await screen.findByText('结算批次读取失败。')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('订单 900-001-001')).toBeVisible();
  });

  it('shows the safe not-available state for concealed batches instead of a fake page', async () => {
    mockSellerBasics('VIEWER');
    server.use(
      http.get(apiUrl(`/api/seller-portal/settlement/batches/${BATCH_ID}`), () =>
        HttpResponse.json({
          error: { code: 'NOT_FOUND', message: '资源不存在', details: null },
          meta: { request_id: 'detail-404' },
        }, { status: 404 })),
    );
    renderAt(`/seller/settlements/${BATCH_ID}`);

    expect(await screen.findByText('结算批次不存在或对当前账号不可见。')).toBeVisible();
    // No batch facts are fabricated on the concealed path.
    expect(screen.queryByText('批次概况')).not.toBeInTheDocument();
    expect(screen.queryByText(/¥/u)).not.toBeInTheDocument();
  });

  it('renders the detail for every member role (OWNER/OPERATIONS/FINANCE/VIEWER)', async () => {
    for (const role of ['OWNER', 'OPERATIONS', 'FINANCE', 'VIEWER'] as const) {
      mockSellerBasics(role);
      server.use(
        http.get(apiUrl(`/api/seller-portal/settlement/batches/${BATCH_ID}`), () =>
          ok({
            batch: { ...BATCH, members: [member(1)], members_next_cursor: null },
          }, `detail-${role}`)),
      );
      const { unmount } = renderAt(`/seller/settlements/${BATCH_ID}`);
      expect(await screen.findByText('批次概况')).toBeVisible();
      expect(screen.getByText('已付金额')).toBeVisible();
      unmount();
    }
  });
});
