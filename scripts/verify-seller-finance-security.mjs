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
  'apps/api/src/seller-settlements/staff-proof-routes.ts',
  'apps/api/src/seller-settlements/seller-routes.ts',
  'apps/api/src/files/file-audience-authorization.ts',
  'apps/api/src/files/file-read-service.ts',
];
const sources = sourceFiles.map(read).join('\n');
const sellerPublicRead = read('apps/api/src/seller-settlements/read-model.ts')
  + read('apps/api/src/seller-settlements/seller-routes.ts');
const migration = read('migrations/0024_seller_payments_allocations.sql');
const fileAuthorization = read(
  'apps/api/src/files/file-audience-authorization.ts',
);
const fileReadService = read('apps/api/src/files/file-read-service.ts');
const payment = read('apps/api/src/seller-settlements/record-payment.ts');
const settlementFilePolicy = read('apps/api/src/seller-settlements/shared.ts');

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
assert(migration.includes('payment_id TEXT NOT NULL UNIQUE'));
assert(migration.includes('file_object_id TEXT NOT NULL UNIQUE'));
assert(!sources.match(/public\s+queue|claim\s+api/iu));

// A GLOBAL grant is only an audience marker. The common file authorization
// layer must dynamically re-resolve Staff permission and Seller scope.
for (const token of [
  'resolveAssignmentStaffAuthorization',
  'grant.staff_permission_code',
  'isStaffPermissionCode(row.staff_permission_code)',
  'authorization.permissions.has(row.staff_permission_code as StaffPermissionCode)',
  "authorization.roles.has('owner')",
  'resolveStaffMarketplaceCodes',
  'resolveResourceMarketplace',
  "resource.entityType==='SELLER_SETTLEMENT'",
  'seller_payments payment',
  'payment.seller_organization_id',
  "grant.subject_type='STAFF_INTERNAL'",
  "grant.staff_scope_type='GLOBAL'",
  "link.authorization_mode='EXPLICIT_AUDIENCES'",
  'authorization.staffStatus',
]) assert(fileAuthorization.includes(token));
assert((fileReadService.match(/await authorizeFileRead\(/gu) ?? []).length >= 2);
assert(fileReadService.indexOf('await authorizeFileRead(')
  < fileReadService.indexOf('const expiresAt = now + ttlMs'));
const finalReadAuthorization = fileReadService.lastIndexOf('await authorizeFileRead(');
assert(finalReadAuthorization < fileReadService.indexOf('const archived ='));
assert(finalReadAuthorization < fileReadService.indexOf('await readArchivedBytes(source'));
assert(finalReadAuthorization < fileReadService.indexOf('await storage.readObject(source.object_key'));

// Staff-owned and trusted SYSTEM-owned proofs are accepted only from persisted
// file facts; customer actors and client-declared SYSTEM uploads remain closed.
assert(payment.includes("file.owner_actor_type === 'SYSTEM'"));
assert(payment.includes("file.owner_actor_type === 'STAFF'"));
assert(payment.includes('validateSellerSettlementProofFile'));
assert(settlementFilePolicy.includes("resource.ownerActorType === 'SYSTEM'"));
assert(settlementFilePolicy.includes("resource.ownerActorType === 'STAFF'"));
assert(settlementFilePolicy.includes("actor.type !== 'STAFF'"));
assert(settlementFilePolicy.includes('assertStaffOwner'));
assert(settlementFilePolicy.includes('assertCanCreateUpload'));
assert(migration.includes("intent.owner_actor_type='SYSTEM'"));

const migrations = readdirSync(path.join(root, 'migrations'))
  .filter((name) => /^\d{4}_.+\.sql$/u.test(name));
assert(migrations.filter((name) => /^002[234]_/u.test(name)).length === 3);

console.log('seller finance security scan passed');
function read(file) { return readFileSync(path.join(root, file), 'utf8'); }
function assert(value) {
  if (!value) throw new Error('seller_finance_security_scan_failed');
}
