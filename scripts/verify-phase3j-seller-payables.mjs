import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const migration = read('migrations/0023_seller_payables.sql');
const formal = read('apps/api/src/formal-orders/confirm-formal-order.ts');
const approval = read('apps/api/src/buyer-refunds/prepare-buyer-refund-obligation.ts');
const reconcile = read('apps/api/src/seller-settlements/reconciliation.ts');

for (const token of [
  'schema_version=22',
  'schema_version=23',
  'CREATE TABLE seller_payables',
  "payable_type IN ('SELLER_PRINCIPAL','SELLER_SERVICE_FEE')",
  'UNIQUE (formal_order_id, payable_type)',
  'trg_seller_payables_no_update',
  'trg_seller_payables_no_delete',
  'seller_payable_reconciliation_conflicts',
  'PAYABLE_RECONCILED',
]) assert(migration.includes(token));
assert(formal.includes("payableType: 'SELLER_PRINCIPAL'"));
assert(formal.includes('seller_expected_principal_cny_fen'));
assert(approval.includes("payableType: 'SELLER_SERVICE_FEE'"));
assert(approval.includes('service_fee_cny_fen'));
assert(reconcile.includes('REVIEW_APPROVAL_SOURCE_CONFLICT'));
assert(!migration.match(/\b(?:REAL|FLOAT)\b/u));

console.log('phase3j seller payable verifier passed');
function read(file) { return readFileSync(path.join(root, file), 'utf8'); }
function assert(value) {
  if (!value) throw new Error('phase3j_seller_payable_verification_failed');
}