import { afterEach, describe, expect, it } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import {
  isMarketplaceCode,
  MARKETPLACE_CODES,
  ARCHIVE_BUNDLE_STATES,
  ARCHIVE_BUNDLE_TRANSITIONS,
} from '@ygb/contracts';
import app from '../index';

// Stage 4 canonical-contract regression suite (D-054): the marketplace alias
// retirement, fail-closed secondary markets, retired-route 404 behavior, and
// the contract-only stage 5 archive lifecycle vocabulary.

let database: SqliteDatabase | null = null;
afterEach(() => {
  database?.close();
  database = null;
});

describe('stage 4 marketplace canonical contract', () => {
  it('accepts exactly the seven registry codes and rejects every legacy short code', () => {
    expect([...MARKETPLACE_CODES]).toEqual([
      'AMAZON_JP', 'AMAZON_US', 'COUPANG_KR',
      'RAKUTEN_JP', 'YAHOO_JP', 'TEMU_JP', 'TIKTOK_JP',
    ]);
    for (const code of MARKETPLACE_CODES) expect(isMarketplaceCode(code)).toBe(true);
    for (const retired of ['JP', 'US', 'KR', 'JP_RAKUTEN', 'JP_YAHOO']) {
      expect(isMarketplaceCode(retired)).toBe(false);
    }
  });

  it('keeps the five owner-approved marketplaces live and COUPANG_KR fail-closed', async () => {
    database = createMigratedTestDatabase();
    const registry = database.raw.prepare(
      'SELECT code, status, adapter_status FROM marketplace_registry ORDER BY code',
    ).all() as { code: string; status: string; adapter_status: string }[];
    expect(registry).toEqual([
      { code: 'AMAZON_JP', status: 'ACTIVE', adapter_status: 'AVAILABLE' },
      { code: 'AMAZON_US', status: 'ACTIVE', adapter_status: 'AVAILABLE' },
      { code: 'COUPANG_KR', status: 'DISABLED', adapter_status: 'UNAVAILABLE' },
      { code: 'RAKUTEN_JP', status: 'ACTIVE', adapter_status: 'AVAILABLE' },
      { code: 'TEMU_JP', status: 'ACTIVE', adapter_status: 'AVAILABLE' },
      { code: 'TIKTOK_JP', status: 'ACTIVE', adapter_status: 'AVAILABLE' },
      { code: 'YAHOO_JP', status: 'ACTIVE', adapter_status: 'AVAILABLE' },
    ]);
    // Every business marketplace column now stores canonical codes only.
    const shortCodeRows = database.raw.prepare(`
      SELECT COUNT(*) AS count FROM order_evidence_submissions
      WHERE marketplace_code NOT IN ('AMAZON_JP','AMAZON_US','COUPANG_KR','RAKUTEN_JP','YAHOO_JP','TEMU_JP','TIKTOK_JP')
    `).get() as { count: number };
    expect(shortCodeRows.count).toBe(0);
    const retiredTables = database.raw.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_schema
      WHERE name IN ('marketplaces','marketplace_legacy_aliases','acquisition_reporting_config')
    `).get() as { count: number };
    expect(retiredTables.count).toBe(0);
  });
});

describe('stage 4 retired routes return 404 without compatibility behavior', () => {
  const retiredPaths = [
    '/api/staff/acquisition/funnel?from_date=2026-08-01&to_date=2026-08-08',
    '/api/staff/acquisition/handoffs?lead_type=BUYER',
    '/api/staff/acquisition/reporting-config',
    '/api/staff/acquisition/reporting-config/activate',
    '/api/staff/admin-business-dashboard/trends?from_date=2026-08-01&to_date=2026-08-08&granularity=DAY',
    '/api/staff/admin-business-dashboard/drill-down?metric=NEW_BUYERS&from_date=2026-08-01&to_date=2026-08-08&limit=50',
    '/api/staff/admin-business-dashboard/acquisition-daily?from_date=2026-08-01&to_date=2026-08-08',
    '/api/staff/order-instructions/evidence/assets/prepare',
    '/api/v2/buyer-portal/me',
  ];

  it('answers retired staff endpoints behind the auth gate and never revives them', async () => {
    // /api/staff/* sits behind staffSessionMiddleware, so an unauthenticated
    // probe is rejected with 401 before routing — the auth gate must not leak
    // whether a retired staff route still exists. Retired non-staff paths and
    // /api/v2 aliases fall straight through to the concealed 404 envelope.
    for (const path of retiredPaths) {
      const response = await app.request(`https://api.example.test${path}`, {}, {});
      if (path.startsWith('/api/staff/')) {
        expect(response.status, path).toBe(401);
      } else {
        expect(response.status, path).toBe(404);
        const body = await response.json() as Record<string, unknown>;
        expect(body, path).toMatchObject({ error: { code: 'NOT_FOUND' } });
        expect(JSON.stringify(body)).not.toMatch(/stack|sql|object_key|internal/iu);
      }
    }
    // And none of the retired routes may be registered at all.
    const registered = new Set(app.routes.map((route) => route.path));
    for (const path of retiredPaths) {
      expect(registered.has(path.split('?')[0]!), path).toBe(false);
    }
  });
});

describe('stage 5 archive lifecycle vocabulary (contract-only)', () => {
  it('publishes the six D-055 bundle states with staff-only restore transitions', () => {
    expect([...ARCHIVE_BUNDLE_STATES]).toEqual([
      'ONLINE',
      'ARCHIVED',
      'RESTORE_REQUESTED',
      'RESTORING',
      'RESTORED_TEMPORARILY',
      'RESTORE_FAILED',
    ]);
    // Terminal-ish loops: temporary restore expires back to ARCHIVED and
    // failed restores stay retryable instead of wedging the bundle.
    expect(ARCHIVE_BUNDLE_TRANSITIONS.RESTORED_TEMPORARILY).toEqual(['ARCHIVED']);
    expect(ARCHIVE_BUNDLE_TRANSITIONS.RESTORE_FAILED).toEqual(['RESTORE_REQUESTED']);
    // No state may transition to ONLINE: archived bundles never become
    // first-class hot objects again, only temporary restore copies exist.
    for (const targets of Object.values(ARCHIVE_BUNDLE_TRANSITIONS)) {
      expect(targets).not.toContain('ONLINE');
    }
    // Stage 5 wires exactly one staff-only restore endpoint under the
    // operations archive prefix; buyer and seller domains expose none.
    const restoreRoutes = app.routes.filter((route) => /restore/u.test(route.path));
    expect(restoreRoutes.map((route) => `${route.method} ${route.path}`)).toEqual([
      'POST /api/staff/operations/archive/bundles/:id/restore',
    ]);
  });
});
