// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import '../test/msw/lifecycle';
import { StaffSessionBoundary } from '../auth/staff/StaffSessionBoundary';
import { apiUrl } from '../test/msw/handlers';
import { renderWithMsw } from '../test/msw/render';
import { server } from '../test/msw/server';
import { sellerSettlementCapabilities } from './SellerSettlementPanel';
import { WorkItemPage } from './work-panels/WorkItemPage';
import {
  sellerSettlementWorkItem,
  settlementPayables,
  settlementPayment,
  settlementSummary,
  staffTestAdapter,
  staffTestSession,
} from './test-fixtures';

afterEach(cleanup);

describe('Seller Settlement role and permission visibility', () => {
  it('maps view, record and correction controls to the current role and effective permissions', () => {
    expect(
      sellerSettlementCapabilities(
        staffTestSession('owner', [
          'SELLER_SETTLEMENT_VIEW',
          'SELLER_SETTLEMENT_RECORD',
          'FINANCIAL_CORRECT',
        ]),
      ),
    ).toEqual({ canView: true, canRecord: true, canReverse: true });
    expect(
      sellerSettlementCapabilities(
        staffTestSession('seller_ops', ['SELLER_SETTLEMENT_VIEW', 'SELLER_SETTLEMENT_RECORD']),
      ),
    ).toEqual({ canView: true, canRecord: true, canReverse: false });
    expect(
      sellerSettlementCapabilities(staffTestSession('seller_ops', ['SELLER_SETTLEMENT_VIEW'])),
    ).toEqual({ canView: true, canRecord: false, canReverse: false });
    expect(
      sellerSettlementCapabilities(
        staffTestSession('acquisition', [
          'SELLER_SETTLEMENT_VIEW',
          'SELLER_SETTLEMENT_RECORD',
          'FINANCIAL_CORRECT',
        ]),
      ),
    ).toEqual({ canView: false, canRecord: false, canReverse: false });
    expect(
      sellerSettlementCapabilities(staffTestSession('pre_sales', ['SELLER_SETTLEMENT_VIEW'])),
    ).toEqual({ canView: false, canRecord: false, canReverse: false });
    expect(
      sellerSettlementCapabilities(staffTestSession('buyer_refund', ['SELLER_SETTLEMENT_VIEW'])),
    ).toEqual({ canView: false, canRecord: false, canReverse: false });
  });

  it.each([
    ['acquisition', ['SELLER_SETTLEMENT_VIEW', 'SELLER_SETTLEMENT_RECORD']],
    ['pre_sales', ['SELLER_SETTLEMENT_VIEW']],
    ['buyer_refund', ['SELLER_SETTLEMENT_VIEW']],
    ['seller_ops', []],
  ] as const)(
    'does not mount or probe settlement for %s with ineffective permissions',
    async (role, permissions) => {
      let settlementRequests = 0;
      installWorkItemReads();
      server.use(
        http.get(apiUrl('/api/staff/seller-settlements/:organizationId/:resource'), () => {
          settlementRequests += 1;
          return HttpResponse.json({});
        }),
      );
      renderWorkbench(staffTestSession(role, [...permissions]));
      expect(await screen.findByRole('heading', { name: '产品申请审核' })).toBeVisible();
      await waitFor(() => expect(settlementRequests).toBe(0));
      expect(screen.queryByRole('heading', { name: '卖家结算' })).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /确认记录卖家付款|确认分配|整笔冲正/u }),
      ).not.toBeInTheDocument();
    },
  );

  it('keeps view-only Seller Ops read-only and gives correction only to a fully permitted Owner', async () => {
    installReads();
    renderWorkbench(staffTestSession('seller_ops', ['SELLER_SETTLEMENT_VIEW']));
    expect(await screen.findByRole('heading', { name: '卖家结算' })).toBeVisible();
    expect(screen.getByText(/当前权限仅可查看结算事实/u)).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /确认记录卖家付款|确认分配|整笔冲正/u }),
    ).not.toBeInTheDocument();
    cleanup();
    installReads();
    renderWorkbench(
      staffTestSession('owner', [
        'SELLER_SETTLEMENT_VIEW',
        'SELLER_SETTLEMENT_RECORD',
        'FINANCIAL_CORRECT',
      ]),
    );
    expect(await screen.findByRole('button', { name: '整笔冲正' })).toBeVisible();
    expect(screen.getByRole('button', { name: '确认分配' })).toBeVisible();
    expect(screen.getByRole('button', { name: '确认记录卖家付款' })).toBeDisabled();
  });
});

function renderWorkbench(session: ReturnType<typeof staffTestSession>): void {
  renderWithMsw(
    <StaffSessionBoundary adapter={staffTestAdapter(session)}>
      <Routes>
        <Route path="/staff/work/:workItemId" element={<WorkItemPage />} />
      </Routes>
    </StaffSessionBoundary>,
    { route: '/staff/work/work-seller' },
  );
}

function installWorkItemReads(): void {
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
  );
}

function installReads(): void {
  installWorkItemReads();
  server.use(
    http.get(apiUrl('/api/staff/seller-settlements/seller-1/summary'), () =>
      HttpResponse.json({
        data: { settlement: settlementSummary },
        meta: { request_id: 'summary' },
      }),
    ),
    http.get(apiUrl('/api/staff/seller-settlements/seller-1/payables'), () =>
      HttpResponse.json({
        data: { items: settlementPayables, page: { limit: 25, next_cursor: null } },
        meta: { request_id: 'payables' },
      }),
    ),
    http.get(apiUrl('/api/staff/seller-settlements/seller-1/payments'), () =>
      HttpResponse.json({
        data: { items: [settlementPayment], page: { limit: 25, next_cursor: null } },
        meta: { request_id: 'payments' },
      }),
    ),
  );
}
