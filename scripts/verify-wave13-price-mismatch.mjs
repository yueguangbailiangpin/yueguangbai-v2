import {
  assertContains,
  assertNotContains,
  read,
  report,
} from './wave13-verifier-lib.mjs';

const errors = read('packages/contracts/src/errors.ts');
const contracts = read('packages/contracts/src/staff-order-evidence.ts');
const approval = read('apps/api/src/order-evidence/approve-order-evidence.ts');
const routes = read('apps/api/src/order-evidence/staff-routes.ts');
const buyer = [
  read('packages/contracts/src/buyer-order-evidence-portal.ts'),
  read('apps/api/src/buyer-order-evidence-portal/routes.ts'),
].join('\n');
const permissions = read('packages/contracts/src/staff.ts');

assertContains(errors, "'PRICE_MISMATCH'", 'error catalog');
assertContains(errors, 'PRICE_MISMATCH: 409', 'HTTP mapping');
assertContains(contracts, 'price_mismatch_acknowledged?: boolean', 'approve contract');
assertContains(contracts, 'price_mismatch_reason?: string', 'approve contract');
assertContains(routes, 'price_mismatch_acknowledged', 'route body');
assertContains(routes, 'price_mismatch_reason', 'route body');
assertContains(approval, 'price_mismatch_acknowledged: acknowledged ?? null', 'request hash');
assertContains(approval, 'price_mismatch_reason: normalizedReason', 'request hash');
assertContains(approval, "throw new AtomicOrderEvidenceApprovalError('PRICE_MISMATCH', 409)",
  'mismatch conflict');
for (const field of [
  'reference_order_amount_jpy',
  'final_paid_jpy',
  'price_difference_jpy',
  'price_mismatch_acknowledged',
  'price_mismatch_reason',
  'confirmed_by_staff_id',
]) assertContains(approval, field, 'Audit/Formal Order metadata');
assertNotContains(buyer, 'price_mismatch_reason', 'Buyer DTO');
assertNotContains(buyer, 'internal_review_note', 'Buyer DTO');
assertNotContains(permissions, 'PRICE_MISMATCH', 'permission catalog');
assertContains(approval, 'finalPaidJpy: source.final_paid_jpy', 'financial snapshot');
assertNotContains(approval,
  'finalPaidJpy: source.reference_order_amount_jpy',
  'financial snapshot');
report('wave13-price-mismatch', {
  error_status: 409,
  new_permissions: 0,
  buyer_reason_fields: 0,
});
