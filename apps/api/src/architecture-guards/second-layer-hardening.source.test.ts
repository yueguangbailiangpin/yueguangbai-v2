import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../../../..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

describe('second layer hardening freeze', () => {
  it('keeps production release authority on schema 72, Access and release-bound readiness', () => {
    const migrations = readdirSync(path.join(root, 'migrations'))
      .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
      .sort();
    expect(migrations).toHaveLength(72);
    expect(migrations.at(-1)).toBe('0072_unified_order_day_rate_center.sql');
    const template = read('apps/api/wrangler.production.template.jsonc');
    expect(template).toContain('"APP_RELEASE_SHA": "REQUIRED_RELEASE_COMMIT_SHA"');
    expect(template).toContain('"SCHEDULED_OPERATIONS_ENABLED": "true"');
    expect(template).toContain('"ACQUISITION_MAINTENANCE_ENABLED": "true"');
    expect(template).toContain('STAFF_ACCESS_TEAM_DOMAIN');
    expect(template).toContain('STAFF_ACCESS_AUD');
    expect(template).not.toContain('FEISHU_WORKBENCH_APP_ID');
    const readiness = read('apps/api/src/operational-readiness/routes.ts');
    expect(readiness).toContain('const TARGET_SCHEMA = 72');
    expect(readiness).toContain('APP_RELEASE_SHA');
    expect(readiness).toContain('last_backlog_count');
    expect(readiness).toContain('staff_access');
    const verifier = read('scripts/verify-production-readiness-formal.mjs');
    expect(verifier).toContain('external_calls:0');
    expect(verifier).not.toContain('fetchImpl');
    expect(read('scripts/probe-production-readiness.mjs')).toContain('fetchImpl=fetch');
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
    const guard = read('migrations/0062_runtime_authority_and_privilege_guards.sql');
    expect(guard).toContain('trg_review_approval_requires_normal_order');
    expect(guard).toContain('trg_formal_order_financial_adjustment_profit_only');
    const proof = read('migrations/0063_advance_principal_proof_and_overpayment.sql');
    expect(proof).toContain('buyer_advance_principal_overpayments');
    expect(proof).toContain('BUYER_REFUND_PROOF');
    const settlement = read('apps/api/src/buyer-refunds/advance-principal-settlement.ts');
    expect(settlement).toContain('Math.min(net,remaining)');
    expect(settlement).toContain('buyer_advance_principal_overpayments');
    const contract = read('packages/contracts/src/operating-integrity.ts');
    expect(contract).not.toContain("'SELLER_PRINCIPAL_DUE'");
    expect(contract).not.toContain("'BUYER_REFUND_DUE'");
  });

  it('keeps channel labels immutable and v4 acquisition machine scope active', () => {
    const admin = read('apps/api/src/acquisition/admin.ts');
    expect(admin).toContain("input.leadType !== 'BUYER' && input.leadType !== 'SELLER'");
    const privacy = read('apps/api/src/acquisition/channel-privacy.ts');
    expect(privacy).not.toContain('staffLabel:');
    expect(privacy).toContain('intakeWechatLabel');
    expect(read('apps/web/src/staff/acquisition/AcquisitionCoreWorkbench.tsx')).toContain(
      'function AcquisitionCoreWorkbench',
    );
    const machine = read('apps/api/src/acquisition/machine-routes.ts');
    expect(machine).toContain('authenticateAcquisitionMachine');
    expect(machine).not.toContain('ACQUISITION_MACHINE_SHARED_SECRET');
    const credential = read('apps/api/src/acquisition/machine-credentials.ts');
    expect(credential).toContain('acquisition_machine_rate_buckets');
    expect(credential).toContain('requireMachineScope');
  });

  it('keeps real Seller UI, multi-persona session safety and truthful Marketplace-local dates', () => {
    expect(existsSync(path.join(root, 'apps/apps'))).toBe(false);
    const seller = read('apps/web/src/seller/pages/SellerPages.tsx');
    expect(seller).toContain("timeZone: 'Asia/Tokyo'");
    expect(seller).toContain('withdrawApplication');
    expect(seller).toContain('SellerOrderChatScreenshotReadIntentAdapter');
    const sessionGuard = read('migrations/0062_runtime_authority_and_privilege_guards.sql');
    expect(sessionGuard).toContain('trg_customer_persona_privilege_session_bump');
    const market = read('packages/contracts/src/marketplace-runtime.ts');
    expect(market).toContain("business_timezone:'Asia/Tokyo'");
    expect(market).toContain("business_timezone:'America/Los_Angeles'");
    expect(market).toContain("reporting_timezone:'Asia/Shanghai'");
    const dateTruth = read('migrations/0064_marketplace_local_date_truth.sql');
    expect(dateTruth).toContain("canonical_marketplace_code='AMAZON_US'");
    expect(dateTruth).toContain('ELSE NULL');
  });
});
