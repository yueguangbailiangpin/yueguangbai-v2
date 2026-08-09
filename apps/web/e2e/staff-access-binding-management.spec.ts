import { expect, test, type Page, type Route } from '@playwright/test';

const success = (data: unknown) => ({
  data,
  meta: { request_id: 'staff-access-browser' },
});

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function session(role: 'owner' | 'pre_sales') {
  return {
    staff_id: `browser-${role}`,
    display_name: role === 'owner' ? '权限负责人' : '普通售前',
    role: role === 'owner'
      ? { code: 'owner', display_name: '总管理员' }
      : { code: 'pre_sales', display_name: '售前' },
    permissions: role === 'owner'
      ? ['STAFF_MANAGE', 'PERMISSION_MANAGE']
      : [],
    data_scope: {
      type: role === 'owner' ? 'GLOBAL' : 'ASSIGNED_BUYERS',
      buyerCustomerIds: [], sellerOrganizationIds: [], teamIds: [],
    },
    authorization_version: 7,
    session_version: 1,
    expires_at: 9_999_999_999_999,
  };
}

function overview() {
  return {
    employees: [{
      staff_id: 'browser-owner', display_name: '权限负责人', status: 'ACTIVE',
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

async function mock(
  page: Page,
  role: 'owner' | 'pre_sales',
  observed: { accessRequests: number; invitationBody?: unknown },
): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/staff-auth/session') {
      return json(route, success({ session: session(role) }));
    }
    if (path === '/api/staff/access-management') {
      observed.accessRequests += 1;
      return json(route, success(overview()));
    }
    if (path === '/api/staff/access-management/invitations'
      && route.request().method() === 'POST') {
      observed.invitationBody = route.request().postDataJSON();
      return json(route, success({
        invitation: {
          invitation_id: 'browser-invitation-1', display_name: '浏览器新员工',
          role: { code: 'pre_sales', display_name: '售前' },
          team: {
            team_id: 'team-shanghai', team_name: '上海团队', department_name: '运营部',
          },
          status: 'ISSUED', version: 1,
          issued_at: 1_786_161_600_000,
          expires_at: 1_786_248_000_000,
          consumed_at: null, cancelled_at: null,
        },
        invitation_path: `/staff/bind?invite=${'a'.repeat(43)}`,
        replayed: false,
      }));
    }
    return json(route, {
      error: { code: 'NOT_FOUND', message: 'not found', details: null },
      meta: { request_id: 'staff-access-browser-unhandled' },
    }, 404);
  });
}

test('owner manages a responsive team-scoped invitation without Provider identifiers', async ({ page }) => {
  const observed = { accessRequests: 0, invitationBody: undefined as unknown };
  await mock(page, 'owner', observed);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/staff/access-management');

  await expect(page.getByRole('heading', {
    name: '员工权限与飞书绑定',
  })).toBeVisible();
  await expect(page.getByRole('link', { name: '员工权限' })).toBeVisible();
  await expect(page.getByLabel('所属团队')).toHaveValue('team-shanghai');
  await expect(page.getByText(/open_id|user_id|tenant_key/iu)).toHaveCount(0);

  await page.getByLabel('员工姓名').fill(' 浏览器新员工 ');
  await page.getByRole('button', { name: '创建绑定邀请' }).click();
  await expect(page.getByLabel('仅显示一次的邀请链接')).toHaveValue(
    /\/staff\/bind\?invite=/u,
  );
  expect(observed.invitationBody).toEqual({
    display_name: '浏览器新员工',
    role_code: 'pre_sales',
    team_id: 'team-shanghai',
  });
  const width = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(width.content).toBeLessThanOrEqual(width.viewport + 1);
});

test('non-owner direct route exposes neither navigation nor employee data', async ({ page }) => {
  const observed = { accessRequests: 0 };
  await mock(page, 'pre_sales', observed);
  await page.goto('/staff/access-management');
  await expect(page.getByText(/没有员工管理权限/u)).toBeVisible();
  await expect(page.getByRole('link', { name: '员工权限' })).toHaveCount(0);
  expect(observed.accessRequests).toBe(0);
});

test('public binding page validates the invitation before any Staff session request', async ({ page }) => {
  let apiRequests = 0;
  await page.route('**/api/**', async (route) => {
    apiRequests += 1;
    await json(route, {});
  });
  await page.goto('/staff/bind?invite=short');
  await expect(page.getByRole('heading', { name: '加入员工工作台' })).toBeVisible();
  await expect(page.getByText(/邀请链接不完整/u)).toBeVisible();
  await expect(page.getByRole('button', { name: '使用飞书完成绑定' })).toBeDisabled();
  expect(apiRequests).toBe(0);
});
