import { expect, test, type Page, type Route } from '@playwright/test';

const invitationToken = 'a'.repeat(43);

function success(data: unknown, requestId = 'customer-security-browser') {
  return { data, meta: { request_id: requestId } };
}

async function json(route: Route, data: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status, contentType: 'application/json', body: JSON.stringify(data),
  });
}

function buyerSession() {
  return {
    account_id: 'dual-account', identity_subject_id: 'dual-subject',
    account_type: 'BUYER', available_personas: ['BUYER', 'SELLER_MEMBER'],
    session_version: 1, password_change_required: false,
    issued_at: 1, expires_at: 9_999_999_999_999,
  };
}

function staffSession() {
  return {
    staff_id: 'ordinary-staff', display_name: '普通员工',
    role: { code: 'pre_sales', display_name: '售前' },
    permissions: [], data_scope: {
      type: 'MARKETPLACE', marketplaceCodes: ['AMAZON_JP'], buyerCustomerIds: [], sellerOrganizationIds: [], teamIds: [],
    }, authorization_version: 1, session_version: 1,
    expires_at: 9_999_999_999_999,
  };
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  const width = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(width.content).toBeLessThanOrEqual(width.viewport + 1);
}

test('卖家登录由路径固定身份，且不公开 Buyer 注册入口', async ({ page }) => {
  let loginBody: unknown;
  await page.route('**/api/customer-auth/seller/login', async (route) => {
    loginBody = route.request().postDataJSON();
    await json(route, success({ session: {
      ...buyerSession(), account_type: 'SELLER_MEMBER',
    } }));
  });
  await page.goto('/seller/login');
  await expect(page.getByText('月光白')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/注册账号|立即注册/u);
  await page.getByLabel('账号').fill('dual_wx');
  await page.getByLabel('密码').fill('Strong-Password-2026!');
  await expect(page.getByLabel('进入身份')).toHaveCount(0);
  await page.getByRole('button', { name: '登录' }).click();
  expect(loginBody).toEqual({ login_identifier: 'dual_wx', password: 'Strong-Password-2026!' });
  await expect(page).toHaveURL(/\/seller$/u);
});

test('无邀请时注册失败关闭且按钮不可用', async ({ page }) => {
  await page.goto('/buyer/register');
  await expect(page.getByText('注册链接无效，请联系工作人员重新获取。'))
    .toBeVisible();
  await expect(page.getByRole('button', { name: '完成注册' }))
    .toBeDisabled();
});

test('有效邀请只展示脱敏微信和绑定站点，成功消费后进入 Buyer', async ({ page }) => {
  let registrationBody: unknown;
  let idempotencyKey: string | null = null;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === `/api/buyer-auth/invitations/${invitationToken}`) {
      await json(route, success({ invitation: {
        invitation_valid: true, marketplace_code: 'AMAZON_US',
        marketplace_name: '美国亚马逊', wechat_hint: 'bu***wx',
        expires_at: 9_999_999_999_999,
      } }));
      return;
    }
    if (path === '/api/buyer-auth/register') {
      registrationBody = route.request().postDataJSON();
      idempotencyKey = route.request().headers()['idempotency-key'] ?? null;
      await json(route, success({
        identity: { buyer_number: null, wechat_id: 'buyer_wx' },
        session_established: true, must_change_password: false,
        next_path: '/buyer',
      }), 201);
      return;
    }
    if (path === '/api/customer-auth/session') {
      await json(route, success({ session: buyerSession() }));
      return;
    }
    await json(route, { error: { code: 'NOT_FOUND', message: '安全失败',
      details: null }, meta: { request_id: 'unhandled' } }, 404);
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/buyer/register?token=${invitationToken}`);
  await expect(page.getByText('站点：美国亚马逊；邀请微信：bu***wx'))
    .toBeVisible();
  await page.getByLabel('微信号').fill('buyer_wx');
  await page.getByLabel('密码', { exact: true }).fill('Strong-Password-2026!');
  await page.getByLabel('确认密码').fill('Strong-Password-2026!');
  await page.getByRole('button', { name: '完成注册' }).click();
  await expect(page).toHaveURL(/\/buyer$/u);
  expect(registrationBody).toEqual({
    invitation_token: invitationToken, marketplace_code: 'AMAZON_US',
    wechat_id: 'buyer_wx', password: 'Strong-Password-2026!',
    password_confirmation: 'Strong-Password-2026!',
  });
  expect(idempotencyKey).toMatch(/^buyer-invite-register:/u);
  await noHorizontalOverflow(page);
});

test('密码恢复在 320px 和键盘路径可用，并回到服务端确定的卖家登录入口', async ({ page }) => {
  let resetBody: unknown;
  await page.route('**/api/customer-auth/password-reset/complete', async (route) => {
    resetBody = route.request().postDataJSON();
    await json(route, success({
      password_reset: true, all_previous_sessions_revoked: true,
      next_path: '/seller/login',
    }));
  });
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/customer/reset-password?token=reset-token-browser');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('新密码', { exact: true })).toBeFocused();
  await page.getByLabel('新密码', { exact: true }).fill('New-Strong-Password-2026!');
  await page.getByLabel('确认新密码').fill('New-Strong-Password-2026!');
  await page.getByRole('button', { name: '更新密码' }).click();
  await expect(page.getByText('密码已更新，所有旧会话均已失效。'))
    .toBeVisible();
  expect(resetBody).toEqual({
    token: 'reset-token-browser', new_password: 'New-Strong-Password-2026!',
    password_confirmation: 'New-Strong-Password-2026!',
  });
  await page.getByRole('button', { name: '去登录' }).click();
  await expect(page).toHaveURL(/\/seller\/login$/u);
  await noHorizontalOverflow(page);
});

test('普通 ACTIVE Staff 从买家客户页处理邀请与恢复，且不提供密码字段', async ({ page }) => {
  await page.route('**/api/staff-auth/session', (route) =>
    json(route, success({ session: staffSession() })));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/staff/buyer-customers');
  await expect(page.getByRole('heading', { name: '买家客户', exact: true, level: 2 }))
    .toBeVisible();
  await expect(page.getByRole('heading', { name: '历史客户 / 已有客户查询' })).toBeVisible();
  await expect(page.getByText(/账号开通、密码恢复都从具体客户记录发起/u)).toBeVisible();
  await expect(page.getByLabel(/新密码|旧密码/u)).toHaveCount(0);
  await noHorizontalOverflow(page);
});
