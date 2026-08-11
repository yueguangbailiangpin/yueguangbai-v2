import {
  assertContains,
  assertNotContains,
  read,
  report,
} from './wave13-verifier-lib.mjs';

const publicContracts = [
  'packages/contracts/src/staff-auth.ts',
  'packages/contracts/src/file-http.ts',
  'packages/contracts/src/staff-order-evidence.ts',
  'packages/contracts/src/staff-buyer-refund.ts',
].map(read).join('\n');
const responseRoutes = [
  'apps/api/src/staff-auth/access-routes.ts',
  'apps/api/src/files/routes.ts',
  'apps/api/src/order-evidence/staff-routes.ts',
  'apps/api/src/buyer-refunds/staff-routes.ts',
].map(read).join('\n');
const buyerSellerContracts = [
  'packages/contracts/src/buyer-order-evidence-portal.ts',
  'packages/contracts/src/buyer-refund-portal.ts',
  'packages/contracts/src/seller-portal.ts',
  'packages/contracts/src/seller-settlement.ts',
].map(read).join('\n');
const staffRefundContract = read('packages/contracts/src/staff-buyer-refund.ts');
const staffRefundRoutes = read('apps/api/src/buyer-refunds/staff-routes.ts');
const buyerRefundTests = read(
  'apps/api/src/buyer-refund-status/buyer-refund-status.test.ts',
);

for (const forbidden of [
  'token_hash:',
  'state_hash:',
  'app_secret:',
  'provider_access_token:',
  'object_key:',
  'permanent_url:',
  'signed_url:',
]) assertNotContains(publicContracts, forbidden, 'public contracts');
for (const forbidden of [
  'object_key',
  'permanent_url',
  'provider_access_token',
  'app_secret',
]) assertNotContains(responseRoutes, forbidden, 'HTTP response routes');
for (const forbidden of [
  'price_mismatch_reason',
  'internal_review_note',
  'BUYER_REFUND_PROOF',
  'buyer_refund_payment_entries',
]) assertNotContains(buyerSellerContracts, forbidden, 'Buyer/Seller contracts');

const securityEvents = read('apps/api/src/staff-auth/repository.ts');
for (const forbiddenMetadata of [
  'code: input.',
  'state: input.',
  'token: input.',
  'access_token: input.',
  'object_key: input.',
]) assertNotContains(securityEvents, forbiddenMetadata, 'security event metadata');
assertContains(staffRefundContract, 'internal_note: string | null',
  'Staff-only refund notes');
assertContains(staffRefundRoutes,
  'payment_channel, public_note, internal_note',
  'Staff-only refund Payment query');
assertContains(staffRefundRoutes,
  'public_note, internal_note',
  'Staff-only refund Reversal query');
assertContains(buyerRefundTests, 'internal_note|recorded_by_staff',
  'Buyer refund DTO isolation tests');

report('wave13-secret-dto-leakage', {
  public_contract_files: 4,
  response_route_files: 4,
  buyer_seller_contract_files: 4,
  staff_internal_notes: true,
});
