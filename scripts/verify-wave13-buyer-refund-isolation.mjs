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
const tests = read(
  'apps/api/src/buyer-refunds/wave13-staff-buyer-refund.test.ts',
);
const ledgerTests = read(
  'apps/api/src/buyer-refunds/buyer-refund-ledger.test.ts',
);
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
for (const field of [
  'from?: string',
  'to?: string',
  'gross_paid_cny_fen: string',
  'reversed_cny_fen: string',
  'created_at: number',
  'updated_at: number',
  'workflow: StaffBuyerRefundWorkflowDto',
  'china_business_date: string',
  'internal_note: string | null',
]) assertContains(contract, field, 'Staff refund contract');
for (const evidence of [
  'chinaBusinessDateStartEpoch',
  'parseChinaBusinessDate',
  "'AND ledger.created_at>=?'",
  "'AND ledger.created_at<?'",
  "new Set(['limit', 'status', 'cursor', 'from', 'to'])",
  "body['china_business_date']",
  'submittedBusinessDate !== chinaBusinessDate(paidAt)',
  'payment_channel, public_note, internal_note',
]) assertContains(routes, evidence, 'Staff refund route');
assertContains(payment, 'china_business_date: chinaBusinessDate',
  'Payment canonical request hash');
for (const evidence of [
  'applies strict inclusive China-date list filters before pagination',
  'rejects ambiguous refund list dates and invalid payment business dates',
  "internal_note: 'Staff-only payment note'",
  "internal_note: 'Staff-only reversal note'",
]) assertContains(tests, evidence, 'Staff refund runtime tests');
assertContains(ledgerTests, "chinaBusinessDate: '2026-08-02'",
  'Payment idempotency date conflict test');
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
  china_date_filters: true,
});
