// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  AdminBusinessDashboardSummaryDto,
  DashboardWindow,
  FinancialReportingProjectionDto,
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
  it('renders contract-valid daily, channel, and integrity facts for every reporting window', async () => {
    const observed = { summaryQueries: [] as string[], dailyRanges: [] as string[], financialRanges: [] as string[] };
    installOwnerHandlers(observed);
    renderWithMsw(<StaffSessionBoundary adapter={adapter(owner())}>
      <FrozenAdminBusinessDashboard />
    </StaffSessionBoundary>, { route: '/staff/admin-business-dashboard' });

    expect(await screen.findByRole('heading', { name: '资金与经营口径' })).toBeVisible();
    expect(screen.getByRole('heading', { name: '客户与订单概览' })).toBeVisible();
    expect(screen.getByRole('heading', { name: '买家业务事实' })).toBeVisible();
    expect(screen.getByRole('heading', { name: '卖家业务事实' })).toBeVisible();
    expect(screen.getByText('¥200.00 CNY')).toBeVisible();
    expect(screen.getByText('每日不可变新增客户、网站开通与订单')).toBeVisible();
    expect(screen.getByText('今日渠道事实')).toBeVisible();
    expect(screen.getByText('身份冲突')).toBeVisible();
    expect(screen.getByText('新系统归因异常')).toBeVisible();
    expect(screen.getByText('财务冲突')).toBeVisible();
    expect(screen.getByText('精确统计期内有 4 张正式订单存在来源归因异常；其中买家归因缺口 3 个、卖家归因缺口 2 个。同一订单两边都缺来源时，异常订单只算 1 张。')).toBeVisible();
    expect(screen.queryByRole('button', { name: '查看明细' })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(observed.summaryQueries).toContain('window=TODAY');
      expect(observed.dailyRanges).toContain('from_date=2026-08-08&to_date=2026-08-08');
      expect(observed.financialRanges).toContain('from_date=2026-08-08&to_date=2026-08-08');
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '本周' }));
    expect(await screen.findByText('本周渠道事实')).toBeVisible();
    await waitFor(() => {
      expect(observed.summaryQueries).toContain('window=WEEK');
      expect(observed.dailyRanges).toContain('from_date=2026-08-04&to_date=2026-08-10');
      expect(observed.financialRanges).toContain('from_date=2026-08-04&to_date=2026-08-10');
    });

    await user.click(screen.getByRole('button', { name: '本月' }));
    expect(await screen.findByText('本月渠道事实')).toBeVisible();
    await waitFor(() => {
      expect(observed.summaryQueries).toContain('window=MONTH');
      expect(observed.dailyRanges).toContain('from_date=2026-08-01&to_date=2026-08-31');
      expect(observed.financialRanges).toContain('from_date=2026-08-01&to_date=2026-08-31');
    });
  });

  it('does not request Admin facts for a role without the owner financial view', async () => {
    let requests = 0;
    server.use(http.get(apiUrl('/api/staff/admin-business-dashboard/:resource'), () => {
      requests += 1;
      return HttpResponse.json({});
    }));
    renderWithMsw(<StaffSessionBoundary adapter={adapter(preSales())}>
      <FrozenAdminBusinessDashboard />
    </StaffSessionBoundary>, { route: '/staff/admin-business-dashboard' });

    expect(await screen.findByText('只有总管理员可以查看经营看板。')).toBeVisible();
    expect(requests).toBe(0);
  });

  it('clears the Frozen owner-only cache after a dashboard 401', async () => {
    server.use(http.get(apiUrl('/api/staff/admin-business-dashboard/summary'), () =>
      HttpResponse.json({ error: { code: 'UNAUTHENTICATED', message: '会话无效', details: null },
        meta: { request_id: 'dashboard-401' } }, { status: 401 })));
    const client = createMswQueryClient();
    const staleKey = ['staff', 'frozen-dashboard', 'summary', 1, 'MONTH'] as const;
    client.setQueryData(staleKey, { private: true });
    renderWithMsw(<StaffSessionBoundary adapter={adapter(owner())}>
      <FrozenAdminBusinessDashboard />
    </StaffSessionBoundary>, { route: '/staff/admin-business-dashboard', client });

    await waitFor(() => expect(client.getQueryData(staleKey)).toBeUndefined());
  });
});

