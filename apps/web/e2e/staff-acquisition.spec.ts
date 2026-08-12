import { expect, test, type Page, type Route } from '@playwright/test';

const success = (data: unknown) => ({ data, meta: { request_id: 'acquisition-browser' } });

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function session(role: 'acquisition' | 'buyer_refund') {
  return {
    staff_id: `browser-${role}`, display_name: role === 'acquisition' ? '浏览器获客' : '浏览器返款',
    role: role === 'acquisition'
      ? { code: 'acquisition', display_name: '获客' }
      : { code: 'buyer_refund', display_name: '买家返款' },
    permissions: [],
    data_scope: { type: 'MARKETPLACE', buyerCustomerIds: [],
      marketplaceCodes: ['AMAZON_JP'], sellerOrganizationIds: [], teamIds: [] },
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

function channel() {
  return { channel_id: 'browser-channel', code: 'XHS_BROWSER', channel_type: 'XIAOHONGSHU',
    platform_name: '小红书', lead_type: 'BUYER', marketplace_code: 'AMAZON_JP',
    display_name: '小红书浏览器号', status: 'ACTIVE', version: 1,
    created_at: 1_786_000_000_000, updated_at: 1_786_000_000_000,
    visibility: 'INTERNAL', staff_label: '渠道1', intake_wechat_label: '月光白客服1', profile_version: 1 };
}

function prospect() {
  return { prospect_id: 'browser-prospect', lead_type: 'BUYER', marketplace_code: 'AMAZON_JP',
    origin_channel_id: 'browser-channel', origin_channel_name: '小红书浏览器号',
    display_name: '浏览器买家', contact_value: 'browser_private_wx', source_url: null,
    origin_mode: 'HUMAN', status: 'NEW', ai_score: null, note: null,
    discovered_at: 1_786_000_000_000, converted_lead_id: null, version: 1,
    created_at: 1_786_000_000_000, updated_at: 1_786_000_000_000 };
}

async function mock(page: Page, role: 'acquisition' | 'buyer_refund', observed?: { body?: unknown; consultationWrites?: number }) {
  let created = false;
  await page.route('**/api/**', async (route) => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (path === '/api/staff-auth/session') return json(route, success({ session: session(role) }));
    if (path === '/api/staff/acquisition/channels') return json(route, success({ channels: [channel()] }));
    if (path === '/api/staff/acquisition/prospects' && request.method() === 'GET')
      return json(route, success({ items: created ? [prospect()] : [], next_cursor: null }));
    if (path === '/api/staff/acquisition/consultations' && request.method() === 'GET')
      return json(route, success({ consultations: [] }));
    if (path === '/api/staff/acquisition/consultations' && request.method() === 'POST') {
      if (observed) observed.consultationWrites = (observed.consultationWrites ?? 0) + 1;
      return json(route, { error: { code: 'FORBIDDEN', message: 'forbidden', details: null },
        meta: { request_id: 'acquisition-browser-owner-only' } }, 403);
    }
    if (path === '/api/staff/acquisition/funnel') return json(route, success({ funnel: funnel() }));
    if (path === '/api/staff/acquisition/channel-stats') return json(route, success({ channels: [] }));
    if (path === '/api/staff/acquisition/source-corrections/candidates') return json(route, success({ items: [] }));
    if (path === '/api/staff/acquisition/prospects' && request.method() === 'POST') {
      if (observed) observed.body = request.postDataJSON(); created = true;
      return json(route, success({ prospect: prospect(), replayed: false }), 201);
    }
    return json(route, { error: { code: 'NOT_FOUND', message: 'not found', details: null },
      meta: { request_id: 'acquisition-browser-unhandled' } }, 404);
  });
}

test('bookmarkable acquisition route keeps consultation read-only and creates a controlled human prospect', async ({ page }) => {
  const observed: { body?: unknown; consultationWrites?: number } = { consultationWrites: 0 };
  await mock(page, 'acquisition', observed);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/staff/acquisition');
  await expect(page).toHaveURL(/\/staff\/acquisition$/u);
  await expect(page.getByRole('heading', { name: '客户开发中心' })).toBeVisible();
  await page.getByRole('button', { name: '每日渠道数据' }).click();
  await expect(page.getByRole('heading', { name: '日咨询只读' })).toBeVisible();
  await expect(page.getByRole('button', { name: '保存', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '潜在线索' }).click();
  await page.getByRole('button', { name: '新增线索' }).click();
  await page.getByLabel('客户类型').selectOption('BUYER');
  await page.getByLabel('真实来源渠道').selectOption('browser-channel');
  await page.getByLabel('客户 / 公司名称').fill('浏览器买家');
  await page.getByLabel('联系方式（可空）').fill('browser_private_wx');
  await page.getByRole('button', { name: '保存线索' }).click();
  await expect(page.getByText('浏览器买家')).toBeVisible();
  expect(observed.body).toMatchObject({ lead_type: 'BUYER', marketplace_code: 'AMAZON_JP',
    channel_id: 'browser-channel', display_name: '浏览器买家', origin_mode: 'HUMAN' });
  expect(observed.consultationWrites).toBe(0);
  const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth }));
  expect(width.content).toBeLessThanOrEqual(width.viewport + 1);
});

test('buyer_refund direct route exposes no acquisition command', async ({ page }) => {
  await mock(page, 'buyer_refund'); await page.goto('/staff/acquisition');
  await expect(page.getByText('当前岗位不使用客户开发中心。')).toBeVisible();
  await expect(page.getByRole('button', { name: '新增潜在线索' })).toHaveCount(0);
});
