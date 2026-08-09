// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import '../../test/msw/lifecycle';
import { StaffSessionBoundary } from '../../auth/staff/StaffSessionBoundary';
import type {
  StaffAuthApiAdapter,
  StaffSession,
} from '../../auth/staff/staff-auth-api';
import { apiUrl } from '../../test/msw/handlers';
import { renderWithMsw } from '../../test/msw/render';
import { server } from '../../test/msw/server';
import { StaffAccessManagementWorkspace } from './StaffAccessManagementWorkspace';

afterEach(cleanup);

describe('员工权限与飞书绑定工作台', () => {
  it('loads the safe owner projection and creates a team-scoped one-time invitation', async () => {
    let submitted: unknown = null;
    server.use(
      http.get(apiUrl('/api/staff/access-management'), () =>
        HttpResponse.json({
          data: overview(), meta: { request_id: 'staff-access-overview' },
        })),
      http.post(apiUrl('/api/staff/access-management/invitations'), async ({ request }) => {
        submitted = await request.json();
        return HttpResponse.json({
          data: {
            invitation: invitation(),
            invitation_path: '/staff/bind?invite=abcdefghijklmnopqrstuvwxyzABCDEFGH123456789',
            replayed: false,
          },
          meta: { request_id: 'staff-access-invitation' },
        });
      }),
    );
    const user = userEvent.setup();
    renderWithMsw(
      <StaffSessionBoundary adapter={adapter(owner())}>
        <StaffAccessManagementWorkspace />
      </StaffSessionBoundary>,
      { route: '/staff/access-management' },
    );

    expect(await screen.findByRole('heading', {
      name: '员工权限与飞书绑定',
    })).toBeVisible();
    expect(screen.getByText('运营部 · 上海团队')).toBeVisible();
    expect(screen.queryByText(/open_id|user_id|tenant_key/iu)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('员工姓名'), ' 新员工 ');
    await user.click(screen.getByRole('button', { name: '创建绑定邀请' }));
    await waitFor(() => expect(submitted).toEqual({
      display_name: '新员工',
      role_code: 'pre_sales',
      team_id: 'team-shanghai',
    }));
    expect((await screen.findByLabelText('仅显示一次的邀请链接') as HTMLInputElement).value)
      .toContain('/staff/bind?invite=');
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
    expect(await screen.findByText(/没有员工管理权限/u)).toBeVisible();
    expect(requested).toBe(false);
  });
});

function overview() {
  return {
    employees: [{
      staff_id: 'owner-staff', display_name: '总管理员', status: 'ACTIVE',
      version: 1, role: { code: 'owner', display_name: '总管理员' },
      feishu_binding: { status: 'ACTIVE', verified_at: 1_786_161_600_000 },
      updated_at: 1_786_161_600_000,
    }],
    invitations: [],
    available_teams: [{
      team_id: 'team-shanghai', team_name: '上海团队', department_name: '运营部',
    }],
  };
}

function invitation() {
  return {
    invitation_id: 'staff-invitation-1', display_name: '新员工',
    role: { code: 'pre_sales', display_name: '售前' },
    team: {
      team_id: 'team-shanghai', team_name: '上海团队', department_name: '运营部',
    },
    status: 'ISSUED', version: 1,
    issued_at: 1_786_161_600_000,
    expires_at: 1_786_248_000_000,
    consumed_at: null, cancelled_at: null,
  };
}

function adapter(value: StaffSession): StaffAuthApiAdapter {
  return {
    readSession: async () => ({ data: { session: value }, requestId: 'session' }),
    loginStart: async () => ({
      data: {
        provider: 'FEISHU', authorization_url: 'https://example.test', expires_at: 1,
      },
      requestId: 'login',
    }),
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
  return session('owner', ['STAFF_MANAGE', 'PERMISSION_MANAGE']);
}

function preSales(): StaffSession {
  return session('pre_sales', []);
}

function session(
  role: 'owner' | 'pre_sales',
  permissions: string[],
): StaffSession {
  return {
    staff_id: 'owner-staff', display_name: '测试员工',
    role: role === 'owner'
      ? { code: 'owner', display_name: '总管理员' }
      : { code: 'pre_sales', display_name: '售前' },
    permissions,
    data_scope: {
      type: role === 'owner' ? 'GLOBAL' : 'ASSIGNED_BUYERS',
      buyerCustomerIds: [], sellerOrganizationIds: [], teamIds: [],
    },
    authorization_version: 1, session_version: 1,
    expires_at: Date.now() + 100_000,
  };
}
