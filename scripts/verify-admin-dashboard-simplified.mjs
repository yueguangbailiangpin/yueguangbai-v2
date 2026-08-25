// Stage 4 canonical verifier (D-054 §7 equivalence migration).
// Successor of verify:admin-dashboard (verify-admin-business-dashboard.mjs),
// re-scoped to the stage 4 simplified dashboard (inventory §3.2): counting
// cards, pending workload, abnormal signals, owner financial summary, and the
// financial-projection range endpoint. Funnel/trend/drill-down/acquisition-daily
// and the attribution precision switch are retired.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
function assert(value, message) { if (!value) throw new Error(message); }

const routes = read('apps/api/src/admin-business-dashboard/routes.ts');
const readModel = read('apps/api/src/admin-business-dashboard/read-model.ts');
const contracts = read('packages/contracts/src/admin-business-dashboard.ts');
const inventory = read('docs/contracts/V2_API_ROUTE_INVENTORY.md');

for (const endpoint of [
  '/api/staff/admin-business-dashboard/summary',
  '/api/staff/admin-business-dashboard/financial-projection',
]) assert(routes.includes(endpoint), `missing ${endpoint}`);
for (const retired of ['trends', 'drill-down', 'acquisition-daily']) {
  assert(!routes.includes(retired), `retired endpoint still routed: ${retired}`);
  assert(!inventory.includes(`admin-business-dashboard/${retired}`), `inventory still documents ${retired}`);
}
for (const required of [
  'new_customers_buyer', 'new_customers_seller', 'reservations', 'formal_orders',
  'buyer_refunds', 'seller_settlements', 'open_work_items', 'finance_exceptions',
  'owner_summary', 'projected_profit', 'completed_profit',
]) assert(contracts.includes(required), `summary contract missing ${required}`);
for (const retiredField of ['buyer_funnel', 'seller_funnel', 'staff_performance', 'channel_performance', 'conversion_rate_bps', 'dashboardBuckets', 'DASHBOARD_GRANULARITIES']) {
  assert(!contracts.includes(retiredField), `retired dashboard field survived in contracts: ${retiredField}`);
}
// Aggregates only: bounded GROUP BY result sets are allowed; full-fact row
// loading for in-Worker math is not.
assert(!readModel.includes('readLeadCohort'), 'cohort row loading must stay retired');
assert(!readModel.includes('readCoreFacts'), 'core fact row loading must stay retired');
assert(!readModel.includes('readAttribution'), 'attribution row loading must stay retired');
assert(readModel.includes('COUNT(*)'), 'dashboard read model must use SQL counts');
assert(readModel.includes('SUM('), 'dashboard read model must use SQL sums');
// Owner-only financial authority is reused from the internal finance module.
assert(routes.includes('requireFinancialActor'), 'dashboard must reuse the internal finance actor gate');
assert(read('apps/api/src/internal-finance/shared.ts').includes("'FINANCIAL_VIEW'"), 'FINANCIAL_VIEW authority');

console.log(JSON.stringify({
  status: 'PASS',
  verifier: 'admin-dashboard-simplified',
  endpoints: ['summary', 'financial-projection'],
  retired: ['trends', 'drill-down', 'acquisition-daily'],
}, null, 2));
