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
import { StaffOrderListPage } from './StaffOrderListPage';

afterEach(cleanup);

interface Row {
  id: string;
  number: string;
  buyer: string;
  stage: 'BUYER_REFUND' | 'SELLER_SETTLEMENT' | 'COMPLETED';
  nextAction: string;
  overdue: boolean;
  owner: string | null;
}

function row(overrides: Partial<Row> & Pick<Row, 'id' | 'number'>): Row {
  return {
    buyer: '列表买家',
    stage: 'SELLER_SETTLEMENT',
    nextAction: 'FOLLOW_SELLER_SETTLEMENT',
    overdue: false,
    owner: '李四',
    ...overrides,
  };
}

function payload(rows: Row[], nextCursor: string | null) {
  return {
    items: rows.map((item) => ({
      formal_order_id: item.id,
      marketplace_code: 'AMAZON_JP',
      amazon_order_number: item.number,
      amazon_order_date: '2026-08-01',
      confirmed_at: 1_787_000_000_000,
      buyer_customer_id: `buyer-${item.id}`,
      buyer_customer_no: `20260801B${item.id}`,
      buyer_display_name: item.buyer,
      seller_organization_id: 'seller-1',
      store_display_name: '列表店铺',
      product_name_snapshot: '列表产品',
      review_type: 'IMAGE',
      buyer_expected_principal_cny_fen: '10890',
      seller_expected_principal_cny_fen: '11880',
      responsibility: {
        stage: item.stage,
        responsible_role: item.stage === 'SELLER_SETTLEMENT' ? 'seller_ops' : 'buyer_refund',
        responsible_staff: item.owner === null ? null : {
          staff_id: `staff-${item.owner}`,
          display_name: item.owner,
        },
        next_action: item.nextAction,
        next_action_due_at: 1_787_100_000_000,
        is_overdue: item.overdue,
        overdue_since: item.overdue ? 1_787_100_000_000 : null,
        exception_state: 'NONE',
        exception_reason: null,
        available_actions: [],
      },
    })),
    next_cursor: nextCursor,
  };
}

function installList(rows: Row[], nextCursor: string | null = null): void {
  server.use(
    http.get(apiUrl('/api/staff/formal-orders'), () =>
      HttpResponse.json({ data: payload(rows, nextCursor), meta: { request_id: 'req-list' } }),
    ),
  );
}

function renderList(): void {
  renderWithMsw(
    <StaffSessionBoundary adapter={staffTestAdapter(staffTestSession('owner', []))}>
      <Routes>
        <Route path="/staff/orders" element={<StaffOrderListPage />} />
        <Route
          path="/staff/orders/:orderId"
          element={<p>订单详情占位</p>}
        />
      </Routes>
    </StaffSessionBoundary>,
    { route: '/staff/orders' },
  );
}

describe('staff order list page', () => {
  it('renders backend rows with stage, owner and next action', async () => {
    installList([
      row({ id: '1', number: '123-1234567-0000001' }),
      row({
        id: '2',
        number: '123-1234567-0000002',
        stage: 'BUYER_REFUND',
        nextAction: 'PROCESS_BUYER_REFUND',
        owner: null,
      }),
    ]);
    renderList();
    expect((await screen.findAllByText('123-1234567-0000001')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('跟进卖家结算').length).toBeGreaterThan(0);
    expect(screen.getAllByText('处理买家返款').length).toBeGreaterThan(0);
    expect(screen.getAllByText('未分配').length).toBeGreaterThan(0);
    expect(screen.getByText('已显示全部匹配订单。')).toBeVisible();
  });

  it('loads the next cursor page and navigates to the detail', async () => {
    installList([row({ id: '1', number: '123-1234567-0000001' })], 'cursor-2');
    const user = userEvent.setup();
    renderList();
    const link = (await screen.findAllByText('123-1234567-0000001'))[0]!;
    expect(link).toBeVisible();
    expect(screen.getByRole('button', { name: '加载更多' })).toBeVisible();
    await user.click(link);
    expect(await screen.findByText('订单详情占位')).toBeVisible();
  });

  it('shows the empty state for no matches', async () => {
    installList([]);
    renderList();
    expect(await screen.findByText('没有符合条件的订单')).toBeVisible();
  });

  it('recovers from a failed list read with retry', async () => {
    server.use(
      http.get(apiUrl('/api/staff/formal-orders'), () =>
        HttpResponse.json(
          { error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'no' }, meta: { request_id: 'req-fail' } },
          { status: 503 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderList();
    expect(await screen.findByText(/订单列表读取失败/)).toBeVisible();
    installList([row({ id: '1', number: '123-1234567-0000001' })]);
    await user.click(screen.getByRole('button', { name: '重试' }));
    expect((await screen.findAllByText('123-1234567-0000001')).length).toBeGreaterThan(0);
  });

  it('writes filters into the URL and replays them to the API', async () => {
    let capturedUrl = '';
    server.use(
      http.get(apiUrl('/api/staff/formal-orders'), ({ request }) => {
        capturedUrl = new URL(request.url).search;
        return HttpResponse.json({
          data: payload([], null),
          meta: { request_id: 'req-filter' },
        });
      }),
    );
    const user = userEvent.setup();
    renderList();
    await screen.findByText('没有符合条件的订单');
    const inputs = screen.getAllByRole('textbox');
    await user.type(inputs[1]!, '20260801B00001');
    await user.click(screen.getByRole('button', { name: '应用筛选' }));
    await screen.findByText('没有符合条件的订单');
    expect(capturedUrl).toContain('buyer_customer_no=20260801B00001');
  });
});
