import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');
const fail = (message) => { throw new Error(`Phase3H verification failed: ${message}`); };
const requireIncludes = (text, values, label) => {
  for (const value of values) if (!text.includes(value)) fail(`${label} missing ${value}`);
};

const migrationFiles = readdirSync(path.join(root, 'migrations'))
  .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name)).sort();
if (migrationFiles.at(-1) !== '0020_staff_assignment_rules.sql') {
  fail(`last migration is ${migrationFiles.at(-1)}`);
}
if (migrationFiles.some((name) => Number(name.slice(0, 4)) > 20)) {
  fail('0021 or higher migration present');
}
const migration = read('migrations/0020_staff_assignment_rules.sql');
const contracts = read('packages/contracts/src/staff-assignment.ts');
const staffContract = read('packages/contracts/src/staff.ts');
const domainRules = read('packages/domain/src/staff-assignment/rules.ts');
const candidate = read('apps/api/src/staff-assignment/candidate-resolver.ts');
const dataScope = read('apps/api/src/staff-assignment/data-scope.ts');
const routes = read('apps/api/src/staff-assignment/routes.ts');
const catalogActor = read('apps/api/src/staff-assignment/catalog-actor.ts');
const refundPreparation = read('apps/api/src/buyer-refunds/prepare-buyer-refund-obligation.ts');

const duties = [
  'SELLER_ACCOUNT_MANAGER', 'BUYER_PRE_SALES_OWNER',
  'BUYER_AFTER_SALES_OWNER', 'BUYER_REFUND_OWNER',
];
const permissions = [
  'ASSIGNMENT_ELIGIBLE_SELLER_ACCOUNT',
  'ASSIGNMENT_ELIGIBLE_BUYER_PRE_SALES',
  'ASSIGNMENT_ELIGIBLE_BUYER_AFTER_SALES',
  'ASSIGNMENT_ELIGIBLE_BUYER_REFUND',
  'ASSIGNMENT_BATCH_TRANSFER',
  'ASSIGNMENT_AVAILABILITY_MANAGE',
];
const workTypes = [
  'PRODUCT_APPLICATION_REVIEW', 'DEMAND_REVIEW', 'RESERVATION_DECISION',
  'ORDER_EVIDENCE_REVIEW', 'REVIEW_DECISION', 'BUYER_REFUND_PROCESSING',
];
const tables = [
  'staff_availability', 'buyer_staff_assignments', 'seller_staff_assignments',
  'staff_assignment_cursors', 'staff_assignment_fallbacks', 'staff_work_items',
  'staff_assignment_events', 'staff_reassignment_batches',
  'staff_reassignment_batch_items',
];
requireIncludes(contracts, [...duties, ...workTypes], 'contracts');
requireIncludes(domainRules, [...duties, ...workTypes, ...permissions.slice(0, 4)], 'domain rules');
requireIncludes(staffContract, permissions, 'staff permission contract');
requireIncludes(migration, [...duties, ...workTypes, ...permissions, ...tables], 'migration');
requireIncludes(migration, [
  "schema_version=19", "schema_version=20",
  'uq_buyer_staff_assignment_active', 'uq_seller_staff_assignment_active',
  'uq_staff_work_item_open_source', 'staff_assignment_cursor_version_conflict',
  'staff_effective_assignment_permissions', "effect='DENY'",
  'ASSIGNMENT_FAILED', 'uq_staff_assignment_failure_idempotency',
], 'migration guards');
requireIncludes(candidate, [
  'staff_effective_assignment_permissions', 'ORDER BY', 'staff.id',
  'resolveOwnerFallback', 'resolveRoundRobinCandidate',
  'businessPermissionForWorkItem', 'eligibilityPermissionForDuty',
], 'candidate resolver');
requireIncludes(dataScope, [
  "type: 'GLOBAL'", 'buyer_staff_assignments', 'seller_staff_assignments',
  'staff_work_items', 'TASK_VIEW_TEAM',
], 'data scope');
requireIncludes(routes, [
  '/api/staff/me/assignments', '/api/staff/me/work-items',
  '/api/staff/me/availability', '/api/staff/assignments/reassign',
  '/api/staff/reassignment-batches', "context.get('staffAuthorization')",
], 'routes');
requireIncludes(catalogActor, [
  'resolveStaffDataScope', 'requireCatalogOrganizationScope',
  'Request JSON and headers',
], 'catalog scope');
requireIncludes(refundPreparation, [
  'buyer_refund_obligations', 'BUYER_REFUND_OBLIGATION_CREATED',
  'sourceReviewEventId', 'prepareOutboxEvent', 'createAuditEventStatement',
], 'refund obligation integration');

