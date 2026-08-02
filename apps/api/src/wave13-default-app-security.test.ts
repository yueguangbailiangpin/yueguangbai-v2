import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

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
});
