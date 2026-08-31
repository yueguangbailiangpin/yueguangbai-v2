import { expect, test, type Page } from '@playwright/test';

/**
 * Stage 6.6E browser verification: staff buyer creation + bound invitation,
 * order-detail communication screenshot uploader/time, the Buyer Refund
 * advance partition, Owner assignment/DENY management, and the absence of the
 * retired acquisition / public-pool / dual-chat / order-integrity surfaces.
 * Uses the same mock-session pattern as the existing e2e suites; every API is
 * answered deterministically so assertions reflect real rendered UI.
 */

type Role = 'owner' | 'pre_sales' | 'buyer_refund';

function session(role: Role) {
  const permissionsByRole: Record<Role, string[]> = {
    owner: [
      'STAFF_MANAGE', 'PERMISSION_MANAGE', 'FINANCIAL_VIEW', 'ORDER_VIEW',
      'ORDER_CONFIRM', 'BUYER_REFUND_RECORD', 'BUYER_CREATE',
    ],
    pre_sales: [
      'BUYER_CREATE', 'BUYER_VIEW', 'ORDER_VIEW', 'ORDER_CONFIRM',
      'RESERVATION_VIEW', 'RESERVATION_DECIDE',
    ],
    buyer_refund: ['BUYER_VIEW', 'ORDER_VIEW', 'REVIEW_VIEW', 'BUYER_REFUND_VIEW', 'BUYER_REFUND_RECORD'],
  };
  return {
    staff_id: `stage66e-${role}`,
    display_name: role === 'owner' ? '总管理员' : role === 'pre_sales' ? '售前甲' : '返款甲',
    role: {
      code: role,
      display_name: role === 'owner' ? '总管理员' : role === 'pre_sales' ? '售前' : '买家返款',
    },
    permissions: permissionsByRole[role],
    data_scope: {
      type: 'GLOBAL',
      marketplaceCodes: [],
      buyerCustomerIds: [],
      sellerOrganizationIds: [],
      teamIds: [],
    },
    authorization_version: 1,
    session_version: 1,
    expires_at: 9_999_999_999_999,
  };
}

function ok(data: unknown, requestId = 'stage66e') {
  return {
    contentType: 'application/json',
    body: JSON.stringify({ data, meta: { request_id: requestId } }),
  };
}

const ORDER_DETAIL = {
  order: {
    formal_order_id: 'order-66e',
    marketplace_code: 'AMAZON_JP',
    amazon_order_number: '123-1234567-1234567',
    amazon_order_date: '2026-08-01',
    status: 'CONFIRMED',
    confirmed_at: 1754240000000,
  },
  buyer: {
    buyer_customer_id: 'buyer-66e',
    display_name: '阶段66E买家',
    customer_no: '20260828B3001',
  },
  seller: { seller_organization_id: 'org-66e', store_display_name: '测试店铺' },
  payment_screenshot: { file_object_id: 'pay-66e', file_version: 1 },
  communication_screenshots: [
    {
      file_object_id: 'comm-66e-1',
      file_version: 2,
      purpose: 'ORDER_COMMUNICATION_SCREENSHOT',
      visibility: 'SELLER_VISIBLE',
      uploaded_at: 1754240000000,
      uploaded_by_staff_id: 'stage66e-owner',
      uploaded_by_staff_name: '总管理员',
    },
  ],
  operational_events: [
    {
      event_id: 'event-66e',
      event_type: 'PRICE_MISMATCH_NOTE',
      reason: '备注',
      actor_staff_id: 'stage66e-owner',
      created_at: 1754240000000,
    },
  ],
};

const BUYER_ADVANCE = {
  authoritative_advance_amount_cny_fen: '165000',
  recorded_advance_amount_cny_fen: '0',
  remaining_advance_amount_cny_fen: '165000',
  can_record_advance_payment: true,
};

