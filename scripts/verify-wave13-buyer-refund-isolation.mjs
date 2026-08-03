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
const contract = read('packages/contracts/src/staff-buyer-refund.ts');
const permissions = `${routes}\n${shared}`;
const seller = [
  read('apps/api/src/seller-settlements/seller-routes.ts'),
  read('apps/api/src/seller-portal/routes.ts'),
  read('packages/contracts/src/seller-portal.ts'),
  read('packages/contracts/src/seller-settlement.ts'),
].join('\n');

assertContains(permissions, 'BUYER_REFUND_VIEW', 'Staff Buyer Refund permission');
assertContains(permissions, 'BUYER_REFUND_RECORD', 'Staff Buyer Refund permission');
for (const forbidden of [
  'SELLER_SETTLEMENT_VIEW',
  'SELLER_SETTLEMENT_RECORD',
  'FINANCIAL_VIEW',
]) assertNotContains(permissions, forbidden, 'Staff Buyer Refund permission');
assertContains(payment, "entry_type: 'PAYMENT'", 'Payment append-only fact');
assertContains(reversal, "entry_type: 'REVERSAL'", 'Reversal append-only fact');
assertNotContains(`${payment}\n${reversal}`,
  'UPDATE buyer_refund_payment_entries', 'immutable payment facts');
assertNotContains(`${payment}\n${reversal}`,
  'DELETE FROM buyer_refund_payment_entries', 'immutable payment facts');
assertContains(shared, "return 'OVERPAID';", 'OVERPAID derivation');
assertContains(payment, "row.purpose !== 'BUYER_REFUND_PROOF'", 'proof purpose');
assertContains(payment, "row.visibility !== 'INTERNAL_ONLY'", 'proof visibility');
assertContains(payment, "subjectType: 'STAFF_INTERNAL'", 'proof audience');
assertContains(contract, 'outstanding_amount_cny_fen', 'Staff refund projection');
assertContains(contract, 'overpaid_amount_cny_fen', 'Staff refund projection');
assertContains(contract, 'payments:', 'Staff refund projection');
assertContains(contract, 'proofs:', 'Staff refund projection');
for (const forbidden of [
  'buyer_refund_payment_entries',
  'BUYER_REFUND_PROOF',
  'buyer_refund_internal_note',
  'buyer_refund_payment_entry_files',
]) assertNotContains(seller, forbidden, 'Seller projection');
report('wave13-buyer-refund-isolation', {
  dedicated_permissions: true,
  immutable_payment_facts: true,
  seller_refund_fields: 0,
});
