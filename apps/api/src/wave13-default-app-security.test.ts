import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FILE_HTTP_LIFECYCLE_PATHS,
  FILE_HTTP_PURPOSE_ROUTES,
  STAFF_BUYER_REFUND_PATHS,
  STAFF_ORDER_EVIDENCE_PATHS,
} from '@ygb/contracts';
import app from './index';

const root = path.resolve(process.cwd());
const read = (relative: string) => readFileSync(path.join(root, relative), 'utf8');

describe('Wave 13 default app and route security boundaries', () => {
  it('registers public Staff Auth before middleware and every Staff family after it', () => {
    const index = read('apps/api/src/index.ts');
    const auth = index.indexOf('registerStaffAuthRoutes(app');
    const middleware = index.indexOf("app.use('/api/staff/*', staffSessionMiddleware())");
    expect(auth).toBeGreaterThanOrEqual(0);
    expect(middleware).toBeGreaterThan(auth);
    for (const registration of [
      'registerStaffAssignmentRoutes(app)',
      'registerStaffCatalogWorkflowRoutes(app)',
      'registerStaffReviewRoutes(app)',
      'registerStaffSellerSettlementRoutes(app)',
      'registerStaffSellerSettlementProofRoutes(app)',
      'registerStaffFinanceRoutes(app)',
      'registerStaffOrderEvidenceRoutes(app)',
      'registerStaffBuyerRefundRoutes(app)',
      'registerFileHttpRoutes(app)',
    ]) {
      expect(index.indexOf(registration)).toBeGreaterThan(middleware);
    }
  });

  it('does not register /api/v2 aliases', () => {
    const applicationSources = [
      'apps/api/src/index.ts',
      'apps/api/src/staff-auth/routes.ts',
      'apps/api/src/files/routes.ts',
      'apps/api/src/order-evidence/staff-routes.ts',
      'apps/api/src/buyer-refunds/staff-routes.ts',
    ].map(read).join('\n');
    expect(applicationSources).not.toContain('/api/v2/');
  });

  it('does not trust Feishu or client Staff headers', () => {
    const middleware = read('apps/api/src/middleware/staff-auth.ts');
    expect(middleware).toContain('readStaffSessionCookie');
    expect(middleware).toContain('resolveTrustedStaffSession');
    for (const forbidden of [
      "header('X-Staff-Id')",
      "header('X-Feishu-Open-Id')",
      "header('X-Feishu-User-Id')",
      "header('Authorization')",
    ]) expect(middleware).not.toContain(forbidden);
  });

  it('re-resolves authorization and Data Scope on every Staff request', () => {
    const session = read('apps/api/src/staff-auth/session.ts');
    expect(session).toContain('resolveAssignmentStaffAuthorization');
    expect(session).toContain('resolveStaffDataScope');
    expect(session).toContain('issued_session_version');
    expect(session).toContain('issued_authorization_version');
    expect(session).not.toContain('last_seen');
    expect(session).not.toContain('idle');
  });

  it('reproduces the audited 140 active route inventory', () => {
    const businessMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
    const entries = app.routes
      .map((route, index) => ({
        index,
        method: route.method.toUpperCase(),
        path: normalizeRoutePath(route.path),
      }))
      .filter((route) => businessMethods.has(route.method));

    // Hono records each handler in one route's middleware chain separately.
    // Treat one contiguous METHOD/PATH block as one registration, and fail if
    // the same endpoint appears again in a second registration block.
    const blocks: { key: string; firstIndex: number }[] = [];
    for (const entry of entries) {
      const key = `${entry.method} ${entry.path}`;
      if (blocks.at(-1)?.key !== key) {
        blocks.push({ key, firstIndex: entry.index });
      }
    }
    const blockCounts = new Map<string, number>();
    for (const block of blocks) {
      blockCounts.set(block.key, (blockCounts.get(block.key) ?? 0) + 1);
    }
    const duplicateRegistrations = [...blockCounts]
      .filter(([, count]) => count > 1)
      .map(([key]) => key)
      .sort();
    expect(duplicateRegistrations).toEqual([]);

    const inventory = blocks.map((block) => block.key).sort();
    const inventoryDump = inventory.join('\n');
    expect(inventory, inventoryDump).toHaveLength(140);
    expect(inventory.some((route) => route.includes('/api/v2'))).toBe(false);
    expect(inventory.some((route) => /\/(?:links?|grants?)(?:\/|$)/u
      .test(route))).toBe(false);
    expect(inventory.some((route) => route.includes(
      '/file-uploads/order-evidence-internal-communication/',
    ))).toBe(false);

    const wave13 = new Set<string>();
    const add = (method: string, path: string) => {
      wave13.add(`${method} ${normalizeRoutePath(path)}`);
    };
    add('POST', '/api/staff-auth/login/start');
    add('GET', '/api/staff-auth/feishu/callback');
    add('GET', '/api/staff-auth/session');
    add('POST', '/api/staff-auth/logout');
    add('POST', '/api/staff-auth/logout-all');
    for (const route of Object.values(FILE_HTTP_PURPOSE_ROUTES)) {
      add('POST', route.path);
    }
    for (const [name, route] of Object.entries(FILE_HTTP_LIFECYCLE_PATHS)) {
      add(name.toLowerCase().endsWith('upload') ? 'PUT'
        : name.toLowerCase().endsWith('read') ? 'GET' : 'POST', route);
    }
    add('GET', STAFF_ORDER_EVIDENCE_PATHS.list);
    add('GET', STAFF_ORDER_EVIDENCE_PATHS.detail);
    add('POST', STAFF_ORDER_EVIDENCE_PATHS.requestChanges);
    add('POST', STAFF_ORDER_EVIDENCE_PATHS.approve);
    add('GET', STAFF_BUYER_REFUND_PATHS.list);
    add('GET', STAFF_BUYER_REFUND_PATHS.detail);
    add('POST', STAFF_BUYER_REFUND_PATHS.payment);
    add('POST', STAFF_BUYER_REFUND_PATHS.reversal);

    expect([...wave13].filter((route) => route.includes('/staff-auth/')))
      .toHaveLength(5);
    expect([...wave13].filter((route) => route.includes('/file-uploads/')
      && route.endsWith('/intents'))).toHaveLength(5);
    expect([...wave13].filter((route) =>
      Object.values(FILE_HTTP_LIFECYCLE_PATHS).some((path) =>
        route.endsWith(path),
      ))).toHaveLength(12);
    expect([...wave13].filter((route) =>
      Object.values(STAFF_ORDER_EVIDENCE_PATHS).some((path) =>
        route.endsWith(path),
      ))).toHaveLength(4);
    expect([...wave13].filter((route) =>
      Object.values(STAFF_BUYER_REFUND_PATHS).some((path) =>
        route.endsWith(path),
      ))).toHaveLength(4);
    expect(wave13).toHaveLength(30);
    const inventorySet = new Set(inventory);
    expect([...wave13].every((route) => inventorySet.has(route))).toBe(true);
    expect(inventory.filter((route) => !wave13.has(route)), inventoryDump)
      .toHaveLength(110);

    const staffMiddlewareIndex = app.routes.findIndex((route) =>
      route.method === 'ALL' && route.path === '/api/staff/*',
    );
    expect(staffMiddlewareIndex).toBeGreaterThanOrEqual(0);
    expect(entries.filter((route) => route.path.startsWith('/api/staff/'))
      .every((route) => route.index > staffMiddlewareIndex)).toBe(true);
  });
});

function normalizeRoutePath(value: string): string {
  const normalized = value.replace(/\/{2,}/gu, '/').replace(/\/$/u, '');
  return normalized || '/';
}