for (const forbidden of ['resource_scope_json', 'UNASSIGNED', 'CLAIMABLE', 'WAITING_FOR_CLAIM']) {
  if (migration.includes(forbidden) || contracts.includes(forbidden)) fail(`forbidden model ${forbidden}`);
}
for (const forbiddenRoute of ['/claim', '/open-tasks', '/public-tasks']) {
  if (routes.includes(forbiddenRoute)) fail(`forbidden route ${forbiddenRoute}`);
}
const newSource = walk(path.join(root, 'apps/api/src/staff-assignment'))
  .map((file) => readFileSync(file, 'utf8')).join('\n');
requireIncludes(newSource, [
  'prepareStaffAssignmentOutboxStatements',
  'prepareOutboxEvent',
  'createOutboxStatements',
  'ASSIGNMENT_FAILED',
], 'assignment outbox and failure path');
if (newSource.includes("'TASK_CLAIM'") || newSource.includes("'TASK_VIEW_OPEN'")) {
  fail('legacy public-task permissions used by Phase 3H implementation');
}
if (/ORDER BY\s+staff_id\s+LIMIT\s+1/iu.test(migration)
  && migration.includes("role_code='owner'")) {
  fail('implicit arbitrary owner fallback');
}
for (const field of ['seller_organization_ids', 'store_ids', 'global=true', 'resource_scope']) {
  if (routes.includes(field)) fail(`client supplied scope authority: ${field}`);
}

const workflowMarkers = new Map([
  ['apps/api/src/product-applications/submit-product-application.ts', 'PRODUCT_APPLICATION_REVIEW'],
  ['apps/api/src/demand-batches/submit-demand-batch.ts', 'DEMAND_REVIEW'],
  ['apps/api/src/reservations/submit-reservation.ts', 'RESERVATION_DECISION'],
  ['apps/api/src/order-evidence/submit-order-evidence.ts', 'ORDER_EVIDENCE_REVIEW'],
  ['apps/api/src/reviews/submit-review-evidence.ts', 'REVIEW_DECISION'],
  ['apps/api/src/reviews/decide-review.ts', 'prepareBuyerRefundObligationFromReviewApproval'],
  ['apps/api/src/reviews/decide-review.ts', 'BUYER_REFUND_PROCESSING'],
  ['apps/api/src/buyer-refunds/record-buyer-refund-payment.ts', 'BUYER_REFUND_PROCESSING'],
]);
for (const [file, marker] of workflowMarkers) {
  if (!read(file).includes(marker)) fail(`${file} missing workflow integration ${marker}`);
}
for (const file of [
  'apps/api/src/catalog/create-product.ts',
  'apps/api/src/catalog/add-product-version.ts',
  'apps/api/src/catalog/link-product-version-main-image.ts',
]) {
  if (!read(file).includes('requireCatalogOrganizationScope')) {
    fail(`${file} missing organization data scope`);
  }
}

console.log(JSON.stringify({
  status: 'PASS',
  migration_count: migrationFiles.length,
  schema_target: 20,
  duties, permissions, work_types: workTypes,
  forbidden_public_queue: 'absent',
  catalog_scope_from_server: true,
}, null, 2));

function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    const full = path.join(directory, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}
