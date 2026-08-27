import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../../../..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

describe('second layer hardening freeze', () => {
  it('keeps production release authority on schema 29, Access and release-bound readiness', () => {
    const migrations = readdirSync(path.join(root, 'migrations'))
      .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
      .sort();
    expect(migrations).toHaveLength(29);
    expect(migrations.at(-1)).toBe('0029_stage66c_retire_acquisition_outbox.sql');
    const template = read('apps/api/wrangler.production.template.jsonc');
    expect(template).toContain('"APP_RELEASE_SHA": "REQUIRED_RELEASE_COMMIT_SHA"');
    expect(template).toContain('"SCHEDULED_OPERATIONS_ENABLED": "true"');
    expect(template).toContain('STAFF_ACCESS_TEAM_DOMAIN');
    expect(template).toContain('STAFF_ACCESS_AUD');
    expect(template).not.toContain('FEISHU_WORKBENCH_APP_ID');
    const readiness = read('apps/api/src/operational-readiness/routes.ts');
    expect(readiness).toContain('const TARGET_SCHEMA = 29');
    expect(readiness).toContain('APP_RELEASE_SHA');
    expect(readiness).toContain('last_backlog_count');
    expect(readiness).toContain('staff_access');
    const verifier = read('scripts/verify-production-readiness-formal.mjs');
    expect(verifier).toContain('external_calls:0');
    expect(verifier).not.toContain('fetchImpl');
    expect(read('scripts/probe-production-readiness.mjs')).toContain('fetchImpl=fetch');
  });

  it('keeps pricing maintenance single-save with the rate-maintainer actor gate', () => {
    // Stage 6.6 (D-056): every rate/fee/policy write is one immediate-effect
    // save behind requireRateMaintainer; the submit/confirm/reject dual
    // approval routes must stay deleted.
    for (const moduleFile of [
      'apps/api/src/pricing/buyer-daily-exchange-rates.ts',
      'apps/api/src/pricing/seller-service-fees.ts',
      'apps/api/src/pricing/seller-principal-rate-policy.ts',
    ]) {
      const source = read(moduleFile);
      expect(source).toContain('requireRateMaintainer(command.actor)');
      expect(source).not.toContain('/submit');
      expect(source).not.toContain('/confirm');
      expect(source).not.toContain('/reject');
    }
    const guard = read('apps/api/src/pricing/pricing-shared.ts');
    expect(guard).toContain('export function requireRateMaintainer');
    for (const routesFile of [
      'apps/api/src/pricing/rate-center-routes.ts',
      'apps/api/src/pricing/seller-service-fee-routes.ts',
      'apps/api/src/pricing/routes.ts',
    ]) {
      const routes = read(routesFile);
      expect(routes).not.toContain('/submit');
      expect(routes).not.toContain('/confirm');
      expect(routes).not.toContain('/reject');
      expect(routes).not.toContain('/apply-defaults');
    }
  });

  it('keeps Staff authority role-market based without Team, GRANT or legacy mutation expansion', () => {
    const policy = read('apps/api/src/staff/authorization-policy.ts');
    expect(policy).not.toContain(
      'permissions.add(permission);\n  }\n\n  if (input.leaderTeamIds.length',
    );
    expect(policy).toContain(
      'for (const permission of input.denies) permissions.delete(permission)',
    );
    const effective = read('apps/api/src/staff-assignment/effective-authorization.ts');
    expect(effective).not.toContain('staff_team_memberships');
    expect(effective).not.toContain('staff_departments');
    const assignmentRoutes = read('apps/api/src/staff-assignment/routes.ts');
    expect(assignmentRoutes).not.toContain('/availability');
    expect(assignmentRoutes).not.toContain('/reassign');
    expect(assignmentRoutes).not.toContain('reassignment-batches');
    const fileAuth = read('apps/api/src/files/file-audience-authorization.ts');
    expect(fileAuth).toContain('resolveStaffMarketplaceCodes');
    expect(fileAuth).not.toContain('staff_team_memberships');
    const queue = read('apps/api/src/staff-assignment/read-model.ts');
    expect(queue).toContain("scope.scope_kind='PRIMARY'");
  });

  it('keeps post-confirmation integrity append-only, idempotent, proof-bound and state-gated', () => {
    const route = read('apps/api/src/operating-integrity/routes.ts');
    expect(route).toContain('acquireIdempotency');
    expect(route).toContain('proof_files');
    expect(route).toContain('buyer_advance_principal_entry_files');
    // Guard triggers re-anchored on the stage 3 baseline domain files.
    const guard = read('migrations/0011_review_workflow.sql') + read('migrations/0010_formal_orders.sql');
    expect(guard).toContain('trg_review_approval_requires_normal_order');
    expect(guard).toContain('trg_formal_order_financial_adjustment_profit_only');
    const proof = read('migrations/0012_buyer_refunds_advance.sql');
    expect(proof).toContain('buyer_advance_principal_overpayments');
    expect(proof).toContain('BUYER_REFUND_PROOF');
    const settlement = read('apps/api/src/buyer-refunds/advance-principal-settlement.ts');
    expect(settlement).toContain('Math.min(net,remaining)');
    expect(settlement).toContain('buyer_advance_principal_overpayments');
    const contract = read('packages/contracts/src/operating-integrity.ts');
    expect(contract).not.toContain("'SELLER_PRINCIPAL_DUE'");
    expect(contract).not.toContain("'BUYER_REFUND_DUE'");
  });

  it('retires the acquisition CRM sources entirely (D-056)', () => {
    expect(existsSync(path.join(root, 'apps/api/src/acquisition'))).toBe(false);
    expect(existsSync(path.join(root, 'apps/web/src/staff/acquisition'))).toBe(false);
    expect(existsSync(path.join(root, 'packages/contracts/src/acquisition.ts'))).toBe(false);
  });

  it('keeps real Seller UI, multi-persona session safety and truthful Marketplace-local dates', () => {
    expect(existsSync(path.join(root, 'apps/apps'))).toBe(false);
    const seller = read('apps/web/src/seller/pages/SellerPages.tsx');
    expect(seller).toContain("timeZone: 'Asia/Tokyo'");
    expect(seller).toContain('withdrawApplication');
    expect(seller).toContain('SellerOrderChatScreenshotReadIntentAdapter');
    const sessionGuard = read('migrations/0003_customer_master_data.sql');
    expect(sessionGuard).toContain('trg_customer_persona_privilege_session_bump');
    const market = read('packages/contracts/src/marketplace-runtime.ts');
    expect(market).toContain("business_timezone:'Asia/Tokyo'");
    expect(market).toContain("business_timezone:'America/Los_Angeles'");
    expect(market).toContain("reporting_timezone:'Asia/Shanghai'");
    const dateTruth = read('migrations/0010_formal_orders.sql');
    expect(dateTruth).toContain('trg_formal_order_non_jp_local_date_required');
    expect(dateTruth).toContain('formal_order_marketplace_business_date_required');
  });
});
