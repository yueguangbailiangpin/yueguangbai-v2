// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  AdminBusinessDashboardSummaryDto,
  DashboardWindow,
} from '@ygb/contracts';
import '../../test/msw/lifecycle';
import { StaffSessionBoundary } from '../../auth/staff/StaffSessionBoundary';
import type { StaffAuthApiAdapter, StaffSession } from '../../auth/staff/staff-auth-api';
import { apiUrl } from '../../test/msw/handlers';
import { createMswQueryClient, renderWithMsw } from '../../test/msw/render';
import { server } from '../../test/msw/server';
import { FrozenAdminBusinessDashboard } from './FrozenAdminBusinessDashboard';

afterEach(cleanup);

describe('canonical Frozen Admin business dashboard', () => {
  it('renders the stage 4 simplified owner summary for every reporting window', async () => {
    const observed = {
      summaryQueries: [] as string[],
      financialRanges: [] as string[],
    };
    installOwnerHandlers(observed);
    renderWithMsw(
      <StaffSessionBoundary adapter={adapter(owner())}>
        <FrozenAdminBusinessDashboard />
      </StaffSessionBoundary>,
      { route: '/staff/admin-business-dashboard' },
    );

    expect(await screen.findByRole('heading', { name: '客户与订单' })).toBeVisible();
    expect(await screen.findByText('¥123.45 CNY')).toBeVisible();
    expect(screen.getByText('待处理买家返款')).toBeVisible();
    expect(screen.getByText('待处理卖家结算')).toBeVisible();
    expect(screen.getByText('待处理工作项')).toBeVisible();
    expect(screen.getByText('账目对不上')).toBeVisible();
    expect(screen.getByText('客户身份对不上')).toBeVisible();
    // Machine-era surfaces are gone from the simplified dashboard.
    expect(screen.queryByText('买家：从咨询到完成')).not.toBeInTheDocument();
    expect(screen.queryByText('每日新增客户、网站开通与订单')).not.toBeInTheDocument();
    expect(screen.queryByText('明细与统计设置（点开查看）')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(observed.summaryQueries).toContain('window=TODAY');
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '本周' }));
    await waitFor(() => {
      expect(observed.summaryQueries).toContain('window=WEEK');
    });

    await user.click(screen.getByRole('button', { name: '本月' }));
    await waitFor(() => {
      expect(observed.summaryQueries).toContain('window=MONTH');
    });
  });

  it('does not request Admin facts for a role without the owner financial view', async () => {
    let requests = 0;
    server.use(
      http.get(apiUrl('/api/staff/admin-business-dashboard/:resource'), () => {
        requests += 1;
        return HttpResponse.json({});
      }),
    );
    renderWithMsw(
      <StaffSessionBoundary adapter={adapter(preSales())}>
        <FrozenAdminBusinessDashboard />
      </StaffSessionBoundary>,
      { route: '/staff/admin-business-dashboard' },
    );

    expect(await screen.findByText('只有总管理员可以查看经营看板。')).toBeVisible();
    expect(requests).toBe(0);
  });

  it('clears the Frozen owner-only cache after a dashboard 401', async () => {
    server.use(
      http.get(apiUrl('/api/staff/admin-business-dashboard/summary'), () =>
        HttpResponse.json(
          {
            error: { code: 'UNAUTHENTICATED', message: '会话无效', details: null },
            meta: { request_id: 'dashboard-401' },
          },
          { status: 401 },
        ),
      ),
    );
    const client = createMswQueryClient();
    const staleKey = ['staff', 'frozen-dashboard', 'summary', 1, 'MONTH'] as const;
    client.setQueryData(staleKey, { private: true });
    renderWithMsw(
      <StaffSessionBoundary adapter={adapter(owner())}>
        <FrozenAdminBusinessDashboard />
      </StaffSessionBoundary>,
      { route: '/staff/admin-business-dashboard', client },
    );

    await waitFor(() => expect(client.getQueryData(staleKey)).toBeUndefined());
  });
});

