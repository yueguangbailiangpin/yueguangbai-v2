import { readFileSync } from 'node:fs';
import path from 'node:path';
import { applyBaseline, baselineSchemaText } from './baseline-schema-helper.mjs';

const root = path.resolve(import.meta.dirname, '..');
// Payment/allocation schema assertions re-anchored on the applied stage 3
// baseline (tables in 0013_seller_settlements, views in 0019_read_model_views).
const applyBaselineDatabase = applyBaseline();
const migration = baselineSchemaText(applyBaselineDatabase);
const record = read('apps/api/src/seller-settlements/record-payment.ts');
const allocation = read('apps/api/src/seller-settlements/allocation-commands.ts');
const payment = read('apps/api/src/seller-settlements/payment-commands.ts');

for (const token of [
  'CREATE TABLE seller_payments',
  'CREATE TABLE seller_payment_proofs',
  'CREATE TABLE seller_payment_allocations',
  'CREATE TABLE seller_payment_allocation_reversals',
  'CREATE TABLE seller_payment_reversals',
  'CREATE VIEW seller_payment_balances',
  'CREATE VIEW seller_payable_balances',
  'trg_seller_payment_update_guard',
  'trg_seller_allocation_guard',
  'trg_seller_payment_reversal_guard',
]) assert(migration.includes(token));
assert(record.includes('proof_file_count: 1'));
assert(record.includes("'image/jpeg', 'image/png', 'image/webp'"));
assert(record.includes("file.owner_actor_type === 'SYSTEM'"));
assert(allocation.includes('reallocateSellerAllocation'));
assert(payment.includes('listActiveAllocationsForPayment'));
assert(payment.includes("derived_status='REVERSED'"));
assert(payment.includes('dedupKey: `seller-payment-paid-at:${eventId}`'));
assert(payment.includes('dedupKey: `seller-payment-reversed:${reversalId}`'));
assert(payment.includes('const allocationReversalId = crypto.randomUUID()'));
assert(payment.includes('allocationReversalId,\n          now'));
assert(!payment.includes(
  'dedupKey: `seller-payment-paid-at:${paymentId}:${nextVersion}`',
));
assert(!payment.includes('dedupKey: `seller-payment-reversed:${paymentId}`'));
assert(!payment.includes(
  '`payment-reversal:${paymentId}:${allocation.allocation_id}`',
));
assert(!migration.match(/\b(?:REAL|FLOAT)\b/u));
// payment_channel is a legitimate buyer-side account field (advance/refund
// payment entries); the seller settlement tables and runtime must not track it.
const sellerSettlementDdl = [
  'seller_payments',
  'seller_payment_proofs',
  'seller_payment_allocations',
  'seller_payment_allocation_reversals',
  'seller_payment_reversals',
].map((table) =>
  String(applyBaselineDatabase.prepare(
    `SELECT sql FROM sqlite_schema WHERE type='table' AND name=?`,
  ).get(table)?.sql ?? ''),
).join('\n');
assert(![sellerSettlementDdl, record, allocation, payment].join('\n').includes('payment_channel'));

console.log('phase3k seller payment verifier passed');
function read(file) { return readFileSync(path.join(root, file), 'utf8'); }
function assert(value) {
  if (!value) throw new Error('phase3k_seller_payment_verification_failed');
}
