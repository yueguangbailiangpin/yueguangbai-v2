import {
  assert,
  assertContains,
  assertNotContains,
  read,
  report,
} from './wave13-verifier-lib.mjs';

const contract = read('packages/contracts/src/file-http.ts');
const routes = read('apps/api/src/files/routes.ts');
const authorization = read('apps/api/src/files/route-authorization.ts');
const errors = read('packages/contracts/src/errors.ts');

for (const purpose of [
  'ORDER_EVIDENCE',
  'REVIEW_EVIDENCE',
  'PRODUCT_APPLICATION_IMAGE',
  'ORDER_EVIDENCE_INTERNAL_COMMUNICATION',
  'BUYER_REFUND_PROOF',
  'SELLER_SETTLEMENT_PROOF',
]) assertContains(contract, purpose, 'File HTTP purpose contract');
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
report('wave13-file-architecture', {
  purpose_routes: 6,
  generic_link_routes: 0,
  generic_grant_routes: 0,
  r2_authority_fields: 0,
});
