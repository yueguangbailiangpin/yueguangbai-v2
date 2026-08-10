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
import { renderWithMsw } from '../../test/msw/render';
import { server } from '../../test/msw/server';
import { SellerPrincipalRatePolicyWorkspace } from './SellerPrincipalRatePolicyWorkspace';

afterEach(cleanup);

describe('卖家本金汇率策略 Staff 工作台', () => {
  it('让 Owner 读取默认/覆盖并确认或拒绝待决策略', async () => {
    const requests: { path: string; body: unknown }[] = [];
    server.use(
      http.get(apiUrl('/api/staff/seller-principal-rate-policies'), () => HttpResponse.json({
        data: { policies: readPayload() }, meta: { request_id: 'policy-read' },
      })),
      http.post(apiUrl('/api/staff/seller-principal-rate-policies/:id/confirm'), async ({ request, params }) => {
        requests.push({ path: `confirm:${params['id']}`, body: await request.json() });
        return HttpResponse.json({ data: { policy: policy('confirm-1', 'CONFIRMED', 2, '400000', null) }, meta: { request_id: 'policy-confirm' } });
      }),
      http.post(apiUrl('/api/staff/seller-principal-rate-policies/:id/reject'), async ({ request, params }) => {
        requests.push({ path: `reject:${params['id']}`, body: await request.json() });
        return HttpResponse.json({ data: { policy: policy('reject-1', 'REJECTED', 2, '0', '不采用') }, meta: { request_id: 'policy-reject' } });
      }),
    );
    const user = userEvent.setup();
    renderWithMsw(<StaffSessionBoundary adapter={adapter(owner())}><SellerPrincipalRatePolicyWorkspace /></StaffSessionBoundary>, {
      route: '/staff/seller-principal-rate-policies',
    });
    expect(await screen.findByRole('heading', { name: '卖家本金汇率策略' })).toBeVisible();
    await user.type(screen.getByLabelText('卖家组织编号'), 'seller-1');
    expect(screen.getAllByText('币种对默认加点')[0]).toBeVisible();
    expect(screen.getByText('卖家组织覆盖 · +0.0 · v1')).toBeVisible();
    await user.click(screen.getAllByRole('button', { name: '确认生效策略' })[0]!);
    await waitFor(() => expect(requests).toHaveLength(1));
    await user.click(screen.getAllByRole('button', { name: '拒绝' })[1]!);
    await waitFor(() => expect(requests).toEqual([
      { path: 'confirm:pending-default', body: { expected_version: 1 } },
      { path: 'reject:pending-override', body: { expected_version: 1, rejection_reason: 'Owner 在 Staff 工作台拒绝' } },
    ]));
  });

  it('让卖家对接为已分配组织提交明确为 0 的覆盖，并携带版本与幂等请求', async () => {
    let body: unknown;
    let key: string | null = null;
    server.use(
      http.get(apiUrl('/api/staff/seller-principal-rate-policies'), () => HttpResponse.json({
        data: { policies: readPayload({
          default_pending_policy: null,
          seller_override_pending_policy: null,
        }) },
        meta: { request_id: 'policy-read' },
      })),
      http.post(apiUrl('/api/staff/seller-principal-rate-policies/submit'), async ({ request }) => {
        body = await request.json(); key = request.headers.get('Idempotency-Key');
        return HttpResponse.json({ data: { policy: policy('submitted-1', 'SUBMITTED', 1, '0', null) }, meta: { request_id: 'policy-submit' } });
      }),
    );
    const user = userEvent.setup();
    renderWithMsw(<StaffSessionBoundary adapter={adapter(sellerOps())}><SellerPrincipalRatePolicyWorkspace /></StaffSessionBoundary>, {
      route: '/staff/seller-principal-rate-policies',
    });
    await screen.findByRole('heading', { name: '卖家本金汇率策略' });
    await user.clear(screen.getByLabelText('卖家组织编号'));
    await user.type(screen.getByLabelText('卖家组织编号'), 'seller-1');
    await screen.findByRole('heading', { name: '币种对默认加点' });
    await user.clear(screen.getByLabelText('卖家本金汇率加点（例如 +0.004 或 0）'));
    await user.type(screen.getByLabelText('卖家本金汇率加点（例如 +0.004 或 0）'), '0');
    await user.click(screen.getByRole('button', { name: '提交待确认策略' }));
    await waitFor(() => expect(body).toMatchObject({
      scope_type: 'SELLER_ORGANIZATION', seller_organization_id: 'seller-1',
      source_currency_code: 'JPY', markup_rate_value: '0', expected_version: 1,
    }));
    expect(key).toMatch(/\S/u);
  });

  it('让 Owner 通过工作台提交全局默认加点', async () => {
    let body: unknown;
    let requestedOrganization: string | null = 'not-read';
    server.use(
      http.get(apiUrl('/api/staff/seller-principal-rate-policies'), ({ request }) => {
        requestedOrganization = new URL(request.url).searchParams.get('seller_organization_id');
        return HttpResponse.json({
          data: {
            policies: readPayload({
              seller_organization_id: null,
              seller_override_policy: null,
              default_pending_policy: null,
              seller_override_pending_policy: null,
              seller_override_next_version: null,
              selected_policy: policy('default-1', 'CONFIRMED', 2, '400000', null),
            }),
          },
          meta: { request_id: 'owner-read' },
        });
      }),
      http.post(apiUrl('/api/staff/seller-principal-rate-policies/submit'), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ data: { policy: policy('submitted-default', 'SUBMITTED', 1, '400000', null) }, meta: { request_id: 'owner-submit' } });
      }),
    );
    const user = userEvent.setup();
    renderWithMsw(<StaffSessionBoundary adapter={adapter(owner())}><SellerPrincipalRatePolicyWorkspace /></StaffSessionBoundary>, {
      route: '/staff/seller-principal-rate-policies',
    });
    await screen.findByRole('heading', { name: '卖家本金汇率策略' });
    await screen.findByRole('heading', { name: '币种对默认加点' });
    expect(requestedOrganization).toBeNull();
    expect(screen.getByText('下一版本：选择组织后读取')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '提交待确认策略' }));
    await waitFor(() => expect(body).toMatchObject({
      scope_type: 'CURRENCY_PAIR_DEFAULT', seller_organization_id: null,
      source_currency_code: 'JPY', markup_rate_value: '0.004',
    }));
  });
});

