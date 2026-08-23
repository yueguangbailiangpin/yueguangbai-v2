import { expect, test, type Page } from '@playwright/test';

function json(route: ReturnType<Page['route']>, body: unknown) {
  return route.fulfill({ json: { data: body, meta: { request_id: 'mock' } } });
}

test('staff review evidence image loads through the read-intent chain', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/')) {
      requests.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });
  const consoleErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });

  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/staff-auth/session') {
      return json(route, {
        session: {
          staff_id: 'staff-owner', display_name: 'Owner',
          role: { code: 'owner', display_name: '总管理员' },
          permissions: ['REVIEW_VIEW', 'REVIEW_DECIDE'],
          data_scope: { type: 'GLOBAL', marketplaceCodes: [], buyerCustomerIds: [], sellerOrganizationIds: [], teamIds: [] },
          authorization_version: 1, session_version: 1, expires_at: 9999999999999,
        },
      });
    }
    if (path === '/api/staff/me/work-items/work-review') {
      return json(route, { work_item: {
        work_item_id: 'work-review', work_type: 'REVIEW_DECISION',
        source_entity_type: 'REVIEW_CASE', source_entity_id: 'review-1',
        buyer_customer_id: 'buyer-1', seller_organization_id: 's1', store_id: 'store-1',
        duty_code: 'BUYER_AFTER_SALES_OWNER', fixed_assignment_id: 'f1', assigned_staff_id: 'staff-owner',
        status: 'OPEN', version: 1, created_at: 1, updated_at: 1,
        completed_at: null, cancelled_at: null,
      } });
    }
    if (path === '/api/staff/reviews/review-1') {
      return json(route, { review: {
        review_case_id: 'review-1', formal_order_id: 'order-1',
        buyer_customer_id: 'buyer-1', seller_organization_id: 's1',
        review_type: 'TEXT', status: 'PENDING_REVIEW', version: 1,
        current_evidence_version_no: 1,
        public_change_reason: null, internal_review_note: null,
        submitted_at: 1, updated_at: 1, decided_at: null,
        current_evidence: {
          evidence_version_id: 'ev-1', version_no: 1, review_type: 'TEXT',
          review_url: 'https://example.com/r', buyer_note: null,
          submitted_by_buyer_id: 'buyer-1', submitted_at: 1,
          files: [{
            file_object_id: 'review-file-1', file_entity_link_id: 'link-1',
            file_version: 3, purpose: 'REVIEW_EVIDENCE', visibility: 'SELLER_VISIBLE',
            client_file_name: 'image.png', mime: 'image/png',
            byte_size: 438271, verified_at: 1,
          }],
        },
      } });
    }
    if (path === '/api/staff/files/review-file-1/read-intents') {
      return json(route, {
        read_intent_id: 'review-intent-1', file_object_id: 'review-file-1',
        access_token: 't'.padEnd(40, 'x'), access_token_available: true,
        expires_at: 9999999999999, replayed: false,
      });
    }
    if (path === '/api/staff/file-read-intents/review-intent-1/content') {
      return route.fulfill({
        body: Buffer.from(Uint8Array.of(1, 2)),
        headers: {
          'Content-Type': 'image/png',
          'Content-Length': '2',
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
    return json(route, {});
  });

  await page.goto('/staff/work/work-review');
  // 滚动触发懒加载（滚到底再回顶，确保经过图片区域）
  for (const delta of [1200, 1200, 1200]) {
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(500);
  }
  await page.mouse.wheel(0, -2400);
  await page.waitForTimeout(2500);
  const img = page.getByRole('img', { name: 'image.png' });
  const visible = await img.isVisible().catch(() => false);
  // 回归：评论文件引用必须传窄引用（strict safeFileReference），宽 DTO 会在
  // 校验阶段直接失败且零网络请求。
  expect(requests.some((r) => r.includes('/api/staff/files/review-file-1/read-intents'))).toBe(true);
  expect(consoleErrors).toEqual([]);
  expect(visible).toBe(true);
});
