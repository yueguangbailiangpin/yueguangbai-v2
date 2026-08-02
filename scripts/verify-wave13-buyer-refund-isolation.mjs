import {
  assertContains,
  assertNotContains,
  read,
  report,
} from './wave13-verifier-lib.mjs';

const routes = read('apps/api/src/buyer-refunds/staff-routes.ts');
const payment = read('apps/api/src/buyer-refunds/record-buyer-refund-payment.ts');
const reversal = read('apps/api/src/buyer-refunds/reverse-buyer-refund-payment.ts');
const shared = read('apps/api/src/buyer-refunds/buyer-refund-shared.ts');
const seller = [
  read('apps/api/src/seller-portal/routes.ts'),
  read('apps/api/src/seller-settlements/routes.ts'),
  read('packages/contracts/src/seller-portal.ts'),
  read('packages/contracts/src/seller-settlement.ts'),
].join('\n');

assertContains(routes, 'BUYER_REFUND_VIEW', 'Staff Buyer Refund route');
assertContains(routes, 'BUYER_REFUND_RECORD', 'Staff Buyer Refund route');
for (const forbidden of [
  'SELLER_SETTLEMENT_VIEW',
  'SELLER_SETTLEMENT_RECORD',
  'FINANCIAL_VIEW',
]) assertNotContains(routes, forbidden, 'Staff Buyer Refund route');
assertContains(payment, "entry_type: 'PAYMENT'", 'Payment append-only fact');
assertContains(reversal, "entry_type: 'REVERSAL'", 'Reversal append-only fact');
assertNotContains(`${payment}\n${reversal}`,
  'UPDATE buyer_refund_payment_entries', 'immutable payment facts');
assertNotContains(`${payment}\n${reversal}`,
  'DELETE FROM buyer_refund_payment_entries', 'immutable payment facts');
assertContains(shared, "return 'OVERPAID';", 'OVERPAID derivation');
assertContains(payment, "expectedPurpose: 'BUYER_REFUND_PROOF'", 'proof purpose');
assertContains(payment, "expectedVisibility: 'INTERNAL_ONLY'", 'proof visibility');
assertContains(payment, "audienceType: 'STAFF_INTERNAL'", 'proof audience');
for (const forbidden of [
  'buyer_refund_payment_entries',
  'BUYER_REFUND_PROOF',
  'buyer_refund_internal_note',
]) assertNotContains(seller, forbidden, 'Seller projection');
report('wave13-buyer-refund-isolation', {
  dedicated_permissions: true,
  immutable_payment_facts: true,
  seller_refund_fields: 0,
});
