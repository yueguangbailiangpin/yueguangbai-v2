import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const migration = readFileSync(
  path.join(root, 'migrations/0025_internal_finance_reporting.sql'),
  'utf8',
);
const contracts = readFileSync(
  path.join(root, 'packages/contracts/src/internal-finance.ts'),
  'utf8',
);
const routes = readFileSync(
  path.join(root, 'apps/api/src/internal-finance/routes.ts'),
  'utf8',
);
const detail = readFileSync(
  path.join(root, 'apps/api/src/internal-finance/order-detail.ts'),
  'utf8',
);
const required = [
  'internal_order_finance_positions',
  'internal_finance_exceptions',
  'internal_finance_cash_movements',
  'projected_gross_profit_cny_fen',
  'completed_gross_profit_cny_fen',
  'attributed_cash_net_cny_fen',
  'buyer_refund_overpaid_cny_fen',
  'seller_unallocated_credit_cny_fen',
  'approval_review_case_id',
  'refund_source_event_id',
  'service_fee_source_type',
  "principal_source_type<>'FORMAL_ORDER'",
  "service_fee_source_type<>'REVIEW_APPROVAL'",
  'seller_payment_reversals',
  'FINANCIAL_VIEW',
  'schema_version=25',
  'buildFinanceOrderDetail',
  'frozen_snapshot',
  'calculations',
];
for (const token of required) {
  if (!(migration + contracts + routes + detail).includes(token)) {
    throw new Error(`missing ${token}`);
  }
}
if (/CREATE TABLE\s+\w*profit/iu.test(migration)
  || /(?:profit|gross_profit)_cny_fen\s+INTEGER/iu.test(migration)) {
  throw new Error('mutable profit amount is forbidden');
}
for (const route of [
  '/api/staff/finance/summary',
  '/api/staff/finance/orders',
  '/api/staff/finance/groups',
  '/api/staff/finance/cash-flow',
  '/api/staff/finance/exceptions',
]) {
  if (!routes.includes(route)) throw new Error(`missing route ${route}`);
}
for (const forbidden of [
  'payment_proof',
  'refund_proof',
  'object_key',
  'file_url',
  'buyer_wechat',
  'session_secret',
]) {
  if (detail.includes(forbidden)) {
    throw new Error(`sensitive order detail token: ${forbidden}`);
  }
}
console.log(JSON.stringify({
  status: 'PASS',
  phase: '3L',
  approval_source_consistency: true,
  order_detail_calculation_process: true,
}, null, 2));
