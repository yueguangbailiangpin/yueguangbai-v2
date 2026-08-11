import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const migration = read('migrations/0023_seller_payables.sql');
const formal = read('apps/api/src/formal-orders/confirm-formal-order.ts');
const approval = read('apps/api/src/buyer-refunds/prepare-buyer-refund-obligation.ts');
const payableStatements = read(
  'apps/api/src/seller-settlements/payable-statements.ts',
);
const reconcile = read('apps/api/src/seller-settlements/reconciliation.ts');

for (const token of [
  'schema_version=22',
  'schema_version=23',
  'CREATE TABLE seller_payables',
  "payable_type IN ('SELLER_PRINCIPAL','SELLER_SERVICE_FEE')",
  'UNIQUE (formal_order_id, payable_type)',
  'UNIQUE (source_type, source_id, payable_type)',
  'UNIQUE (entity_type, entity_id, reason_code)',
  'UNIQUE (payable_id, event_type)',
  'trg_seller_payables_no_update',
  'trg_seller_payables_no_delete',
  'seller_payable_reconciliation_conflicts',
  'PAYABLE_RECONCILED',
  'lower(hex(randomblob(16)))',
]) assert(migration.includes(token));
assert(/payableType\s*:\s*'SELLER_PRINCIPAL'/u.test(formal));
assert(formal.includes('seller_expected_principal_cny_fen'));
assert(/payableType\s*:\s*'SELLER_SERVICE_FEE'/u.test(approval));
assert(approval.includes('service_fee_cny_fen'));
assert(payableStatements.includes('const payableId = crypto.randomUUID()'));
assert(payableStatements.includes('const eventId = crypto.randomUUID()'));
assert(payableStatements.includes('seller-payable-created:${payableId}'));
assert(!payableStatements.includes(
  'seller-payable:${input.payableType}:${input.formalOrderId}',
));
assert(reconcile.includes('REVIEW_APPROVAL_SOURCE_CONFLICT'));
assert(reconcile.includes('const payableId = crypto.randomUUID()'));
assert(reconcile.includes('const payableEventId = crypto.randomUUID()'));
assert(reconcile.includes('crypto.randomUUID(),\n          row.entity_type'));
assert(reconcile.includes('FROM seller_payables payable'));
assert(reconcile.includes('seller-payable-reconciliation:${acquired.claim.idempotencyKey}'));
assert(reconcile.includes('normalized.length > 240'));
assert(!migration.match(/'seller-payable[^']*'\s*\|\|/u));
assert(!migration.match(/'payable-conflict[^']*'\s*\|\|/u));
assert(!migration.match(/'seller-payable-event[^']*'\s*\|\|/u));
assert(!reconcile.match(/`seller-payable:(?:principal|service-fee):\$\{/u));
assert(!reconcile.match(/`seller-payable-(?:conflict|reconciled):\$\{/u));
assert(!migration.match(/\b(?:REAL|FLOAT)\b/u));

console.log('phase3j seller payable verifier passed');
function read(file) { return readFileSync(path.join(root, file), 'utf8'); }
function assert(value) {
  if (!value) throw new Error('phase3j_seller_payable_verification_failed');
}
