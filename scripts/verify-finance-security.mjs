// Stage 4 canonical verifier (D-054 §7 equivalence migration).
// Successor of verify:wave12:security + verify:seller-finance-security. Merged finance authority verifier.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { applyBaseline, baselineSchemaText } from './baseline-schema-helper.mjs';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
function assert(value, message) { if (!value) throw new Error(message); }

// --- internal finance authority (from verify-wave12-financial-security) ---
const routes = readFileSync(
  path.join(root, 'apps/api/src/internal-finance/routes.ts'),
  'utf8',
);
const shared = readFileSync(
  path.join(root, 'apps/api/src/internal-finance/shared.ts'),
  'utf8',
);
const policy = readFileSync(
  path.join(root, 'apps/api/src/staff/authorization-policy.ts'),
  'utf8',
);
const csv = readFileSync(
  path.join(root, 'packages/domain/src/finance/csv.ts'),
  'utf8',
);
for (const token of [
  "actor.roles.has('owner')",
  "'FINANCIAL_VIEW'",
  "'FINANCIAL_EXPORT'",
  'assertExactQueryParameters',
  'readBoundedJson',
  'Cache-Control',
  '/^[=+\\-@\\t\\r]/u',
  'protectSpreadsheetText',
]) {
  if (!(routes + shared + policy + csv).includes(token)) {
    throw new Error(`missing security token ${token}`);
  }
}
if (!policy.includes("'FINANCIAL_VIEW',\n  'FINANCIAL_CORRECT'")) {
  throw new Error('FINANCIAL_VIEW not in owner-only permission set');
}
for (const forbidden of ['staff_id', 'role', 'scope', 'global', 'team']) {
  if (new RegExp(`body\\[['\"]${forbidden}`, 'u').test(routes)) {
    throw new Error(`client authority field accepted: ${forbidden}`);
  }
}
if (/apps\/web|deploy|wrangler\s+deploy|feishu/iu.test(
  routes + shared + csv,
)) {
  throw new Error('Wave 12 finance module must not add frontend or deployment');
}

// --- seller settlement + proof file authorization (from verify-seller-finance-security) ---
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
// Settlement schema assertions re-anchored on the applied stage 3 baseline.
const migration = baselineSchemaText(applyBaseline());
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
  "resource.entityType === 'SELLER_SETTLEMENT'",
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

console.log('seller finance security scan passed');

console.log(JSON.stringify({ status: 'PASS', verifier: 'finance-security', internal_finance: 'owner+FINANCIAL_VIEW/EXPORT', seller_settlement: 'scope+audience' }, null, 2));
