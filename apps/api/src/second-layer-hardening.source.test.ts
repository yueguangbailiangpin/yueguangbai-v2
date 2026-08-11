import { readFileSync,readdirSync } from 'node:fs';
import path from 'node:path';
import { describe,expect,it } from 'vitest';

const root=path.resolve(import.meta.dirname,'../../..');
const read=(file:string)=>readFileSync(path.join(root,file),'utf8');

describe('second layer hardening freeze',()=>{
  it('keeps production release authority on schema 61, Access and readiness',()=>{
    const migrations=readdirSync(path.join(root,'migrations')).filter((name)=>/^\d{4}_.+\.sql$/u.test(name)).sort();
    expect(migrations).toHaveLength(61);expect(migrations.at(-1)).toBe('0061_post_confirmation_integrity_guards.sql');
    const template=read('apps/api/wrangler.production.template.jsonc');
    expect(template).toContain('"SCHEDULED_OPERATIONS_ENABLED": "true"');expect(template).toContain('"ACQUISITION_MAINTENANCE_ENABLED": "true"');expect(template).toContain('STAFF_ACCESS_TEAM_DOMAIN');expect(template).toContain('STAFF_ACCESS_AUD');expect(template).not.toContain('"STAFF_AUTH_PROVIDER": "FEISHU"');
    const readiness=read('apps/api/src/operational-readiness/routes.ts');expect(readiness).toContain('const TARGET_SCHEMA=61');expect(readiness).toContain("'/ready'");expect(readiness).toContain('production_recovery_attestations');
    const workflow=read('.github/workflows/production-health-monitor.yml');expect(workflow).toContain('https://app.yueguangbai.net/ready');expect(workflow).not.toContain('https://app.yueguangbai.net/health');
  });

  it('keeps Staff authority role-market based without Team file expansion or support queue competition',()=>{
    const migration=read('migrations/0054_access_channel_marketplace_hardening.sql');expect(migration).toContain("effect='GRANT'");expect(migration).toContain('staff_permission_override_active_grant_forbidden');
    const fileAuth=read('apps/api/src/files/file-audience-authorization.ts');expect(fileAuth).toContain('resolveStaffMarketplaceCodes');expect(fileAuth).not.toContain('staff_team_memberships');expect(fileAuth).not.toContain('staff_departments');
    const queue=read('apps/api/src/staff-assignment/read-model.ts');expect(queue).toContain("scope.scope_kind='PRIMARY'");
  });

  it('keeps post-confirmation order/review/refund integrity append-only',()=>{
    const migration=read('migrations/0055_order_review_advance_compensation.sql');expect(migration).toContain('formal_order_operational_events');expect(migration).toContain('formal_order_financial_adjustments');expect(migration).toContain('review_visibility_observations');expect(migration).toContain('buyer_advance_principal_entries');
    const guard=read('migrations/0061_post_confirmation_integrity_guards.sql');expect(guard).toContain('review_visibility_requires_approved_review');expect(guard).toContain('advance_principal_after_refund_obligation_forbidden');
    const settlement=read('apps/api/src/buyer-refunds/advance-principal-settlement.ts');expect(settlement).toContain('buyer_advance_principal_settlements');expect(settlement).toContain("'BUYER_REFUND_PAYMENT_RECORDED'");
    const summary=read('apps/api/src/admin-business-dashboard/frozen-summary.ts');expect(summary).toContain('formal_order_financial_adjustments');
  });

  it('keeps channel labels immutable and v4 acquisition machine scope active',()=>{
    const admin=read('apps/api/src/acquisition/admin.ts');expect(admin).toContain("input.leadType!=='BUYER'&&input.leadType!=='SELLER'");
    const privacy=read('apps/api/src/acquisition/channel-privacy.ts');expect(privacy).not.toContain('staffLabel:');expect(privacy).toContain('intakeWechatLabel');
    const active=read('apps/web/src/staff/acquisition/AcquisitionCoreWorkbench.tsx');expect(active).toContain('AcquisitionCoreWorkbenchV4');
    const machine=read('apps/api/src/acquisition/machine-routes.ts');expect(machine).toContain('authenticateAcquisitionMachine');expect(machine).not.toContain('ACQUISITION_MACHINE_SHARED_SECRET');
    const credential=read('apps/api/src/acquisition/machine-credentials.ts');expect(credential).toContain('acquisition_machine_rate_buckets');expect(credential).toContain('requireMachineScope');
  });

  it('keeps identity, seller membership and marketplace-local date models',()=>{
    expect(read('apps/api/src/customer-onboarding/login-identifier-change-routes.ts')).toContain("status='RELEASED'");
    const sellerMember=read('apps/api/src/seller-portal/member-routes.ts');expect(sellerMember).toContain("['OPERATIONS','FINANCE','VIEWER']");expect(sellerMember).toContain('seller_member_portal_store_grants');
    expect(read('apps/web/src/seller/pages/SellerSettingsV2Page.tsx')).toContain('SellerMemberManagement');
    expect(read('packages/contracts/src/product-reservation-scheduling.ts')).toContain("'Asia/Tokyo'");
    const market=read('packages/contracts/src/marketplace-runtime.ts');expect(market).toContain("business_timezone:'Asia/Tokyo'");expect(market).toContain("reporting_timezone:'Asia/Shanghai'");
    const dates=read('migrations/0060_marketplace_effective_dates.sql');expect(dates).toContain('formal_order_effective_dates');expect(dates).toContain('formal_order_marketplace_business_date_required');
  });
});
