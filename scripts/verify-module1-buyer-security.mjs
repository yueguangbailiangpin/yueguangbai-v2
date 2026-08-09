import { execFileSync } from 'node:child_process';
import { lstatSync, mkdtempSync, mkdirSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assert, assertContains, assertNotContains, read, relative, report, root } from './wave13-verifier-lib.mjs';

const changeName = 'module1-buyer-complete-business-loop';

export function resolveModule1ChangeRoot(workspace) {
  const activeRoot = join(workspace, 'openspec/changes', changeName);
  const archiveRoot = join(workspace, 'openspec/changes/archive');
  const requireDirectory = (path, label) => {
    const stats = lstatSync(path, { throwIfNoEntry: false });
    if (!stats) return false;
    if (stats.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link: ${path}`);
    if (!stats.isDirectory()) throw new Error(`${label} must be an ordinary directory: ${path}`);
    return true;
  };
  const activeExists = requireDirectory(activeRoot, 'Module 1 active change');
  if (!requireDirectory(archiveRoot, 'OpenSpec archive')) throw new Error('OpenSpec archive directory missing');
  const archivePattern = new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${changeName}$`, 'u');
  const archivedRoots = readdirSync(archiveRoot).filter((entry) => archivePattern.test(entry)).map((entry) => join(archiveRoot, entry));
  for (const path of archivedRoots) requireDirectory(path, 'Module 1 archived change');
  if (archivedRoots.length > 1) throw new Error('Multiple Module 1 archived changes found');
  if (activeExists && archivedRoots.length === 1) throw new Error('Module 1 active and archived changes must not coexist');
  if (activeExists) return activeRoot;
  if (archivedRoots.length === 1) return archivedRoots[0];
  throw new Error('Module 1 active or archived change directory not found');
}

function selfTestResolver() {
  const scenario = (setup, succeeds) => {
    const workspace = mkdtempSync(join(tmpdir(), 'module1-change-root-'));
    try {
      mkdirSync(join(workspace, 'openspec/changes/archive'), { recursive: true });
      setup(workspace);
      if (succeeds) resolveModule1ChangeRoot(workspace);
      else assertThrows(() => resolveModule1ChangeRoot(workspace));
    } finally { rmSync(workspace, { recursive: true, force: true }); }
  };
  scenario((workspace) => mkdirSync(join(workspace, 'openspec/changes', changeName)), true);
  scenario((workspace) => mkdirSync(join(workspace, 'openspec/changes/archive', `2026-08-06-${changeName}`)), true);
  scenario((workspace) => { mkdirSync(join(workspace, 'openspec/changes', changeName)); mkdirSync(join(workspace, 'openspec/changes/archive', `2026-08-06-${changeName}`)); }, false);
  scenario((workspace) => { mkdirSync(join(workspace, 'openspec/changes/archive', `2026-08-06-${changeName}`)); mkdirSync(join(workspace, 'openspec/changes/archive', `2026-08-07-${changeName}`)); }, false);
  scenario((workspace) => { const target = join(workspace, 'target'); mkdirSync(target); symlinkSync(target, join(workspace, 'openspec/changes', changeName)); }, false);
  scenario(() => {}, false);
}

function assertThrows(operation) {
  let threw = false;
  try { operation(); } catch { threw = true; }
  assert(threw, 'Module 1 change-root resolver must fail deterministically');
}

selfTestResolver();
const change = relative(resolveModule1ChangeRoot(root));

const expected = Object.freeze([
  ['POST', '/api/buyer-auth/register'],
  ['POST', '/api/customer-auth/login'],
  ['POST', '/api/customer-auth/change-password'],
  ['POST', '/api/customer-auth/logout'],
  ['GET', '/api/customer-auth/session'],
  ['GET', '/api/buyer-portal/me'],
  ['GET', '/api/buyer-portal/demands'],
  ['GET', '/api/buyer-portal/demands/:id'],
  ['POST', '/api/buyer-portal/demands/:id/reservations'],
  ['GET', '/api/buyer-portal/reservations'],
  ['GET', '/api/buyer-portal/reservations/:id'],
  ['POST', '/api/buyer-portal/reservations/:id/cancel'],
  ['GET', '/api/buyer-portal/reservations/:id/order-instruction'],
  ['GET', '/api/buyer-portal/reservations/:id/order-instruction/state'],
  ['POST', '/api/buyer-portal/reservations/:id/order-instruction/images/:position/read-intent'],
  ['GET', '/api/buyer-portal/order-evidence/eligible-reservations'],
  ['POST', '/api/buyer-portal/order-evidence'],
  ['GET', '/api/buyer-portal/order-evidence'],
  ['GET', '/api/buyer-portal/order-evidence/:id'],
  ['POST', '/api/buyer-portal/order-evidence/:id/resubmit'],
  ['POST', '/api/buyer-portal/order-evidence/:id/withdraw'],
  ['GET', '/api/buyer-portal/formal-orders'],
  ['GET', '/api/buyer-portal/formal-orders/:id'],
  ['GET', '/api/buyer-portal/reviews/eligible-orders'],
  ['POST', '/api/buyer-portal/reviews'],
  ['GET', '/api/buyer-portal/reviews'],
  ['GET', '/api/buyer-portal/reviews/:id'],
  ['POST', '/api/buyer-portal/reviews/:id/resubmit'],
  ['POST', '/api/buyer-portal/reviews/:id/withdraw'],
  ['POST', '/api/buyer-portal/reviews/:id/files/:fileLinkId/read-intent'],
  ['GET', '/api/buyer-portal/refunds'],
  ['GET', '/api/buyer-portal/refunds/:id'],
  ['POST', '/api/buyer-portal/file-uploads/order-evidence/intents'],
  ['POST', '/api/buyer-portal/file-uploads/review-evidence/intents'],
  ['PUT', '/api/buyer-portal/file-uploads/:fileObjectId/content'],
  ['POST', '/api/buyer-portal/file-upload-intents/:id/complete'],
  ['POST', '/api/buyer-portal/files/:fileObjectId/read-intents'],
  ['GET', '/api/buyer-portal/file-read-intents/:id/content'],
  ['POST', '/api/buyer-portal/order-evidence/:id/files/:fileLinkId/read-intent'],
]);
assert(expected.length === 39, 'Buyer target route inventory must contain 39 entries');
assert(new Set(expected.map(([method, path]) => `${method} ${path}`)).size === 39, 'Buyer route inventory contains duplicates');

const inventory = read(`${change}/references/buyer-api-contract-inventory.md`);
for (const [, path] of expected) assertContains(inventory, `\`${path}\``, 'frozen Buyer API inventory');
const routeSources = [
  'packages/contracts/src/buyer-self-registration.ts',
  'apps/api/src/http-auth/routes.ts',
  'apps/api/src/buyer-portal/routes.ts',
  'apps/api/src/order-instructions/routes.ts',
  'apps/api/src/buyer-order-evidence-portal/routes.ts',
  'apps/api/src/buyer-formal-orders/routes.ts',
  'apps/api/src/buyer-reviews/routes.ts',
  'apps/api/src/buyer-refund-status/routes.ts',
  'packages/contracts/src/file-http.ts',
].map(read).join('\n');
for (const [, path] of expected) {
  assertContains(
    routeSources,
    path === '/api/customer-auth/login' ? '/api/customer-auth/buyer/login' : path,
    'registered Buyer route source',
  );
}

const buyerWeb = [
  read('apps/web/src/App.tsx'), read('apps/web/src/config/runtime-config.ts'),
  read('apps/web/src/files/file-read-providers.ts'),
  ...['api/client.ts', 'contracts/runtime.ts', 'routes/BuyerFrame.tsx', 'routes/BuyerLayout.tsx',
    'routes/BuyerRouteModule.tsx', 'routes/BuyerOrderRouteModule.tsx', 'routes/BuyerAfterSalesRouteModule.tsx',
    'order-evidence/BuyerOrderEvidenceFormPage.tsx', 'reviews/BuyerReviewFormPage.tsx']
    .map((path) => read(`apps/web/src/buyer/${path}`)),
].join('\n');
assertNotContains(buyerWeb, '/api/v2', 'Buyer frontend');
assertNotContains(buyerWeb, 'object_key', 'Buyer DTO/UI');
assertNotContains(buyerWeb, 'permanent_url', 'Buyer DTO/UI');
assert(!/(?:localStorage|sessionStorage)\.(?:setItem|getItem)\([^\n]*(?:token|access)/iu.test(buyerWeb), 'Buyer token storage is forbidden');
assertNotContains(read('apps/web/src/files/file-read-providers.ts'), 'read_intent_path', 'fixed file read providers');
assertContains(read('apps/web/src/api/query-client.ts'), 'mutations: { retry: false }', 'mutation retry policy');

const migration = read('migrations/0028_buyer_amazon_order_date.sql');
for (const text of ['amazon_order_date', 'trg_order_evidence_version_submission_guard', 'trg_formal_order_source_guard', "RAISE(ABORT, 'order_evidence_version_submission_mismatch')"]) {
  assertContains(migration, text, 'Migration 0028');
}
assert(!/UPDATE\s+(?:order_evidence_versions|formal_orders)\s+SET\s+amazon_order_date/iu.test(migration), 'historical dates must not be backfilled');
assertNotContains(migration, 'CREATE INDEX', 'Migration 0028');
for (const path of [
  'packages/contracts/src/order-evidence.ts',
  'packages/contracts/src/buyer-formal-order-portal.ts',
  'packages/domain/src/time/date-only.ts',
  'apps/api/src/order-evidence/submit-order-evidence.ts',
  'apps/api/src/formal-orders/confirm-formal-order.ts',
  'apps/api/src/buyer-order-evidence-portal/read-model.ts',
  'apps/web/src/buyer/contracts/runtime.ts',
]) {
  const source = read(path);
  assert(path.endsWith('date-only.ts') ? source.includes('parseGregorianDateOnly') : source.includes('amazon_order_date'), `${path} date authority`);
}

const evidenceForm = read('apps/web/src/buyer/order-evidence/BuyerOrderEvidenceFormPage.tsx');
assertContains(evidenceForm, "uploader.start('buyerOrderEvidence', [selected.current])", 'exact-one evidence upload');
assert(!/name="evidence_file"[^>]*\bmultiple\b/u.test(evidenceForm), 'order evidence input must not allow multiple files');
const reviewForm = read('apps/web/src/buyer/reviews/BuyerReviewFormPage.tsx');
assertContains(reviewForm, 'files.current.length > 3', 'review three-file command limit');
const buyerFrame = read('apps/web/src/buyer/routes/BuyerFrame.tsx');
for (const label of ['首页', '产品', '订单资料', '评论', '我的']) assertContains(buyerFrame, label, 'Buyer five-item navigation');
assert((buyerFrame.match(/label:/gu) ?? []).length === 5, 'Buyer navigation must contain exactly five items');
assertNotContains(read('apps/web/src/App.tsx').split('<Route path="/buyer/login"')[0], '/buyer/register', 'root page registration entry');

const sellerStaffScopes = [
  'apps/api/src/seller-portal', 'apps/api/src/staff-auth', 'apps/web/src/seller', 'apps/web/src/staff',
];
const trackedSellerStaff = execFileSync('git', [
  'diff', '--name-only', 'origin/main', '--', ...sellerStaffScopes,
], { encoding: 'utf8' }).trim().split('\n');
const untrackedSellerStaff = execFileSync('git', [
  'ls-files', '--others', '--exclude-standard', '--', ...sellerStaffScopes,
], { encoding: 'utf8' }).trim().split('\n');
const changedSellerStaff = [...new Set([...trackedSellerStaff, ...untrackedSellerStaff])]
  .filter((path) => path.length > 0 && !path.includes('.test.'));
const module4SellerAllowlist = new Set([
  'apps/api/src/staff-auth/cleanup.ts',
  'apps/api/src/staff-auth/repository.ts',
  'apps/api/src/staff-auth/routes.ts',
  'apps/api/src/seller-portal/queries.ts',
  'apps/api/src/seller-portal/routes.ts',
  'apps/web/src/seller/api/client.ts',
  'apps/web/src/seller/contracts/runtime.ts',
  'apps/web/src/seller/pages/SellerPages.tsx',
  'apps/web/src/seller/pages/SellerSubmissionPages.tsx',
  'apps/web/src/seller/queries/keys.ts',
  'apps/web/src/seller/routes/SellerLayout.tsx',
  'apps/web/src/seller/routes/SellerRouteModule.tsx',
  'apps/web/src/seller/routes/SellerSubmissionRouteModule.tsx',
  'apps/web/src/staff/StaffWorkbench.tsx',
  'apps/web/src/staff/StaffCallbackModule.tsx',
  'apps/web/src/staff/StaffAdminRouteModule.tsx',
  'apps/web/src/staff/StaffRouteModule.tsx',
  'apps/web/src/staff/StaffSchedulingRouteModule.tsx',
  'apps/web/src/staff/StaffShell.tsx',
  'apps/web/src/staff/admin-dashboard/AdminBusinessDashboard.tsx',
  'apps/web/src/staff/acquisition/AcquisitionWorkbench.tsx',
  'apps/web/src/staff/api/client.ts',
  'apps/web/src/staff/contracts/runtime.ts',
  'apps/web/src/staff/mutations/StaffMutationAuthority.ts',
  'apps/web/src/staff/product-scheduling/ProductSchedulingWorkspace.tsx',
  'apps/web/src/staff/queries/keys.ts',
  'apps/web/src/staff/shared/StaffProtectedFileButton.tsx',
  'apps/web/src/staff/shared/format.ts',
]);
const unapprovedSellerStaff = changedSellerStaff.filter((path) => !module4SellerAllowlist.has(path));
assert(unapprovedSellerStaff.length === 0, `Unapproved Seller/Staff business source expanded: ${unapprovedSellerStaff.join(', ')}`);
for (const routeModule of [
  'apps/web/src/seller/routes/SellerRouteModule.tsx',
  'apps/web/src/seller/routes/SellerSubmissionRouteModule.tsx',
  'apps/web/src/buyer/routes/BuyerRouteModule.tsx',
  'apps/web/src/buyer/routes/BuyerInstructionRouteModule.tsx',
  'apps/web/src/buyer/routes/BuyerOrderRouteModule.tsx',
  'apps/web/src/buyer/routes/BuyerAfterSalesRouteModule.tsx',
  'apps/web/src/staff/StaffCallbackModule.tsx',
  'apps/web/src/staff/StaffAdminRouteModule.tsx',
  'apps/web/src/staff/StaffRouteModule.tsx',
  'apps/web/src/staff/StaffSchedulingRouteModule.tsx',
  'apps/web/src/staff/StaffShell.tsx',
]) {
  const source = read(routeModule);
  assertNotContains(source, '/api/', `${routeModule} must not expand an API contract`);
  assertNotContains(source, 'fetch(', `${routeModule} must remain a UI composition module`);
}
const taskSource = read(`${change}/tasks.md`);
assertContains(taskSource, 'COMPLETE=58', 'formal requirement evidence');
assertContains(taskSource, 'Scenarios=116/116', 'formal scenario evidence');

report('module1-buyer-security', {
  buyer_api_baseline: 38,
  buyer_api_target: 39,
  new_api_count: 1,
  arbitrary_read_paths: 0,
  token_storage: 0,
  approved_seller_business_files: changedSellerStaff.length,
  unapproved_seller_staff_business_expansion: unapprovedSellerStaff.length,
});
