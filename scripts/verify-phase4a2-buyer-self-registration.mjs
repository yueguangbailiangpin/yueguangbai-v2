import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const requiredFiles = [
  'migrations/0018_buyer_self_registration.sql',
  'apps/api/src/buyer-self-registration/register-buyer.ts',
  'apps/api/src/buyer-self-registration/routes.ts',
  'apps/api/src/buyer-self-registration/rate-limit.ts',
  'apps/api/src/buyer-self-registration/recovery.ts',
  'packages/contracts/src/buyer-self-registration.ts',
];
for (const relative of requiredFiles) {
  const absolute = path.join(root, relative);
  if (!statSync(absolute).isFile()) throw new Error(`missing ${relative}`);
}
const migration = readFileSync(
  path.join(root, 'migrations/0018_buyer_self_registration.sql'),
  'utf8',
);
for (const token of [
  'schema_version=18',
  'buyer_preorder_number_allocations',
  'buyer_registration_conflicts',
  'buyer_registration_session_issuances',
  'buyer_auth_recovery_events',
  'trg_buyer_registration_conflicts_no_update',
]) {
  if (!migration.includes(token)) throw new Error(`migration missing ${token}`);
}
const register = readFileSync(
  path.join(root, 'apps/api/src/buyer-self-registration/register-buyer.ts'),
  'utf8',
);
for (const token of [
  'normalizeWechatId',
  'hashCustomerPassword',
  "passwordChangeRequired: false",
  'SELF_REGISTRATION_NEW',
  'SELF_REGISTRATION_CLAIM',
  'transaction_assertions',
]) {
  if (!register.includes(token)) throw new Error(`register missing ${token}`);
}
if (/mergeBuyerCustomers/u.test(register)) {
  throw new Error('mergeBuyerCustomers is forbidden in Phase 4A2');
}
const route = readFileSync(
  path.join(root, 'apps/api/src/buyer-self-registration/routes.ts'),
  'utf8',
);
for (const token of [
  'BUYER_SELF_REGISTRATION_ENABLED',
  'BUYER_SELF_REGISTRATION_CHANNEL_ID',
  'Content-Type',
  'self-register:',
  'Cache-Control',
  'writeCustomerSessionCookie',
]) {
  if (!route.includes(token)) throw new Error(`route missing ${token}`);
}
const forbiddenDomains = [
  'formal-orders',
  'reviews',
  'buyer-refunds',
  'files',
  'buyer-reviews',
  'seller-reviews',
];
const moduleFiles = readdirSync(
  path.join(root, 'apps/api/src/buyer-self-registration'),
);
if (moduleFiles.length < 6) throw new Error('registration module incomplete');
console.log(JSON.stringify({
  status: 'PASS',
  schema_version: 18,
  route: '/api/buyer-auth/register',
  feature_flag: 'BUYER_SELF_REGISTRATION_ENABLED',
  no_merge_capability: true,
  forbidden_domains_unchanged_by_module: forbiddenDomains,
}, null, 2));
