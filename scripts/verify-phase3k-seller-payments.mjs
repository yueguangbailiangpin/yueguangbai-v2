import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const migration = read('migrations/0024_seller_payments_allocations.sql');
const record = read('apps/api/src/seller-settlements/record-payment.ts');
const allocation = read('apps/api/src/seller-settlements/allocation-commands.ts');
const payment = read('apps/api/src/seller-settlements/payment-commands.ts');

for (const token of [
  'schema_version=23',
  'schema_version=24',
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
assert(![migration, record, allocation, payment].join('\n').includes('payment_channel'));

const migrations = readdirSync(path.join(root, 'migrations'))
  .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
  .sort();
assert(migrations.length === 24);
assert(migrations.at(-1) === '0024_seller_payments_allocations.sql');
assert(!migrations.some((name) => name.startsWith('0025_')));

console.log('phase3k seller payment verifier passed');
function read(file) { return readFileSync(path.join(root, file), 'utf8'); }
function assert(value) {
  if (!value) throw new Error('phase3k_seller_payment_verification_failed');
}