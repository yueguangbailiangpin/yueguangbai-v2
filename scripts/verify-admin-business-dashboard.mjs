import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

const migrations = readdirSync('migrations')
  .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
  .sort();
assertContiguousMigrations(migrations);
if (migrations.length < 37
  || migrations[35] !== '0036_staff_acquisition_funnel_workbench.sql'
  || migrations[36] !== '0037_product_reservation_order_scheduling.sql') {
  throw new Error('current governed migration chain is missing M14 acquisition or M16 scheduling ownership');
}
const dashboardProposal = readFileSync(
  'openspec/changes/archive/2026-08-08-admin-business-dashboard/proposal.md', 'utf8',
);
const schedulingProposal = readFileSync(
  'openspec/changes/archive/2026-08-08-staff-product-reservation-order-scheduling/proposal.md', 'utf8',
);
const schedulingMigration = readFileSync(
  'migrations/0037_product_reservation_order_scheduling.sql', 'utf8',
);
if (!dashboardProposal.includes('预计不需要 Migration')
  || !schedulingProposal.includes('需要 Migration')
  || !schedulingMigration.includes('demand_order_schedule_versions')) {
  throw new Error('dashboard NO_SCHEMA_CHANGE or M16 migration ownership drift');
}

const sql = [
  'SELECT schema_version FROM app_schema_state WHERE singleton_id=1',
  `EXPLAIN QUERY PLAN SELECT id,activated_at FROM buyer_customers
    WHERE activated_at>=0 AND activated_at<9999999999999 AND activated_at<=9999999999999`,
  `EXPLAIN QUERY PLAN SELECT id,submitted_at FROM product_reservations
    WHERE submitted_at>=0 AND submitted_at<9999999999999 AND submitted_at<=9999999999999`,
  `EXPLAIN QUERY PLAN SELECT id,confirmed_business_date FROM formal_orders
    WHERE confirmed_business_date BETWEEN '2026-01-01' AND '2026-12-31'
      AND confirmed_at<=9999999999999`,
  `EXPLAIN QUERY PLAN SELECT formal_order_id,business_closed_at FROM order_archive_closures
    WHERE status='CLOSED' AND business_closed_at>=0
      AND business_closed_at<9999999999999 AND business_closed_at<=9999999999999`,
  `EXPLAIN QUERY PLAN SELECT channel_id,lead_type,SUM(person_count)
    FROM acquisition_daily_consultations
    WHERE business_date BETWEEN '2026-01-01' AND '2026-12-31'
    GROUP BY channel_id,lead_type`,
  `EXPLAIN QUERY PLAN SELECT lead.id,link.target_id
    FROM acquisition_leads lead JOIN acquisition_lead_links link
      ON link.lead_id=lead.id AND link.link_type='FORMAL_ORDER'
    WHERE lead.status='ACTIVE' AND lead.lead_type='BUYER'`,
  `EXPLAIN QUERY PLAN SELECT formal_order_id,confirmed_business_date,
      review_approved_business_date,projected_gross_profit_cny_fen,
      completed_gross_profit_cny_fen,finance_status
    FROM internal_order_finance_positions
    WHERE (confirmed_business_date BETWEEN '2026-01-01' AND '2026-12-31'
      AND confirmed_at<=9999999999999)
      OR (review_approved_business_date BETWEEN '2026-01-01' AND '2026-12-31'
      AND review_approved_at<=9999999999999)`,
].join(';');

const output = execFileSync('node_modules/.bin/wrangler', [
  'd1', 'execute', 'yueguangbai-v2-local', '--local', '--json',
  '--config', 'apps/api/wrangler.local.jsonc', '--command', sql,
], { encoding: 'utf8' });
const result = JSON.parse(output);
const currentSchemaVersion = Number(migrations.at(-1)?.slice(0, 4));
if (result[0]?.results?.[0]?.schema_version !== currentSchemaVersion) {
  throw new Error(`Expected local D1 schema ${currentSchemaVersion}: ${output}`);
}
const details = result.slice(1).flatMap((entry) =>
  entry.results.map((row) => String(row.detail)));
for (const required of [
  'idx_order_archive_closures_due',
  'idx_acquisition_consultations_date',
  'idx_acquisition_lead_links_target',
  'MATERIALIZE snapshot_facts',
  'uq_review_approval_events_once',
  'idx_seller_allocation_reversals_allocation',
  'idx_buyer_refund_payment_entries_obligation',
]) {
  if (!details.some((detail) => detail.includes(required))) {
    throw new Error(`Local D1 query plan did not use ${required}: ${details.join(' | ')}`);
  }
}

const readModel = readFileSync(
  'apps/api/src/admin-business-dashboard/read-model.ts', 'utf8',
);
if (!readModel.includes('internal_order_finance_positions')
  || !readModel.includes('databaseIntegerToBigInt')
  || /(?:projected|completed)_gross_profit_cny_fen\s*=(?!=)/u.test(readModel)) {
  throw new Error('Dashboard must consume canonical finance positions with BigInt, not recalculate formulas');
}
if (!readModel.includes("lead.status='ACTIVE'")
  || !readModel.includes('lead.origin_staff_id')
  || !readModel.includes('lead.origin_channel_id')) {
  throw new Error('Dashboard origin attribution or active lead boundary is missing');
}

console.log(`Admin dashboard NO_SCHEMA_CHANGE verified on real local D1 schema ${currentSchemaVersion}.`);
console.log('Query plan evidence: bounded core scans plus existing acquisition, closure and canonical finance indexes/views.');
console.log('Bounded scan acceptance is covered by the 8 Staff / 200 attributed-order D1 capacity test.');

function assertContiguousMigrations(names) {
  for (const [index, name] of names.entries()) {
    if (Number(name.slice(0, 4)) !== index + 1) {
      throw new Error(`Migration chain is not continuous at ${name}`);
    }
  }
}
