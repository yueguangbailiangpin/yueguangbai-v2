import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Stage 7.5R-2 browser verification for the seller settlement batch list +
 * read-only detail: list→detail entry at 1440/390, 250 members across two
 * cursor pages with no duplicates or gaps, failure recovery, the safe
 * concealed-404 state, and readability for all four member roles. All APIs
 * are mocked deterministically; responses are shaped exactly like the
 * shared strict schemas require.
 */

const directory = process.env['STAGE75R2_SCREENSHOT_DIR']
  ?? 'tmp/stage75r2-seller-batch-detail-screenshots';

const BATCH_ID = 'batch-75r2-0001';
const CONFIRMED_AT = 1_787_900_100_000;

function ok(data: unknown, requestId = 'stage75r2') {
  return {
    contentType: 'application/json',
    body: JSON.stringify({ data, meta: { request_id: requestId } }),
  };
}

function sellerMe(role: string) {
  return {
    me: {
      account_id: 'seller-75r2-account',
      member: {
        id: 'member-75r2',
        display_name: '卖家甲',
        role,
        primary_owner: role === 'OWNER',
      },
      organization: {
        id: 'org-75r2',
        seller_code: 'YG-75R201',
        name: '批次卖家',
        marketplace_code: 'AMAZON_JP',
        status: 'ACTIVE',
        settlement_account_name: null,
        settlement_account_identifier: null,
      },
      access: {
        read_scope: 'ORGANIZATION',
        store_ids: ['store-75r2'],
        can_submit_product_applications: false,
        can_submit_demand_batches: false,
      },
    },
  };
}

function member(index: number) {
  const pad = String(index).padStart(3, '0');
  return {
    amazon_order_number: `900-${pad}-${pad}`,
    payable_type: index % 2 === 0 ? 'SELLER_PRINCIPAL' : 'SELLER_SERVICE_FEE',
    frozen_amount_cny_fen: '1000',
    paid_amount_cny_fen: '0',
    outstanding_amount_cny_fen: '1000',
  };
}

const BATCH = {
  batch_id: BATCH_ID,
  status: 'CONFIRMED',
  frozen_total_cny_fen: '250000',
  frozen_payable_count: 250,
  paid_amount_cny_fen: '0',
  outstanding_amount_cny_fen: '250000',
  confirmed_at: CONFIRMED_AT,
};

async function mockSession(page: Page, role: string): Promise<void> {
  await page.route('**/api/customer-auth/session', async (route: Route) => {
    await route.fulfill(ok({
      session: {
        account_id: 'seller-75r2-account',
        identity_subject_id: 'seller-75r2-subject',
        account_type: 'SELLER_MEMBER',
        session_version: 1,
        password_change_required: false,
        issued_at: 1_787_000_000_000,
        expires_at: 9_999_999_999_999,
      },
    }));
  });
  await page.route('**/api/seller-portal/me', async (route: Route) => {
    await route.fulfill(ok(sellerMe(role)));
  });
}

async function mockBatchDetail(page: Page, options: {
  members: 'two-pages' | 'one-page';
  failFirst?: boolean;
  notFound?: boolean;
}): Promise<void> {
  let firstAttempt = true;
  // Playwright globs match the full URL including the query string, so the
  // cursor-paginated detail request needs its own trailing wildcard.
  const handler = async (route: Route): Promise<void> => {
    if (options.notFound === true) {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'NOT_FOUND', message: '资源不存在', details: null },
          meta: { request_id: 'stage75r2-404' },
        }),
      });
      return;
    }
    if (options.failFirst === true && firstAttempt) {
      firstAttempt = false;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'down', details: null },
          meta: { request_id: 'stage75r2-503' },
        }),
      });
      return;
    }
    const cursor = new URL(route.request().url()).searchParams.get('members_cursor');
    const members = options.members === 'two-pages'
      ? (cursor === null
        ? Array.from({ length: 200 }, (_, index) => member(index + 1))
        : Array.from({ length: 50 }, (_, index) => member(index + 201)))
      : [member(1)];
    const nextCursor = options.members === 'two-pages'
      ? (cursor === null ? 'cursor-75r2-page-2' : null)
      : null;
    await route.fulfill(ok({ batch: { ...BATCH, members, members_next_cursor: nextCursor } }));
  };
  await page.route(`**/api/seller-portal/settlement/batches/${BATCH_ID}`, handler);
  await page.route(`**/api/seller-portal/settlement/batches/${BATCH_ID}?**`, handler);
}