function installOwnerHandlers(observed?: { summaryQueries: string[]; dailyRanges: string[]; financialRanges: string[] }): void {
  server.use(
    http.get(apiUrl('/api/staff/admin-business-dashboard/summary'), ({ request }) => {
      const url = new URL(request.url);
      const key = dashboardWindow(url.searchParams.get('window'));
      observed?.summaryQueries.push(url.searchParams.toString());
      return HttpResponse.json({ data: { summary: summary(key) }, meta: { request_id: 'summary' } });
    }),
    http.get(apiUrl('/api/staff/admin-business-dashboard/acquisition-daily'), ({ request }) => {
      const url = new URL(request.url);
      const key = windowForRange(url.searchParams.get('from_date'), url.searchParams.get('to_date'));
      observed?.dailyRanges.push(url.searchParams.toString());
      return HttpResponse.json({
        data: acquisitionDaily(key), meta: { request_id: 'daily' },
      });
    }),
    http.get(apiUrl('/api/staff/admin-business-dashboard/financial-projection'), ({ request }) => {
      const url = new URL(request.url);
      const key = windowForRange(url.searchParams.get('from_date'), url.searchParams.get('to_date'));
      observed?.financialRanges.push(url.searchParams.toString());
      return HttpResponse.json({
        data: { financial_projection: financialProjection(key) }, meta: { request_id: 'financial' },
      });
    }),
    http.get(apiUrl('/api/staff/acquisition/reporting-config'), () => HttpResponse.json({
      data: { config: { precision_started_business_date: '2026-08-08', activated_at: 1,
        activated_by_staff_id: 'staff-1', version: 1, updated_at: 1 } },
      meta: { request_id: 'config' },
    })),
    http.get(apiUrl('/api/staff/customer-identity-resolution/cases'), () => HttpResponse.json({
      data: { cases: [] }, meta: { request_id: 'identity-cases' },
    })),
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

function windowForRange(from: string | null, to: string | null): DashboardWindow {
  const key = Object.entries(WINDOW_FACTS).find(([, fact]) => fact.from === from && fact.to === to)?.[0];
  if (key === 'TODAY' || key === 'WEEK' || key === 'MONTH') return key;
  throw new Error(`Admin dashboard mock rejected date query: ${String(from)}:${String(to)}`);
}

function summary(key: DashboardWindow): AdminBusinessDashboardSummaryDto {
  const fact = WINDOW_FACTS[key];
  return {
    window: { key, from_date: fact.from, to_date: fact.to,
      timezone: 'Asia/Shanghai', data_as_of: 1_786_161_600_000 },
    cards: { new_buyers: 2, reservations: 1, formal_orders: 1, business_completions: 0 },
    buyer_funnel: { stages: [stage('CONSULTATION', '咨询', 3), stage('WECHAT_ADDED', '加微信', 2),
      stage('REGISTERED', '注册', 1), stage('RESERVATION_SUBMITTED', '预约', 1),
      stage('FORMAL_ORDER', '正式订单', 1), stage('BUSINESS_COMPLETED', '业务完成', 0)],
    no_participation_count: 1 },
    seller_funnel: { stages: [stage('CONSULTATION', '咨询', 2), stage('WECHAT_ADDED', '加微信', 1),
      stage('COOPERATION', '确认合作', 1)] },
    projected_profit: profit('12345'), completed_profit: profit('2345'),
    staff_performance: [], channel_performance: [],
  } satisfies AdminBusinessDashboardSummaryDto;
}

function acquisitionDaily(key: DashboardWindow) {
  const fact = WINDOW_FACTS[key];
  return { from_date: fact.from, to_date: fact.to, timezone: 'Asia/Shanghai',
    data_as_of: 1_786_161_600_000, reporting_precision: { configured: true, business_date: '2026-08-08' },
    anomalies: { identity_conflicts: 2, attribution_anomalies: 4, buyer_attribution_gaps: 3,
      seller_attribution_gaps: 2, finance_conflicts: 1 },
    totals: { new_buyer_customers: 2, new_seller_customers: 1, buyer_portal_registrations: 1,
      seller_portal_registrations: 1, formal_orders: 1, buyer_historical_unknown_orders: 0,
      seller_historical_unknown_orders: 0, buyer_attribution_anomaly_orders: 0,
      seller_attribution_anomaly_orders: 0 },
    daily: [{ business_date: fact.to, new_buyer_customers: 2, new_seller_customers: 1,
      buyer_portal_registrations: 1, seller_portal_registrations: 1, formal_orders: 1,
      buyer_historical_unknown_orders: 1, seller_historical_unknown_orders: 1,
      buyer_attribution_anomaly_orders: 3, seller_attribution_anomaly_orders: 2 }],
    channel_daily: [{ business_date: fact.to, channel_id: `channel-${key.toLowerCase()}`,
      channel_name: fact.channel, channel_label: '员工渠道一号', platform_name: '小红书',
      channel_status: 'ACTIVE' as const, lead_type: 'BUYER' as const, marketplace_code: 'AMAZON_JP',
      new_customer_count: 2, formal_order_count: 1 }] };
}

function financialProjection(key: DashboardWindow): FinancialReportingProjectionDto {
  const fact = WINDOW_FACTS[key];
  return { from_date: fact.from, to_date: fact.to, timezone: 'Asia/Shanghai',
    data_as_of: 1_786_161_600_000, seller_cash_in_cny_fen: '30000', buyer_cash_out_cny_fen: '10000',
    net_cash_flow_cny_fen: '20000', seller_payable_due_cny_fen: '25000', seller_payable_paid_cny_fen: '15000',
    seller_payable_outstanding_cny_fen: '10000', buyer_refund_due_cny_fen: '12000',
    buyer_refund_paid_cny_fen: '10000', buyer_refund_outstanding_cny_fen: '2000',
    projected_profit_cny_fen: '12345', completed_profit_cny_fen: '2345',
    projected_profit_adjustment_cny_fen: '0', completed_profit_adjustment_cny_fen: '0' } satisfies FinancialReportingProjectionDto;
}

function stage(code: string, label: string, count: number) {
  return { code, label, count, conversion_rate_bps: null };
}

function profit(amount: string) {
  return { amount_cny_fen: amount, valid_order_count: 1, conflict_order_count: 0 };
}

function adapter(value: StaffSession): StaffAuthApiAdapter {
  return { bootstrap: async () => ({ data: { session: value, access_email: 'staff@example.com' }, requestId: 'bootstrap' }),
    readSession: async () => ({ data: { session: value }, requestId: 'session' }),
    logout: async () => ({ data: { logged_out: true, all_devices_logged_out: false }, requestId: 'logout' }),
    logoutAll: async () => ({ data: { logged_out: true, all_devices_logged_out: true, session_version: 2 }, requestId: 'logout-all' }) };
}

function owner(): StaffSession { return session('owner', ['FINANCIAL_VIEW']); }
function preSales(): StaffSession { return session('pre_sales', []); }
function session(role: 'owner'|'pre_sales', permissions: string[]): StaffSession {
  return { staff_id: 'staff-1', display_name: '测试员工',
    role: role === 'owner' ? { code: 'owner', display_name: '总管理员' } : { code: 'pre_sales', display_name: '售前' },
    permissions, data_scope: { type: role === 'owner' ? 'GLOBAL' : 'ASSIGNED_BUYERS',
      marketplaceCodes: role === 'owner' ? [] : ['AMAZON_JP'], buyerCustomerIds: [], sellerOrganizationIds: [], teamIds: [] },
    authorization_version: 1, session_version: 1, expires_at: Date.now() + 100_000 };
}
