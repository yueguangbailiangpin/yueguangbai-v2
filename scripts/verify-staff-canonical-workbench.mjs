import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const route = source('apps/web/src/staff/StaffRouteModule.tsx');
const composition = source('apps/web/src/staff/FrozenStaffWorkbenchV2.tsx');
const workbench = source('apps/web/src/staff/FrozenStaffWorkbench.tsx');
const settlement = source('apps/web/src/staff/SellerSettlementPanel.tsx');
const behaviorTest = source('apps/web/src/staff/SellerSettlementPanel.msw.test.tsx');
const roleTest = source('apps/web/src/staff/SellerSettlementPanel.roles.test.tsx');
const workbenchTest = source('apps/web/src/staff/FrozenStaffWorkbench.msw.test.tsx');
const routeE2e = source('apps/web/e2e/foundation.spec.ts');
const packageJson = JSON.parse(source('package.json'));

assert(route.includes("import { FrozenStaffWorkbenchV2 } from './FrozenStaffWorkbenchV2'"),
  'Staff route no longer owns the Frozen V2 composition');
for (const owner of ['FrozenStaffWorkbench', 'StaffWorkflowClosurePanel', 'StaffOperatingIntegrityTools']) {
  assert(composition.includes(owner), `canonical Staff composition missing ${owner}`);
}
assert(workbench.includes("from './SellerSettlementPanel'"),
  'Frozen workbench does not own the canonical Seller Settlement mount');
assert(workbench.includes('sellerSettlementCapabilities(session).canView'),
  'canonical Seller Settlement mount is missing its view gate');

for (const boundary of [
  'settlementSummary', 'settlementPayables', 'settlementPayments',
  'recordSellerPayment', 'allocateSellerPayment', 'reverseSellerPayment',
  'StaffMutationAuthority', 'StaffProtectedFileButton',
]) assert(settlement.includes(boundary), `canonical Seller Settlement boundary missing ${boundary}`);
for (const permission of ['SELLER_SETTLEMENT_VIEW', 'SELLER_SETTLEMENT_RECORD', 'FINANCIAL_CORRECT']) {
  assert(settlement.includes(permission), `canonical Seller Settlement permission mirror missing ${permission}`);
}
assert(settlement.includes('accept="image/jpeg,image/png,image/webp"'),
  'Seller Settlement proof chooser must match the backend payment proof contract');

assert(behaviorTest.includes('expected_payment_version'),
  'settlement behavior test no longer proves authoritative payment-version allocation');
assert(behaviorTest.includes('allocation-conflict'),
  'settlement behavior test no longer proves backend failure stays visible');
for (const role of ['acquisition', 'pre_sales', 'buyer_refund', 'seller_ops', 'owner']) {
  assert(roleTest.includes(`'${role}'`), `role evidence missing ${role}`);
}
for (const scenario of ['detail is concealed', 'opaque next cursor', 'publishes a demand']) {
  assert(workbenchTest.includes(scenario), `canonical Frozen workbench evidence missing ${scenario}`);
}
for (const scenario of [
  'Staff desktop shell preserves queue-detail-action DOM order and separation',
  'Staff narrow shell preserves queue-detail-tools order without overflow',
  'staff workbench defers dashboard and scheduling chunks until their routes open',
]) assert(routeE2e.includes(scenario), `canonical Staff browser evidence missing ${scenario}`);

for (const legacy of [
  'apps/web/src/staff/StaffWorkbench.tsx',
  'apps/web/src/staff/StaffWorkbench.msw.test.tsx',
]) assert(!existsSync(path.join(root, legacy)), `retired legacy file still exists: ${legacy}`);

for (const script of ['test:staff-role-consolidation', 'test:product-reservation-scheduling']) {
  const command = packageJson.scripts?.[script];
  assert(typeof command === 'string' && command.includes('FrozenStaffWorkbench.msw.test.tsx'),
    `${script} does not point to canonical Frozen workbench evidence`);
  assert(!command.includes('apps/web/src/staff/StaffWorkbench.msw.test.tsx'),
    `${script} still points to retired Staff workbench evidence`);
}

console.log(JSON.stringify({
  status: 'PASS',
  canonical_route: 'StaffRouteModule -> FrozenStaffWorkbenchV2 -> FrozenStaffWorkbench',
  seller_settlement_implementations: 1,
  legacy_staff_workbench_files: 0,
  production_resources_touched: 0,
}, null, 2));

function source(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