async function mockApis(page: Page, role: Role): Promise<void> {
  await page.route('**/api/**', async (route) => {

    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    if (path.endsWith('/access/bootstrap')) {
      await route.fulfill(ok({
        session: session(role),
        access_email: 'stage66e@example.test',
      }));
      return;
    }
    if (path.endsWith('/staff-auth/session')) {
      await route.fulfill(ok({ session: session(role) }));
      return;
    }
    if (path === '/api/staff/me/work-items/summary') {
      await route.fulfill(ok({ summary: {
        open_count: 0, due_today_count: 0, overdue_count: 0,
        exception_order_count: 0, refund_due_today_cny_fen: null,
        recent: [],
      } }));
      return;
    }
    if (path.endsWith('/api/staff/me/work-items')) {
      await route.fulfill(ok({ work_items: [], next_cursor: null }));
      return;
    }
    if (path.endsWith('/api/staff/search')) {
      await route.fulfill(ok({ query: '', buyers: [], products: [], orders: [], demands: [] }));
      return;
    }
    // Buyer creation: B/C number allocated immediately.
    if (path === '/api/staff/buyer-customers' && method === 'POST') {
      await route.fulfill({
        status: 201,
        ...ok({
          buyer_customer: {
            buyer_customer_id: 'buyer-66e-created',
            buyer_number: '20260828B3001',
            access_status: 'DISABLED',
            activated: false,
            initial_pre_sales_owner: {
              assignment_id: 'assign-66e',
              staff_id: 'stage66e-pre_sales',
              staff_display_name: '售前甲',
              version: 1,
            },
          },
          replayed: false,
        }),
      });
      return;
    }
    if (path.endsWith('/buyer-registration-invitations') && method === 'POST') {
      await route.fulfill({
        status: 201,
        ...ok({
          invitation: {
            invitation_id: 'invitation-66e',
            buyer_customer_id: 'buyer-66e-created',
            buyer_customer_no: '20260828B3001',
            registration_token: 'T'.repeat(43),
            registration_path: '/buyer/register?token=T',
            wechat_id: 'wx_stage66e',
            marketplace_code: 'AMAZON_JP',
            status: 'ACTIVE',
            version: 1,
            expires_at: 9_999_999_999_999,
            replayed: false,
          },
        }),
      });
      return;
    }
    if (path === '/api/staff/formal-orders/order-66e') {
      const withAdvance = role === 'owner' || role === 'buyer_refund';
      await route.fulfill(
        ok(withAdvance
          ? { ...ORDER_DETAIL, buyer_advance: BUYER_ADVANCE }
          : ORDER_DETAIL),
      );
      return;
    }
    if (path.includes('/api/staff/buyer-advance-principal/order-66e')
      && !path.includes('/payments')) {
      await route.fulfill(ok({ entries: [] }));
      return;
    }
    if (path === '/api/staff/access-management'
      || path === '/api/staff/access-management/seller-organization-assignments'
      || path === '/api/staff/access-management/buyer-assignments'
      || path === '/api/staff/access-management/personal-denies') {
      if (role !== 'owner') {
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'FORBIDDEN', message: '仅总管理员可管理员工' },
            meta: { request_id: 'stage66e-403' },
          }),
        });
        return;
      }
      if (path.endsWith('/access-management')) {
        await route.fulfill(ok({
          employees: [
            {
              staff_id: 'stage66e-owner',
              display_name: '总管理员',
              email: 'owner@example.test',
              status: 'ACTIVE',
              version: 1,
              role: { code: 'owner', display_name: '总管理员' },
              marketplace_codes: [],
              marketplace_scopes: [],
              last_login_at: null,
              updated_at: 1754240000000,
            },
            {
              staff_id: 'stage66e-pre_sales',
              display_name: '售前甲',
              email: 'presales@example.test',
              status: 'ACTIVE',
              version: 1,
              role: { code: 'pre_sales', display_name: '售前' },
              marketplace_codes: ['AMAZON_JP'],
              marketplace_scopes: [{ code: 'AMAZON_JP', scope_kind: 'PRIMARY' }],
              last_login_at: null,
              updated_at: 1754240000000,
            },
            {
              staff_id: 'stage66e-buyer_refund',
              display_name: '返款甲',
              email: 'refund@example.test',
              status: 'ACTIVE',
              version: 1,
              role: { code: 'buyer_refund', display_name: '买家返款' },
              marketplace_codes: ['AMAZON_JP'],
              marketplace_scopes: [{ code: 'AMAZON_JP', scope_kind: 'PRIMARY' }],
              last_login_at: null,
              updated_at: 1754240000000,
            },
          ],
          available_marketplaces: [
            { code: 'AMAZON_JP', display_name: '亚马逊日本站', status: 'ACTIVE' },
          ],
        }));
        return;
      }
      if (path.endsWith('/buyer-assignments')) {
        await route.fulfill(ok({
          buyers: [
            {
              buyer_customer_id: 'buyer-66e',
              buyer_display_name: '阶段66E买家',
              marketplace_code: 'AMAZON_JP',
              pre_sales_owner: {
                assignment_id: 'assign-66e',
                staff_id: 'stage66e-pre_sales',
                staff_display_name: '售前甲',
                version: 1,
              },
              refund_owner: null,
            },
          ],
        }));
        return;
      }
      if (path.endsWith('/personal-denies')) {
        await route.fulfill(ok({
          denies: [
            {
              staff_id: 'stage66e-pre_sales',
              staff_display_name: '售前甲',
              permission_code: 'ORDER_CONFIRM',
              status: 'ACTIVE',
              reason: '复核期间临时禁用',
              assigned_by_staff_id: 'stage66e-owner',
              assigned_at: 1754240000000,
              revoked_at: null,
            },
          ],
        }));
        return;
      }
      await route.fulfill(ok({ seller_organizations: [] }));
      return;
    }
    if (path.includes('/api/staff/finance/') || path.includes('/api/staff/finance?')) {
      await route.fulfill(ok({ summary: {}, exceptions: [], groups: [] }));
      return;
    }
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'NOT_FOUND', message: 'not found', details: null },
        meta: { request_id: 'stage66e-404' },
      }),
    });
  });
}

