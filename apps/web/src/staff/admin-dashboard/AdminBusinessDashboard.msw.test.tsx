// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import '../../test/msw/lifecycle';
import { StaffSessionBoundary } from '../../auth/staff/StaffSessionBoundary';
import type { StaffAuthApiAdapter, StaffSession } from '../../auth/staff/staff-auth-api';
import { apiUrl } from '../../test/msw/handlers';
import { createMswQueryClient, renderWithMsw } from '../../test/msw/render';
import { server } from '../../test/msw/server';
import { staffWorkbenchKeys } from '../queries/keys';
import { AdminBusinessDashboard } from './AdminBusinessDashboard';

afterEach(cleanup);

describe('管理员经营看板', () => {
  it('shows separate profit, cohort funnels, server trends and controlled drill-down', async () => {
    server.use(...dashboardHandlers());
    const user = userEvent.setup();
    renderWithMsw(<StaffSessionBoundary adapter={adapter(owner())}>
      <AdminBusinessDashboard />
    </StaffSessionBoundary>, { route: '/staff/admin-business-dashboard' });

    expect(await screen.findByRole('heading', { name: '经营概览' })).toBeVisible();
    expect(screen.getAllByText('预计利润')[0]).toBeVisible();
    expect(screen.getAllByText('已完成利润')[0]).toBeVisible();
    expect(screen.getByText('买家漏斗')).toBeVisible();
    expect(screen.getByText('卖家漏斗')).toBeVisible();
    expect(screen.getByText(/冲突订单未按零计入利润/u)).toBeVisible();
    expect(await screen.findByRole('table', { name: '经营趋势（服务端按北京时间分组）' })).toBeVisible();

    const cards = screen.getAllByText('新增买家');
    await user.click(cards[0]!.closest('section')!.querySelector('button')!);
    expect(await screen.findByRole('table', { name: '新增买家受控明细' })).toBeVisible();
    expect(screen.getByText('buyer-safe-id')).toBeVisible();
    expect(screen.queryByText('private_wechat')).not.toBeInTheDocument();
  });

  it('does not request owner data for a denied role', async () => {
    let requested = false;
    server.use(http.get(apiUrl('/api/staff/admin-business-dashboard/summary'), () => {
      requested = true;
      return HttpResponse.json({});
    }));
    renderWithMsw(<StaffSessionBoundary adapter={adapter(preSales())}>
      <AdminBusinessDashboard />
    </StaffSessionBoundary>, { route: '/staff/admin-business-dashboard' });
    expect(await screen.findByText(/没有经营看板权限/u)).toBeVisible();
    expect(requested).toBe(false);
  });

  it('clears prior owner-only cache after a dashboard 401', async () => {
    server.use(http.get(apiUrl('/api/staff/admin-business-dashboard/summary'), () =>
      HttpResponse.json({ error: { code: 'UNAUTHENTICATED', message: '会话无效', details: null },
        meta: { request_id: 'dashboard-401' } }, { status: 401 })));
    const client = createMswQueryClient();
    client.setQueryData(staffWorkbenchKeys.adminDashboardSummary(1, 'MONTH'), { private: true });
    renderWithMsw(<StaffSessionBoundary adapter={adapter(owner())}>
      <AdminBusinessDashboard />
    </StaffSessionBoundary>, { route: '/staff/admin-business-dashboard', client });
    await waitFor(() => expect(client.getQueryData(
      staffWorkbenchKeys.adminDashboardSummary(1, 'MONTH'),
    )).toBeUndefined());
  });
});

