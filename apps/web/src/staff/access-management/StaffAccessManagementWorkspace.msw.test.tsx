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
import { StaffAccessManagementWorkspace } from './StaffAccessManagementWorkspace';

afterEach(cleanup);

describe('员工账号管理工作台', () => {
  it('loads the safe owner projection and creates an email-based Staff account', async () => {
    let submitted: unknown = null;
    server.use(
      http.get(apiUrl('/api/staff/access-management'), () => HttpResponse.json({
        data: overview(), meta: { request_id: 'staff-access-overview' },
      })),
      http.post(apiUrl('/api/staff/access-management/employees'), async ({ request }) => {
        submitted = await request.json();
        return HttpResponse.json({
          data: { employee: employee('new-staff', '新员工', 'new@example.test'), replayed: false },
          meta: { request_id: 'staff-access-create' },
        }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderWithMsw(
      <StaffSessionBoundary adapter={adapter(owner())}>
        <StaffAccessManagementWorkspace />
      </StaffSessionBoundary>,
      { route: '/staff/access-management' },
    );

    expect(await screen.findByRole('heading', { name: '员工管理' })).toBeVisible();
    expect(screen.getByText('owner@example.test')).toBeVisible();
    expect(screen.queryByText(/open_id|user_id|tenant_key|飞书/iu)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '新增员工' }));
    await user.type(screen.getByLabelText('员工姓名'), '新员工');
    await user.type(screen.getByLabelText('登录邮箱'), 'new@example.test');
    await user.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(submitted).toEqual({
      display_name: '新员工',
      email: 'new@example.test',
      role_code: 'pre_sales',
      marketplace_codes: ['AMAZON_JP'],
    }));
  });

  it('does not request employee data for a denied role', async () => {
    let requested = false;
    server.use(http.get(apiUrl('/api/staff/access-management'), () => {
      requested = true;
      return HttpResponse.json({});
    }));
    renderWithMsw(
      <StaffSessionBoundary adapter={adapter(preSales())}>
        <StaffAccessManagementWorkspace />
      </StaffSessionBoundary>,
      { route: '/staff/access-management' },
    );
    expect(await screen.findByText('仅总管理员可以管理员工账号。')).toBeVisible();
    expect(requested).toBe(false);
  });
});

function overview() {
  return {
    employees: [employee('owner-staff', '总管理员', 'owner@example.test', 'owner')],
    available_marketplaces: [
      { code: 'AMAZON_JP', display_name: 'Amazon 日本站', status: 'ACTIVE' },
    ],
  };
}

function employee(
  staffId: string,
  displayName: string,
  email: string,
  role: 'owner' | 'pre_sales' = 'pre_sales',
) {
  return {
    staff_id: staffId,
    display_name: displayName,
    email,
    status: 'ACTIVE',
    version: 1,
    role: role === 'owner'
      ? { code: 'owner', display_name: '总管理员' }
      : { code: 'pre_sales', display_name: '售前' },
    marketplace_codes: role === 'owner' ? [] : ['AMAZON_JP'],
    marketplace_scopes: role === 'owner'
      ? []
      : [{ code: 'AMAZON_JP', scope_kind: 'PRIMARY' }],
    last_login_at: null,
    updated_at: 1_786_161_600_000,
  };
}

function adapter(value: StaffSession): StaffAuthApiAdapter {
  return {
    bootstrap: async () => ({ data: { session: value, access_email: 'staff@example.com' }, requestId: 'bootstrap' }),
    readSession: async () => ({ data: { session: value }, requestId: 'session' }),
    logout: async () => ({ data: { logged_out: true, all_devices_logged_out: false }, requestId: 'logout' }),
    logoutAll: async () => ({ data: { logged_out: true, all_devices_logged_out: true, session_version: 2 }, requestId: 'logout-all' }),
  };
}

function owner(): StaffSession {
  return session('owner', ['STAFF_MANAGE', 'PERMISSION_MANAGE']);
}

function preSales(): StaffSession {
  return session('pre_sales', []);
}

function session(role: 'owner' | 'pre_sales', permissions: string[]): StaffSession {
  return {
    staff_id: 'owner-staff', display_name: '测试员工',
    role: role === 'owner'
      ? { code: 'owner', display_name: '总管理员' }
      : { code: 'pre_sales', display_name: '售前' },
    permissions,
    data_scope: {
      type: role === 'owner' ? 'GLOBAL' : 'ASSIGNED_BUYERS',
      marketplaceCodes: role === 'owner' ? [] : ['AMAZON_JP'],
      buyerCustomerIds: [], sellerOrganizationIds: [], teamIds: [],
    },
    authorization_version: 1, session_version: 1,
    expires_at: Date.now() + 100_000,
  };
}