function adapter(value: StaffSession): StaffAuthApiAdapter {
  return { readSession: async () => ({ data: { session: value }, requestId: 'session' }),
    loginStart: async () => ({ data: { provider: 'FEISHU', authorization_url: 'https://example.test', expires_at: 1 }, requestId: 'login' }),
    logout: async () => ({ data: { logged_out: true, all_devices_logged_out: false }, requestId: 'logout' }),
    logoutAll: async () => ({ data: { logged_out: true, all_devices_logged_out: true, session_version: 2 }, requestId: 'logout-all' }) };
}

function session(role: 'owner' | 'seller_ops', permissions: string[]): StaffSession {
  return { staff_id: 'staff-1', display_name: '测试员工',
    role: role === 'owner' ? { code: 'owner', display_name: '总管理员' } : { code: 'seller_ops', display_name: '卖家对接' },
    permissions, data_scope: role === 'owner'
      ? { type: 'GLOBAL', buyerCustomerIds: [], sellerOrganizationIds: [], teamIds: [] }
      : { type: 'ASSIGNED_SELLER_ORGANIZATIONS', buyerCustomerIds: [], sellerOrganizationIds: ['seller-1'], teamIds: [] },
    authorization_version: 1, session_version: 1, expires_at: Date.now() + 100_000 };
}

function owner(): StaffSession { return session('owner', ['SELLER_MANAGE', 'FINANCIAL_CORRECT']); }
function sellerOps(): StaffSession { return session('seller_ops', ['SELLER_MANAGE']); }

function policy(id: string, status: 'SUBMITTED' | 'CONFIRMED' | 'REJECTED', version: number, markup: string, rejection: string | null) {
  return { policy_version_id: id, scope_type: id.includes('override') ? 'SELLER_ORGANIZATION' : 'CURRENCY_PAIR_DEFAULT',
    seller_organization_id: id.includes('override') ? 'seller-1' : null, source_currency_code: 'JPY', quote_currency_code: 'CNY',
    version_no: 1, decision_version: version, status, markup_rate_value: markup, markup_rate_scale: '100000000',
    effective_from: 1_900_000_000_000, submitted_at: 1_800_000_000_000,
    confirmed_at: status === 'CONFIRMED' ? 1_800_000_000_001 : null, rejection_reason: rejection, replayed: false };
}

function readPayload(overrides: Record<string, unknown> = {}) {
  return { source_currency_code: 'JPY', quote_currency_code: 'CNY', seller_organization_id: 'seller-1',
    default_policy: policy('default-1', 'CONFIRMED', 2, '400000', null),
    seller_override_policy: policy('override-1', 'CONFIRMED', 2, '0', null),
    default_pending_policy: policy('pending-default', 'SUBMITTED', 1, '400000', null),
    seller_override_pending_policy: policy('pending-override', 'SUBMITTED', 1, '0', null),
    default_next_version: 2, seller_override_next_version: 2,
    selected_policy: policy('override-1', 'CONFIRMED', 2, '0', null), ...overrides };
}
