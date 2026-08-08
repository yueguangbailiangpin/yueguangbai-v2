import { expect, test, type Page, type Route } from '@playwright/test';

const success = (data: unknown) => ({ data, meta: { request_id: 'acquisition-browser' } });

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function session(role: 'pre_sales' | 'buyer_refund') {
  return {
    staff_id: `browser-${role}`, display_name: role === 'pre_sales' ? '浏览器售前' : '浏览器返款',
    role: role === 'pre_sales'
      ? { code: 'pre_sales', display_name: '售前' }
      : { code: 'buyer_refund', display_name: '买家返款' },
    permissions: role === 'pre_sales' ? ['ACQUISITION_BUYER_LEAD'] : [],
    data_scope: { type: 'ASSIGNED_BUYERS', buyerCustomerIds: [],
      sellerOrganizationIds: [], teamIds: [] },
    authorization_version: 1, session_version: 1, expires_at: 9_999_999_999_999,
  };
}

function funnel() {
  return { from_date: '2026-08-01', to_date: '2026-08-08', data_as_of: 1_786_000_000_000,
    buyer: { consultation_count: 12, wechat_added_count: 0, registered_count: 0,
      reservation_submitted_count: 0, no_participation_count: 0, formal_order_count: 0,
      projected_gross_profit_cny_fen: null, completed_gross_profit_cny_fen: null },
    seller: null };
}

function lead() {
  return { lead_id: 'browser-lead', lead_type: 'BUYER', wechat_masked: 'br***wx',
    display_name: '浏览器买家', note: null, origin_channel_id: 'browser-channel',
    origin_channel_name: '小红书浏览器号', origin_staff_id: 'browser-pre_sales',
    current_owner_staff_id: 'browser-pre_sales', status: 'ACTIVE', version: 1,
    created_business_date: '2026-08-08', latest_followup_at: 1_786_000_000_000,
    retention_due_at: 1_817_536_000_000, retention_hold_reason: null,
    registered: false, reservation_submitted: false, no_participation: true,
    formal_order_count: 0, seller_cooperation: false,
    created_at: 1_786_000_000_000, updated_at: 1_786_000_000_000 };
}

async function mock(page: Page, role: 'pre_sales' | 'buyer_refund', observed?: { body?: unknown }) {
  let created = false;
  await page.route('**/api/**', async (route) => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (path === '/api/staff-auth/session') return json(route, success({ session: session(role) }));
    if (path === '/api/staff/acquisition/leads' && request.method() === 'GET') {
      return json(route, success({ items: created ? [lead()] : [], next_cursor: null }));
    }
    if (path === '/api/staff/acquisition/funnel') return json(route, success({ funnel: funnel() }));
    if (path === '/api/staff/acquisition/leads' && request.method() === 'POST') {
      if (observed) observed.body = request.postDataJSON(); created = true;
      return json(route, success({ lead: lead(), replayed: false }), 201);
    }
    return json(route, { error: { code: 'NOT_FOUND', message: 'not found', details: null },
      meta: { request_id: 'acquisition-browser-unhandled' } }, 404);
  });
}

test('bookmarkable acquisition route registers a Buyer without client channel authority', async ({ page }) => {
  const observed: { body?: unknown } = {}; await mock(page, 'pre_sales', observed);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/staff/acquisition');
  await expect(page).toHaveURL(/\/staff\/acquisition$/u);
  await expect(page.getByRole('heading', { name: '获客登记' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '添加微信后登记' })).toBeVisible();
  await expect(page.getByLabel('渠道')).toHaveCount(0);
  await page.getByLabel('微信号').fill('browser_private_wx');
  await page.getByRole('button', { name: '登记线索' }).click();
  await expect(page.getByText('浏览器买家')).toBeVisible();
  expect(observed.body).toEqual({ lead_type: 'BUYER', wechat_id: 'browser_private_wx',
    display_name: null, note: null });
  expect(observed.body).not.toHaveProperty('channel_id');
  const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth }));
  expect(width.content).toBeLessThanOrEqual(width.viewport + 1);
});

test('buyer_refund direct route exposes no acquisition command', async ({ page }) => {
  await mock(page, 'buyer_refund'); await page.goto('/staff/acquisition');
  await expect(page.getByText('当前角色不参与获客登记')).toBeVisible();
  await expect(page.getByLabel('微信号')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '登记线索' })).toHaveCount(0);
});
