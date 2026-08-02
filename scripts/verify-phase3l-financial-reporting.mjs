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
const required = [
  'internal_order_finance_positions',
  'internal_finance_exceptions',
  'internal_finance_cash_movements',
  'projected_gross_profit_cny_fen',
  'completed_gross_profit_cny_fen',
  'attributed_cash_net_cny_fen',
  'buyer_refund_overpaid_cny_fen',
  'seller_unallocated_credit_cny_fen',
  'FINANCIAL_VIEW',
  'schema_version=25',
];
for (const token of required) {
  if (!(migration + contracts + routes).includes(token)) {
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
console.log(JSON.stringify({ status: 'PASS', phase: '3L' }, null, 2));
