// Stage 4 canonical verifier (D-054 §7 equivalence migration).
// Successor of verify:module1:buyer (verify-module1-buyer-security.mjs). Renamed; the 39-route Buyer loop inventory is unchanged by stage 4.
import { resolveChangeRoot } from './verifier-utils.mjs';
import { assert, assertContains, assertNotContains, read, relative, report, root } from './wave13-verifier-lib.mjs';
import { applyBaseline, baselineSchemaText } from './baseline-schema-helper.mjs';

const changeName = 'module1-buyer-complete-business-loop';

export function resolveModule1ChangeRoot(workspace) {
  return resolveChangeRoot(changeName, workspace);
}

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

// Migration-file assertions originally anchored on 0028 are re-anchored on the
// stage 3 clean baseline's applied schema (D-054): the amazon_order_date
// authority columns, their submission guards and the immutability error text
// must exist in the final baseline state. Chain-number and file-shape
// assertions retired with the legacy chain.
const baselineSchema = baselineSchemaText(applyBaseline());
for (const text of ['amazon_order_date', 'trg_order_evidence_version_submission_guard', 'trg_formal_order_source_guard', "RAISE(ABORT, 'order_evidence_version_submission_mismatch')"]) {
  assertContains(baselineSchema, text, 'baseline schema amazon order date authority');
}
for (const path of [
  'packages/contracts/src/order-evidence.ts',
  'packages/contracts/src/buyer-formal-order-portal.ts',
  'packages/domain/src/time/date-only.ts',
  'apps/api/src/order-evidence/submit-order-evidence.ts',
  'apps/api/src/order-evidence/approve-order-evidence.ts',
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
for (const label of ['产品', '任务', '我的']) assertContains(buyerFrame, label, 'Buyer three-item navigation');
assert((buyerFrame.match(/label:/gu) ?? []).length === 3, 'Buyer navigation must contain exactly three items');
assertNotContains(read('apps/web/src/App.tsx').split('<Route path="/buyer/login"')[0], '/buyer/register', 'root page registration entry');

const sellerCursorAdapter = read(
  'apps/web/src/seller/queries/useSellerCursorPages.ts',
);
for (const marker of [
  "import { useCursorPages } from '../../api/useCursorPages'",
  'items: response.data.items',
  'next_cursor: response.data.page.next_cursor',
]) assertContains(sellerCursorAdapter, marker, 'Seller cursor page adapter');
for (const forbidden of [
  "'/api/", '"/api/', 'fetch(', 'localStorage', 'sessionStorage',
]) {
  assertNotContains(
    sellerCursorAdapter,
    forbidden,
    'Seller cursor page adapter authority boundary',
  );
}
for (const routeModule of [
  'apps/web/src/seller/routes/SellerRouteModule.tsx',
  'apps/web/src/seller/routes/SellerSubmissionRouteModule.tsx',
  'apps/web/src/buyer/routes/BuyerRouteModule.tsx',
  'apps/web/src/buyer/routes/BuyerInstructionRouteModule.tsx',
  'apps/web/src/buyer/routes/BuyerOrderRouteModule.tsx',
  'apps/web/src/buyer/routes/BuyerAfterSalesRouteModule.tsx',
  'apps/web/src/staff/StaffCallbackModule.tsx',
  'apps/web/src/staff/StaffAdminRouteModule.tsx',
  'apps/web/src/staff/StaffAccessManagementRouteModule.tsx',
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
  cross_module_git_diff_allowlist: 'RETIRED_AFTER_INTEGRATION',
});
