import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const sourceFiles = [
  'apps/api/src/seller-settlements/shared.ts',
  'apps/api/src/seller-settlements/record-payment.ts',
  'apps/api/src/seller-settlements/allocation-commands.ts',
  'apps/api/src/seller-settlements/payment-commands.ts',
  'apps/api/src/seller-settlements/read-model.ts',
  'apps/api/src/seller-settlements/staff-routes.ts',
  'apps/api/src/seller-settlements/seller-routes.ts',
];
const sources = sourceFiles.map(read).join('\n');
const sellerPublicRead = read('apps/api/src/seller-settlements/read-model.ts')
  + read('apps/api/src/seller-settlements/seller-routes.ts');
const migration = read('migrations/0024_seller_payments_allocations.sql');

for (const token of [
  'SELLER_SETTLEMENT_VIEW',
  'SELLER_SETTLEMENT_RECORD',
  'FINANCIAL_CORRECT',
  'resolveStaffDataScope',
  'requireSellerOrganizationScope',
]) assert(sources.includes(token));
assert(!sources.includes('assigned_owner_id'));
assert(!sources.includes('resource_scope_json'));
assert(!sources.includes('payment_channel'));
assert(!sellerPublicRead.includes('file_object_id'));
assert(!sellerPublicRead.includes('file_entity_link_id'));
assert(!sellerPublicRead.includes('object_key'));
assert(!sellerPublicRead.includes('reversal reason'));
assert(!sellerPublicRead.includes('recorded_by_staff_id'));
assert(!sellerPublicRead.includes('reversed_by_staff_id'));
assert(migration.includes("object.visibility='INTERNAL_ONLY'"));
assert(migration.includes("staff_grant.subject_type='STAFF_INTERNAL'"));
assert(!sources.match(/public\s+queue|claim\s+api/iu));

const migrations = readdirSync(path.join(root, 'migrations'))
  .filter((name) => /^\d{4}_.+\.sql$/u.test(name));
assert(migrations.filter((name) => /^002[234]_/u.test(name)).length === 3);

console.log('seller finance security scan passed');
function read(file) { return readFileSync(path.join(root, file), 'utf8'); }
function assert(value) {
  if (!value) throw new Error('seller_finance_security_scan_failed');
}