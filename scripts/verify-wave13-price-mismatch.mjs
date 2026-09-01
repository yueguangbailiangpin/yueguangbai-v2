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
const tests = read(
  'apps/api/src/order-evidence/wave13-staff-order-evidence.test.ts',
);

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
for (const field of [
  'reference_order_amount_jpy: string',
  'price_difference_jpy: string',
  'price_mismatch: boolean',
  'resubmission_deadline_at: number | null',
  'workflow: StaffOrderEvidenceWorkflowDto',
  'buyer: StaffOrderEvidenceBuyerSummaryDto',
]) assertContains(contracts, field, 'Staff Order Evidence list contract');
for (const evidence of [
  'evidence.reference_order_amount_jpy_snapshot',
  'submission.resubmission_deadline_at',
  "work.work_type='ORDER_EVIDENCE_REVIEW'",
  'screenshot_association_count',
  'eligible_screenshot_association_count',
  "new StaffOrderEvidenceHttpError('STATE_CONFLICT', 409)",
]) assertContains(routes, evidence, 'Staff Order Evidence route');
for (const evidence of [
  'returns the complete Staff-safe review queue DTO at runtime',
  'rejects a tampered local D1 %s current screenshot association',
  'returns one safe screenshot for a valid local D1 association',
  // D-056 §4.2: the multiple case is enforced by UNIQUE(version_id) at the
  // database layer; the divergent-pointer mismatch case is structurally gone.
  "['zero']",
  "rejects a second payment screenshot at the database layer",
  'seedDetailInvariantFixture',
]) assertContains(tests, evidence, 'Staff Order Evidence runtime tests');
report('wave13-price-mismatch', {
  error_status: 409,
  new_permissions: 0,
  buyer_reason_fields: 0,
  detail_screenshot_associations: 1,
});