test.describe('stage 6.6E staff contract wiring', () => {
  test('staff creates a buyer profile, sees the number, then issues the bound invitation', async ({ page }) => {
    await mockApis(page, 'pre_sales');
    await page.goto('/staff/buyer-customers');
    await expect(page.locator('#staff-main-content').getByRole('heading', { name: '买家客户', exact: true })).toBeVisible();
    await page.locator('#BUYER-market').selectOption('AMAZON_JP');
    await page.locator('#BUYER-wechat').fill('wx_stage66e');
    await page.locator('#BUYER-name').fill('阶段66E买家');
    await page.locator('#buyer-channel').selectOption('buyer-channel-wechat-b');
    await page.getByRole('button', { name: '建立买家档案' }).click();
    await expect(page.getByText('20260828B3001').first()).toBeVisible();
    await expect(page.getByText(/未激活/).first()).toBeVisible();
    await expect(page.getByText(/售前负责人 售前甲/u).first()).toBeVisible();
    await page.getByRole('button', { name: '签发注册邀请' }).click();
    await expect(page.locator('#invite-invitation-66e')).toHaveValue(/buyer\/register/u);
  });

  test('owner order detail shows communication screenshot uploader and upload time', async ({ page }) => {
    await mockApis(page, 'owner');
    await page.goto('/staff/orders/order-66e');
    await expect(page.getByRole('heading', { name: /订单沟通截图/u })).toBeVisible();
    await expect(page.getByText(/上传员工：总管理员/u).first()).toBeVisible();
    await expect(page.getByText(/上传时间：/u).first()).toBeVisible();
  });

  test('buyer_refund sees the authoritative advance amount but no profit', async ({ page }) => {
    await mockApis(page, 'buyer_refund');
    await page.goto('/staff/orders/order-66e');
    await expect(page.getByText(/提前返本金/u).first()).toBeVisible();
    await expect(page.getByText('¥1,650.00').first()).toBeVisible();
    await expect(page.getByText(/利润/u)).toHaveCount(0);
  });

  test('pre_sales sees no advance partition', async ({ page }) => {
    await mockApis(page, 'pre_sales');
    await page.goto('/staff/orders/order-66e');
    await expect(page.getByText(/提前返本金/u)).toHaveCount(0);
  });

  test('owner manages pre-sales/refund owners and personal denies', async ({ page }) => {
    await mockApis(page, 'owner');
    await page.goto('/staff/access-management');
    await expect(page.getByRole('heading', { name: '负责买家售前' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '负责买家返款' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Personal DENY 管理' })).toBeVisible();
    await expect(page.getByText('ORDER_CONFIRM').first()).toBeVisible();
    await page.getByRole('button', { name: '撤销禁用' }).first().click();
    await expect(page.getByRole('heading', { name: '撤销个人禁用' })).toBeVisible();
  });

  test('non-owner sees no permission-management entry and gets 403 on direct access', async ({ page }) => {
    await mockApis(page, 'pre_sales');
    await page.goto('/staff');
    await expect(page.getByRole('link', { name: '员工与权限' })).toHaveCount(0);
    await page.goto('/staff/access-management');
    await expect(page.getByText(/仅总管理员/u).first()).toBeVisible();
  });

  test('retired surfaces stay absent for staff', async ({ page }) => {
    await mockApis(page, 'owner');
    await page.goto('/staff');
    const body = page.locator('body');
    await expect(body).not.toContainText('获客中心');
    await expect(body).not.toContainText('公共池');
    await expect(body).not.toContainText('抢单');
    await expect(body).not.toContainText('订单完整性');
    // Dual chat-screenshot entries were replaced by the unified order-detail card.
    await page.goto('/staff/orders/order-66e');
    await expect(
      page.getByRole('heading', { name: /买家聊天截图/u }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: /卖家订单聊天截图/u }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: /订单沟通截图/u }),
    ).toBeVisible();
  });
});
