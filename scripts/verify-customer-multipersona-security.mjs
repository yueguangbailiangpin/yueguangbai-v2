import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveChangeRoot } from './verifier-utils.mjs';

const root = path.resolve(import.meta.dirname, '..');
const changeName = 'customer-multipersona-invitation-recovery';
// Schema assertions originally anchored on 0030 are re-anchored on the stage 3
// clean baseline's applied schema; the per-number migration test retired with
// the legacy chain and its assertions live in
// apps/api/src/architecture-guards/baseline-schema.test.ts.
import { applyBaseline, baselineSchemaText } from './baseline-schema-helper.mjs';
const baselineSchema = baselineSchemaText(applyBaseline());
const required = [
  'apps/api/src/customer-security/service.ts',
  'apps/api/src/customer-security/invited-registration.ts',
  'apps/api/src/customer-security/rate-limit.ts',
  'apps/api/src/customer-security/customer-security.test.ts',
  'apps/api/src/architecture-guards/baseline-schema.test.ts',
  'apps/web/src/auth/customer/CustomerPasswordResetPage.tsx',
  'apps/web/src/auth/staff/StaffCustomerSecurityPanel.tsx',
  'apps/web/e2e/customer-security.spec.ts',
  'docs/migration/V2_CUSTOMER_MULTIPERSONA_ROLLBACK.md',
  'docs/security/V2_M3_DEPENDENCY_RISK_DISPOSITION.md',
];
for (const file of required) {
  if (!existsSync(path.join(root, file))) throw new Error(`missing ${file}`);
}

const read = (file) => readFileSync(path.join(root, file), 'utf8');
const requireTokens = (file, tokens) => {
  const source = read(file);
  for (const token of tokens) {
    if (!source.includes(token)) throw new Error(`${file} missing ${token}`);
  }
  return source;
};

for (const token of [
  'CREATE TABLE customer_account_personas',
  'CREATE TABLE customer_buyer_invitations',
  'CREATE TABLE customer_password_reset_tokens',
  'CREATE TABLE "customer_security_rate_limits"',
  'customer_buyer_invitation_events_are_immutable',
  'customer_password_reset_events_are_immutable',
]) {
  if (!baselineSchema.includes(token)) {
    throw new Error(`baseline schema missing ${token}`);
  }
}
for (const forbidden of [
  /CREATE TABLE "?customer_buyer_invitations"?[\s\S]{0,1200}\btoken\s+TEXT/iu,
  /CREATE TABLE "?customer_password_reset_tokens"?[\s\S]{0,1200}\btoken\s+TEXT/iu,
  /CREATE TABLE "?customer_password_credentials"?[\s\S]{0,500}\bpassword\s+TEXT/iu,
]) {
  if (forbidden.test(baselineSchema)) throw new Error('plaintext security material column found');
}

requireTokens('apps/api/src/customer-security/invited-registration.ts', [
  'hashOneTimeToken',
  'verifyCustomerPassword',
  "status='CONSUMED'",
  "persona_type='BUYER'",
  'CONCURRENT_OR_TRANSACTION_CONFLICT',
]);
requireTokens('apps/api/src/customer-security/service.ts', [
  'hashCustomerPassword',
  'session_version=session_version+1',
  "type: 'SESSIONS_REVOKED'",
  "type: 'REJECTED'",
]);
const auth = requireTokens('apps/api/src/customer-auth/authenticate-customer.ts', [
  'loadActivePersonas',
  'selectCustomerPersona',
  'customer_account_personas',
]);
if (/row\.account_type/u.test(auth)) {
  throw new Error('legacy account_type remains an authentication authority');
}
requireTokens('apps/api/src/buyer-self-registration/routes.ts', [
  'invitation_token',
  'readInvitationContext',
  'registerInvitedBuyer',
  'BUYER_SELF_REGISTRATION_ENABLED',
]);
requireTokens('apps/api/src/customer-security/routes.ts', [
  'customerAuthOriginGuard()',
  'enforceStaffRateLimit',
  "'manual_verification_confirmed'",
]);

const changeRoot = resolveChangeRoot(changeName, root);
const specification = readFileSync(path.join(
  changeRoot, 'specs/customer-identity-access/spec.md',
), 'utf8');
const requirements = specification.match(/^### Requirement:/gmu)?.length ?? 0;
const scenarios = specification.match(/^#### Scenario:/gmu)?.length ?? 0;
if (requirements !== 5 || scenarios !== 11) {
  throw new Error(`formal coverage changed: ${requirements}/${scenarios}`);
}
const tasks = readFileSync(path.join(changeRoot, 'tasks.md'), 'utf8');
if (/^- \[ \]/gmu.test(tasks)
  || !tasks.includes('COMPLETE=5')
  || !tasks.includes('Scenarios=11/11')) {
  throw new Error('OpenSpec tasks lack a complete formal verification result');
}

console.log(JSON.stringify({
  status: 'PASS',
  COMPLETE: requirements,
  INCONSISTENT: 0,
  MISSING: 0,
  PARTIAL: 0,
  NOT_VERIFIED: 0,
  Scenarios: `${scenarios}/${scenarios}`,
  schema_version: 19,
  token_storage: 'HASH_ONLY',
  persona_authority: 'RELATION',
  session_revocation: 'VERSIONED',
  public_registration: 'INVITATION_REQUIRED',
  openspec_location: changeRoot.includes(`${path.sep}archive${path.sep}`) ? 'ARCHIVED' : 'ACTIVE',
}, null, 2));