function dashboardHandlers() {
  return [
    http.get(apiUrl('/api/staff/admin-business-dashboard/summary'), () => HttpResponse.json({
      data: { summary: summary() }, meta: { request_id: 'dashboard-summary' },
    })),
    http.get(apiUrl('/api/staff/admin-business-dashboard/trends'), () => HttpResponse.json({
      data: { trend: {
        granularity: 'DAY', from_date: '2026-08-08', to_date: '2026-08-08',
        timezone: 'Asia/Shanghai', data_as_of: 1_786_161_600_000,
        points: [{ from_date: '2026-08-08', to_date: '2026-08-08', new_buyers: 2,
          reservations: 1, formal_orders: 1, business_completions: 0,
          projected_profit: profit('12345', 1, 1), completed_profit: profit('2345', 1, 1) }],
      } }, meta: { request_id: 'dashboard-trend' },
    })),
    http.get(apiUrl('/api/staff/admin-business-dashboard/drill-down'), () => HttpResponse.json({
      data: { drill_down: { metric: 'NEW_BUYERS', from_date: '2026-08-08', to_date: '2026-08-08',
        timezone: 'Asia/Shanghai', data_as_of: 1_786_161_600_000,
        items: [{ reference_id: 'buyer-safe-id', business_date: '2026-08-08', status: 'ACTIVE' }],
        next_cursor: null } }, meta: { request_id: 'dashboard-drill' },
    })),
  ];
}

function summary() {
  const performance = { dimension_id: 'staff-1', dimension_name: '来源员工',
    buyer_lead_count: 2, buyer_registered_count: 1, buyer_reservation_count: 1,
    buyer_formal_order_count: 1, buyer_business_completed_count: 0,
    buyer_no_participation_count: 1, seller_lead_count: 1, seller_cooperation_count: 1,
    current_owner_active_lead_count: 2, consultation_count: null,
    projected_profit: profit('12345', 1, 1), completed_profit: profit('2345', 1, 1) };
  return { window: { key: 'TODAY', from_date: '2026-08-08', to_date: '2026-08-08',
    timezone: 'Asia/Shanghai', data_as_of: 1_786_161_600_000 },
  cards: { new_buyers: 2, reservations: 1, formal_orders: 1, business_completions: 0 },
  buyer_funnel: { stages: [stage('CONSULTATION','咨询',3,null),
    stage('WECHAT_ADDED','加微信',2,6667),stage('REGISTERED','注册',1,5000),
    stage('RESERVATION_SUBMITTED','预约',1,10000),stage('FORMAL_ORDER','正式订单',1,10000),
    stage('BUSINESS_COMPLETED','业务完成',0,0)], no_participation_count: 1 },
  seller_funnel: { stages: [stage('CONSULTATION','咨询',2,null),
    stage('WECHAT_ADDED','加微信',1,5000),stage('COOPERATION','确认合作',1,10000)] },
  projected_profit: profit('12345',1,1), completed_profit: profit('2345',1,1),
  staff_performance: [performance], channel_performance: [{ ...performance,
    dimension_id: 'channel-1', dimension_name: '小红书一号',
    current_owner_active_lead_count: null, consultation_count: 3 }] };
}
function stage(code: string, label: string, count: number, conversion: number|null) {
  return { code, label, count, conversion_rate_bps: conversion };
}
function profit(amount: string, valid: number, conflicts: number) {
  return { amount_cny_fen: amount, valid_order_count: valid, conflict_order_count: conflicts };
}
function adapter(value: StaffSession): StaffAuthApiAdapter {
  return { bootstrap: async () => ({ data: { session: value, access_email: 'staff@example.com' }, requestId: 'bootstrap' }),
    readSession: async () => ({ data: { session: value }, requestId: 'session' }),
    logout: async () => ({ data: { logged_out: true, all_devices_logged_out: false }, requestId: 'logout' }),
    logoutAll: async () => ({ data: { logged_out: true, all_devices_logged_out: true, session_version: 2 }, requestId: 'logout-all' }) };
}
function owner(): StaffSession {
  return session('owner', ['FINANCIAL_VIEW']);
}
function preSales(): StaffSession {
  return session('pre_sales', []);
}
function session(role: 'owner'|'pre_sales', permissions: string[]): StaffSession {
  return { staff_id: 'staff-1', display_name: '测试员工',
    role: role === 'owner' ? { code: 'owner', display_name: '总管理员' }
      : { code: 'pre_sales', display_name: '售前' }, permissions,
    data_scope: { type: role === 'owner' ? 'GLOBAL' : 'ASSIGNED_BUYERS',
      marketplaceCodes: role === 'owner' ? [] : ['AMAZON_JP'], buyerCustomerIds: [],
      sellerOrganizationIds: [], teamIds: [] }, authorization_version: 1, session_version: 1,
    expires_at: Date.now() + 100_000 };
}
