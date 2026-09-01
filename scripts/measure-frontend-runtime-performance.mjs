import { chromium } from '@playwright/test';

const baseUrl = process.env['PERFORMANCE_BASE_URL'] ?? 'http://127.0.0.1:4174';
const label = process.env['PERFORMANCE_LABEL'] ?? 'local';
const runs = Number(process.env['PERFORMANCE_RUNS'] ?? '3');
if (!Number.isSafeInteger(runs) || runs < 1 || runs > 10) {
  throw new Error('PERFORMANCE_RUNS must be an integer from 1 to 10');
}

const browser = await chromium.launch({ headless: true });
const results = {};

for (const identity of ['buyer', 'seller']) {
  const samples = [];
  for (let run = 0; run < runs; run += 1) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    await installApiFixtures(page, identity);
    let recording = false;
    const javascriptBodies = [];
    const javascriptNames = [];
    const apiStarted = new Map();
    const apiResponses = [];
    page.on('request', (request) => {
      if (recording && new URL(request.url()).pathname.startsWith('/api/')) {
        apiStarted.set(request, performance.now());
      }
    });
    page.on('response', (response) => {
      const pathname = new URL(response.url()).pathname;
      if (!recording) return;
      if (/^\/assets\/.*\.js$/u.test(pathname)) {
        javascriptNames.push(pathname.split('/').at(-1));
        javascriptBodies.push(response.body().then((body) => body.byteLength));
      }
      const startedAt = apiStarted.get(response.request());
      if (startedAt !== undefined) {
        apiResponses.push({
          path: pathname,
          status: response.status(),
          duration_ms: round(performance.now() - startedAt),
        });
      }
    });

    await page.goto(`${baseUrl}/${identity}/login`, { waitUntil: 'networkidle' });
    await page.getByLabel('账号').fill(`${identity}_performance`);
    await page.getByLabel('密码').fill('local-performance-password');
    const heading = identity === 'buyer' ? '当前开放产品' : '业务进度';
    const visible = page.evaluate((expectedHeading) => new Promise((resolve) => {
      const startedAt = performance.now();
      const findHeading = () => Array.from(document.querySelectorAll('h1, h2'))
        .some((element) => element.textContent?.trim() === expectedHeading);
      const finish = () => resolve(performance.now() - startedAt);
      if (findHeading()) {
        finish();
        return;
      }
      const observer = new MutationObserver(() => {
        if (!findHeading()) return;
        observer.disconnect();
        finish();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }), heading);
    recording = true;
    await page.getByRole('button', { name: '登录' }).click();
    const visibleMs = await visible;
    await page.waitForTimeout(25);
    const javascriptBytes = (await Promise.all(javascriptBodies))
      .reduce((total, bytes) => total + bytes, 0);
    const apiCounts = Object.groupBy(apiResponses, (response) => response.path);
    samples.push({
      visible_ms: round(visibleMs),
      javascript_bytes: javascriptBytes,
      javascript_requests: javascriptNames.length,
      javascript_assets: [...javascriptNames].sort(),
      api_requests: apiResponses,
      duplicate_api_requests: Object.fromEntries(Object.entries(apiCounts)
        .filter(([, responses]) => responses.length > 1)
        .map(([pathname, responses]) => [pathname, responses.length])),
    });
    await context.close();
  }
  results[identity] = {
    samples,
    median_visible_ms: median(samples.map((sample) => sample.visible_ms)),
    median_javascript_bytes: median(samples.map((sample) => sample.javascript_bytes)),
    median_javascript_requests: median(samples.map((sample) => sample.javascript_requests)),
    median_api_requests: median(samples.map((sample) => sample.api_requests.length)),
  };
}

await browser.close();
console.log(JSON.stringify({ label, base_url: baseUrl, runs, results }, null, 2));

async function installApiFixtures(page, identity) {
  const accountType = identity === 'buyer' ? 'BUYER' : 'SELLER_MEMBER';
  const session = {
    account_id: `${identity}-performance`,
    identity_subject_id: `${identity}-performance-subject`,
    account_type: accountType,
    session_version: 1,
    password_change_required: false,
    issued_at: 1,
    expires_at: 9_999_999_999_999,
  };
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === `/api/customer-auth/${identity}/login`
      || path === '/api/customer-auth/session') {
      await json(route, { session });
      return;
    }
    if (identity === 'buyer' && path === '/api/buyer-portal/demands') {
      await json(route, { items: [], page: { limit: 20, next_cursor: null } });
      return;
    }
    if (identity === 'seller' && path === '/api/seller-portal/me') {
      await json(route, { me: {
        account_id: session.account_id,
        member: { id: 'member-performance', display_name: '性能测试卖家', role: 'OWNER', primary_owner: true },
        organization: { id: 'org-performance', seller_code: 'seller-performance', name: '性能测试组织', marketplace_code: 'AMAZON_JP', status: 'ACTIVE' },
        access: { read_scope: 'ORGANIZATION', store_ids: ['store-performance'], can_submit_product_applications: true, can_submit_demand_batches: true },
      } });
      return;
    }
    if (identity === 'seller' && path === '/api/seller-portal/stores') {
      await json(route, { items: [{
        id: 'store-performance', marketplace_code: 'AMAZON_JP', canonical_marketplace_code: 'AMAZON_JP',
        transaction_currency_code: 'JPY', transaction_currency_exponent: 0,
        marketplace_status: 'ACTIVE', adapter_status: 'AVAILABLE', display_name: '性能测试店铺',
        status: 'ACTIVE', version: 1, created_at: 1, updated_at: 1,
      }], page: { limit: 100, next_cursor: null } });
      return;
    }
    if (identity === 'seller' && path === '/api/seller-portal/formal-orders') {
      await json(route, { items: [], page: { limit: 100, next_cursor: null } });
      return;
    }
    if (identity === 'seller' && path === '/api/seller-portal/settlement/summary') {
      await json(route, { settlement: {
        outstanding_principal_cny_fen: '0', outstanding_service_fee_cny_fen: '0',
        total_outstanding_cny_fen: '0', unallocated_credit_cny_fen: '0',
      } });
      return;
    }
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'NOT_FOUND', message: 'local performance fixture', details: null },
        meta: { request_id: 'local-performance-unhandled' },
      }),
    });
  });
}

async function json(route, data) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data, meta: { request_id: 'local-performance' } }),
  });
}

function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)];
}

function round(value) {
  return Math.round(value * 10) / 10;
}