test.beforeAll(() => {
  mkdirSync(directory, { recursive: true });
});

test('卖家四角色都能查看批次列表并进入只读详情（1440 与 390）', async ({ page }) => {
  for (const role of ['OWNER', 'OPERATIONS', 'FINANCE', 'VIEWER'] as const) {
    await mockSession(page, role);
    await page.route('**/api/seller-portal/settlement/batches', async (route: Route) => {
      await route.fulfill(ok({
        batches: [{
          ...BATCH,
          frozen_total_cny_fen: '2000',
          frozen_payable_count: 2,
          outstanding_amount_cny_fen: '2000',
        }],
        next_cursor: null,
      }));
    });
    await mockBatchDetail(page, { members: 'one-page' });

    await page.goto('/seller/settlements');
    // OWNER/FINANCE get the full page (h1+section), OPERATIONS/VIEWER the
    // batch-only page (single h1) — both render the batch list.
    await expect(page.getByRole('heading', { name: '结算批次', exact: true }).first()).toBeVisible();
    await expect(page.getByText('已确认').first()).toBeVisible();
    const entry = page.getByRole('link', { name: '查看详情' }).first();
    await entry.click();
    await expect(page.getByText('批次概况')).toBeVisible();
    await expect(page.getByText('订单 900-001-001')).toBeVisible();
    // No internal ids anywhere on the seller detail.
    expect(await page.content()).not.toContain('member_id');
    expect(await page.content()).not.toContain('payable_id');
  }

  // Screenshots for the last role (all roles share the same read-only UI).
  for (const [width, height, name] of [
    [1440, 900, 'seller-batch-detail-1440x900'],
    [390, 844, 'seller-batch-detail-390x844'],
  ] as const) {
    await page.setViewportSize({ width, height });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: join(directory, `${name}.png`), fullPage: true });
  }
});

test('250 名成员跨两页加载：第二页不重复、不遗漏', async ({ page }) => {
  await mockSession(page, 'VIEWER');
  await mockBatchDetail(page, { members: 'two-pages' });

  await page.goto(`/seller/settlements/${BATCH_ID}`);
  await expect(page.getByText('批次概况')).toBeVisible();
  await expect(page.getByText('订单 900-001-001')).toBeVisible();

  await page.getByRole('button', { name: '加载更多成员' }).click();
  await expect(page.getByText('订单 900-250-250')).toBeVisible();

  const numbers = await page.getByText(/^订单 900-\d{3}-\d{3}$/u).allTextContents();
  const trimmed = numbers.map((value) => value.replace('订单 ', ''));
  expect(trimmed).toHaveLength(250);
  expect(new Set(trimmed).size).toBe(250);
  for (const [width, height, name] of [
    [1440, 900, 'seller-batch-detail-250-members-1440x900'],
    [390, 844, 'seller-batch-detail-250-members-390x844'],
  ] as const) {
    await page.setViewportSize({ width, height });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: join(directory, `${name}.png`), fullPage: true });
  }
});

test('详情读取失败后可重试恢复；越权批次显示安全 404 态', async ({ page }) => {
  await mockSession(page, 'OPERATIONS');
  await mockBatchDetail(page, { members: 'one-page', failFirst: true });
  await page.goto(`/seller/settlements/${BATCH_ID}`);
  await expect(page.getByText('结算批次读取失败。')).toBeVisible();
  // No batch facts while the read is failing.
  await expect(page.getByText('批次概况')).toHaveCount(0);
  await page.getByRole('button', { name: '重试' }).click();
  await expect(page.getByText('批次概况')).toBeVisible();
  await expect(page.getByText('订单 900-001-001')).toBeVisible();

  // A concealed (DRAFT/CANCELLED/foreign) batch: safe 404, never a fake page.
  await page.route('**/api/seller-portal/settlement/batches/batch-75r2-hidden', async (route: Route) => {
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'NOT_FOUND', message: '资源不存在', details: null },
        meta: { request_id: 'stage75r2-hidden-404' },
      }),
    });
  });
  await page.goto(`/seller/settlements/batch-75r2-hidden`);
  await expect(page.getByText('结算批次不存在或对当前账号不可见。')).toBeVisible();
  await expect(page.getByText('批次概况')).toHaveCount(0);
  await page.screenshot({
    path: join(directory, 'seller-batch-detail-concealed-404-1440x900.png'),
    fullPage: true,
  });
});