function installOwnerHandlers(observed?: {
  summaryQueries: string[];
  financialRanges: string[];
}): void {
  server.use(
    http.get(apiUrl('/api/staff/admin-business-dashboard/summary'), ({ request }) => {
      const url = new URL(request.url);
      const key = dashboardWindow(url.searchParams.get('window'));
      observed?.summaryQueries.push(url.searchParams.toString());
      return HttpResponse.json({
        data: { summary: summary(key) },
        meta: { request_id: 'summary' },
      });
    }),
    http.get(apiUrl('/api/staff/customer-identity-resolution/cases'), () =>
      HttpResponse.json({
        data: { cases: [] },
        meta: { request_id: 'identity-cases' },
      }),
    ),
  );
}

const WINDOW_FACTS = {
  TODAY: { from: '2026-08-08', to: '2026-08-08', channel: '今日渠道事实' },
  WEEK: { from: '2026-08-04', to: '2026-08-10', channel: '本周渠道事实' },
  MONTH: { from: '2026-08-01', to: '2026-08-31', channel: '本月渠道事实' },
} as const satisfies Record<DashboardWindow, { from: string; to: string; channel: string }>;

function dashboardWindow(value: string | null): DashboardWindow {
  if (value === 'TODAY' || value === 'WEEK' || value === 'MONTH') return value;
  throw new Error(`Admin dashboard mock rejected window query: ${String(value)}`);
}


function summary(key: DashboardWindow): AdminBusinessDashboardSummaryDto {
  const fact = WINDOW_FACTS[key];
  return {
    window: {
      key,
      from_date: fact.from,
      to_date: fact.to,
      timezone: 'Asia/Shanghai',
      data_as_of: 1_786_161_600_000,
    },
    cards: { new_customers_buyer: 2, new_customers_seller: 1, reservations: 1, formal_orders: 1 },
    pending: { buyer_refunds: 1, seller_settlements: 1 },
    overdue: { open_work_items: 0, finance_exceptions: 0 },
    owner_summary: { projected_profit: profit('12345'), completed_profit: profit('2345') },
  } satisfies AdminBusinessDashboardSummaryDto;
}


function profit(amount: string) {
  return { amount_cny_fen: amount, valid_order_count: 1, conflict_order_count: 0 };
}

function adapter(value: StaffSession): StaffAuthApiAdapter {
  return {
    bootstrap: async () => ({
      data: { session: value, access_email: 'staff@example.com' },
      requestId: 'bootstrap',
    }),
    readSession: async () => ({ data: { session: value }, requestId: 'session' }),
    logout: async () => ({
      data: { logged_out: true, all_devices_logged_out: false },
      requestId: 'logout',
    }),
    logoutAll: async () => ({
      data: { logged_out: true, all_devices_logged_out: true, session_version: 2 },
      requestId: 'logout-all',
    }),
  };
}

function owner(): StaffSession {
  return session('owner', ['FINANCIAL_VIEW']);
}
function preSales(): StaffSession {
  return session('pre_sales', []);
}
function session(role: 'owner' | 'pre_sales', permissions: string[]): StaffSession {
  return {
    staff_id: 'staff-1',
    display_name: '测试员工',
    role:
      role === 'owner'
        ? { code: 'owner', display_name: '总管理员' }
        : { code: 'pre_sales', display_name: '售前' },
    permissions,
    data_scope: {
      type: role === 'owner' ? 'GLOBAL' : 'ASSIGNED_BUYERS',
      marketplaceCodes: role === 'owner' ? [] : ['AMAZON_JP'],
      buyerCustomerIds: [],
      sellerOrganizationIds: [],
      teamIds: [],
    },
    authorization_version: 1,
    session_version: 1,
    expires_at: Date.now() + 100_000,
  };
}
