import {
  assert,
  assertContains,
  assertNotContains,
  read,
  report,
} from './wave13-verifier-lib.mjs';

const contract = read('packages/contracts/src/file-http.ts');
const globalPurposes = read('packages/contracts/src/file-storage.ts');
const routes = read('apps/api/src/files/routes.ts');
const authorization = read('apps/api/src/files/route-authorization.ts');
const errors = read('packages/contracts/src/errors.ts');
const app = read('apps/api/src/index.ts');
const inventoryTests = read('apps/api/src/wave13-default-app-security.test.ts');

for (const purpose of [
  'ORDER_EVIDENCE',
  'REVIEW_EVIDENCE',
  'PRODUCT_APPLICATION_IMAGE',
  'BUYER_REFUND_PROOF',
  'SELLER_SETTLEMENT_PROOF',
]) assertContains(contract, purpose, 'active File HTTP purpose contract');
assertContains(
  globalPurposes,
  'ORDER_EVIDENCE_INTERNAL_COMMUNICATION',
  'historical global FilePurpose',
);
assertNotContains(
  routes,
  'staffOrderEvidenceInternalCommunication',
  'Wave 13 active route registration',
);
assertNotContains(
  routes,
  "['ORDER_EVIDENCE_INTERNAL_COMMUNICATION', 'INTERNAL_ONLY']",
  'Wave 13 Staff upload mapping',
);
assertNotContains(
  contract,
  '/api/staff/file-uploads/order-evidence-internal-communication/intents',
  'Wave 13 File HTTP path contract',
);
for (const authorityField of [
  'purpose?:', 'visibility?:', 'owner_id:', 'staff_id:',
  'buyer_id:', 'seller_id:', 'object_key:', 'permanent_url:',
]) assertNotContains(contract, authorityField, 'File HTTP request contract');
for (const path of [
  '/api/buyer-portal/file-uploads/:fileObjectId/content',
  '/api/seller-portal/file-uploads/:fileObjectId/content',
  '/api/staff/file-uploads/:fileObjectId/content',
  '/api/buyer-portal/file-upload-intents/:id/complete',
  '/api/seller-portal/file-upload-intents/:id/complete',
  '/api/staff/file-upload-intents/:id/complete',
]) assertContains(contract, path, 'concrete lifecycle path');
assertNotContains(routes, '{buyer-portal|seller-portal|staff}', 'routes');
assertNotContains(routes, '/links', 'generic Link route');
assertNotContains(routes, '/grants', 'generic Grant route');
assertContains(authorization, 'assertCanLink(): never', 'route authorization');
assertContains(errors, "'FILE_COMPENSATION_REQUIRED'", 'error catalog');
assertContains(routes, "keys.length !== 1 || keys[0] !== 'file'", 'multipart parser');
assert(!/context\.json\([\s\S]{0,300}object_key/u.test(routes),
  'File route response exposes object_key');
assertContains(app, "app.use('/api/staff/*', staffSessionMiddleware())",
  'Staff middleware');
for (const evidence of [
  'businessMethods',
  'duplicateRegistrations',
  'FILE_HTTP_PURPOSE_ROUTES',
  'FILE_HTTP_LIFECYCLE_PATHS',
  'staffMiddlewareIndex',
  'toHaveLength(151)',
]) assertContains(inventoryTests, evidence, 'real Hono route inventory test');
report('wave13-file-architecture', {
  active_purpose_routes: 5,
  deferred_to_wave15: ['ORDER_EVIDENCE_INTERNAL_COMMUNICATION'],
  generic_link_routes: 0,
  generic_grant_routes: 0,
  r2_authority_fields: 0,
  active_route_inventory: 151,
});
