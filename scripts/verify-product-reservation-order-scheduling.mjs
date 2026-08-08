import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const migrations = readdirSync(path.join(root, 'migrations'))
  .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name)).sort();

assert(migrations.length === 37, 'expected exactly 37 migrations');
assert(migrations.at(-1) === '0037_product_reservation_order_scheduling.sql',
  'Migration 0037 ownership drift');

const migration = source('migrations/0037_product_reservation_order_scheduling.sql');
for (const required of [
  'schema_version=36',
  'ADD COLUMN order_interval_days',
  'ADD COLUMN orders_per_run',
  'CREATE TABLE demand_order_schedule_versions',
  'trg_demand_order_schedule_versions_no_update',
  'trg_demand_order_schedule_versions_no_delete',
  "'unixepoch',\n      '+8 hours'",
  'SET schema_version=37',
]) assert(migration.includes(required), `migration boundary missing: ${required}`);

const routes = source('apps/api/src/staff-catalog-routes.ts');
for (const route of [
  '/api/staff/catalog/products',
  '/api/staff/catalog/products/:id',
  '/api/staff/demand-batches/:id/review-context',
  '/api/staff/demand-batches/:id/review',
  '/api/staff/demand-batches/:id/reservation-schedule',
  '/api/staff/demand-batches/:id/schedule/preview',
  '/api/staff/demand-batches/:id/schedule/confirm',
]) assert(routes.includes(`'${route}'`), `Staff route missing: ${route}`);
assert(routes.includes("rejectUnknown(body, [\n    'expected_version'"),
  'schedule commands must reject unknown fields');

const formula = source('packages/domain/src/product-reservation-scheduling/schedule.ts');
assert(formula.includes('Math.floor((input.rank - 1) / input.ordersPerRun)'),
  'authoritative rank formula drift');
assert(formula.includes('date.setUTCDate(date.getUTCDate() + days)'),
  'calendar-day implementation drift');
assert(!/holiday|workday|calendar service/iu.test(formula),
  'holiday/calendar dependency is forbidden');

const command = source('apps/api/src/product-reservation-scheduling/schedule-command.ts');
for (const required of ['expectedVersion', 'previewHash', 'idempotencyKey',
  'createAuditEventStatement', 'createOutboxStatements']) {
  assert(command.includes(required), `schedule command evidence missing: ${required}`);
}
assert(!/INSERT INTO (?:formal_orders|order_evidence_submissions|internal_order_finance)/iu
  .test(command), 'schedule command must not write order or finance facts');

for (const file of ['apps/api/src/catalog/catalog-shared.ts']) {
  const gate = source(file);
  for (const required of ['PRODUCT_REVIEW', 'DEMAND_PUBLISH', 'owner', 'seller_ops']) {
    assert(gate.includes(required), `${file} cadence hard gate missing: ${required}`);
  }
}
const productGate = source('apps/api/src/product-applications/product-application-shared.ts');
for (const required of ['requireProductReviewPermission', 'requireProductApprovalPermission',
  'PRODUCT_REVIEW', 'DEMAND_PUBLISH', 'owner', 'seller_ops']) {
  assert(productGate.includes(required), `product action gate missing: ${required}`);
}
const productReview = source('apps/api/src/product-applications/review-product-application.ts');
for (const required of ["input.decision === 'APPROVE'", 'requireProductApprovalPermission',
  'authoritativeSellerOrganizationId', 'requireSellerOrganizationScope']) {
  assert(productReview.includes(required), `product review boundary missing: ${required}`);
}
const demandGate = source('apps/api/src/demand-batches/demand-shared.ts');
for (const required of ['requireDemandPublishPermission', 'requireInitialDemandSchedulePermission',
  'PRODUCT_REVIEW', 'DEMAND_PUBLISH', 'owner', 'seller_ops']) {
  assert(demandGate.includes(required), `demand action gate missing: ${required}`);
}
const demandReview = source('apps/api/src/demand-batches/review-demand-batch.ts');
for (const required of ["input.decision === 'PUBLISH'", 'requireInitialDemandSchedulePermission',
  'can_publish', 'authoritativeSellerOrganizationId', 'requireSellerOrganizationScope']) {
  assert(demandReview.includes(required), `demand review boundary missing: ${required}`);
}
const demandClose = source('apps/api/src/demand-batches/close-demand-batch.ts');
assert(demandClose.includes('requireDemandPublishPermission'),
  'demand close must retain base DEMAND_PUBLISH gate');
assert(!demandClose.includes('requireInitialDemandSchedulePermission'),
  'demand close must not inherit initial schedule double-permission gate');

const web = source('apps/web/src/App.tsx');
for (const route of ['/staff/products', 'products/:productId',
  'demands/:demandId/reservations']) {
  assert(web.includes(route), `bookmarkable Staff route missing: ${route}`);
}
const workbench = source('apps/web/src/staff/StaffWorkbench.tsx');
for (const required of ['DemandReviewPanel', 'demandReviewContext', 'first_order_date',
  'expected_version', 'can_publish', '北京时间']) {
  assert(workbench.includes(required), `demand review panel missing: ${required}`);
}
const schedulingWeb = source(
  'apps/web/src/staff/product-scheduling/ProductSchedulingWorkspace.tsx',
);
for (const required of ['StaffMutationAuthority', '重试原请求',
  "session.permissions.includes('PRODUCT_REVIEW')",
  "session.permissions.includes('DEMAND_PUBLISH')"]) {
  assert(schedulingWeb.includes(required), `scheduling Web boundary missing: ${required}`);
}

for (const area of [
  'apps/api/src/buyer-portal',
  'apps/api/src/seller-portal',
  'apps/api/src/buyer-formal-orders',
  'apps/api/src/seller-formal-orders',
]) {
  for (const name of readdirSync(path.join(root, area))) {
    if (!/\.(?:ts|tsx)$/u.test(name)) continue;
    const content = source(path.join(area, name));
    assert(!/queue_rank|planned_order_date|demand_order_schedule_versions/iu.test(content),
      `${area}/${name} exposes internal scheduling fields`);
  }
}

const inventory = source('docs/contracts/V2_API_ROUTE_INVENTORY.md');
assert(inventory.includes('180 个 API 路由加 `/health`')
  || inventory.includes('180 个 `/api/*`'), 'route inventory count drift');

console.log(JSON.stringify({
  status: 'PASS',
  schema: 37,
  migration: migrations.at(-1),
  authoritative_formula: true,
  immutable_schedule_versions: true,
  buyer_seller_internal_schedule_fields: false,
  production_resources_touched: 0,
}, null, 2));

function source(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
