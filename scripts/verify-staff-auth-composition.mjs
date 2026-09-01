// Stage 4 canonical verifier (D-054 §7 equivalence migration).
// Successor of check:wave13:staff-auth (verify-wave13-staff-auth-routes.mjs). Renamed; schema anchors now read the applied baseline.
// Assertions are carried over verbatim unless the stage 4 contract rebuild
// changed the asserted surface; changes are marked inline.
import {
  assert,
  assertContains,
  assertNotContains,
  read,
  report,
} from './wave13-verifier-lib.mjs';

const index = read('apps/api/src/index.ts');
const middleware = read('apps/api/src/middleware/staff-auth.ts');
const session = read('apps/api/src/staff-auth/session.ts');
const authRoutes = read('apps/api/src/staff-auth/access-routes.ts');
const contracts = read('packages/contracts/src/staff-auth.ts');
// Staff session schema assertions re-anchored on the stage 3 baseline.
import { applyBaseline, baselineSchemaText } from './baseline-schema-helper.mjs';
const migration = baselineSchemaText(applyBaseline()); // staff tables live across the clean baseline (0002 et al.)
const authTests = read('apps/api/src/staff-auth/cloudflare-access.test.ts');
const inventoryTests = read('apps/api/src/architecture-guards/app-security-registration.test.ts');

const authPosition = index.indexOf('registerCloudflareStaffAuthRoutes(app');
const middlewarePosition = index.indexOf("app.use('/api/staff/*', staffSessionMiddleware())");
assert(authPosition >= 0 && middlewarePosition > authPosition,
  'Staff Auth must be registered before Staff middleware');
for (const routeFamily of [
  'registerStaffAssignmentRoutes(app)',
  'registerStaffCatalogWorkflowRoutes(app)',
  'registerStaffReviewRoutes(app)',
  'registerStaffSellerSettlementRoutes(app)',
  'registerStaffSellerSettlementProofRoutes(app)',
  'registerStaffFinanceRoutes(app)',
  'registerStaffOrderEvidenceRoutes(app)',
  'registerStaffBuyerRefundRoutes(app)',
  'registerFileHttpRoutes(app)',
]) {
  assert(index.indexOf(routeFamily) > middlewarePosition,
    `${routeFamily} is not protected by Staff middleware`);
}
for (const forbidden of [
  "header('X-Staff-Id')",
  "header('X-Feishu-Open-Id')",
  "header('X-Feishu-User-Id')",
  'x-feishu-open-id',
  'x-staff-id',
]) assertNotContains(middleware.toLowerCase(), forbidden.toLowerCase(), 'middleware');
assertContains(middleware, 'readStaffSessionCookie', 'middleware');
assertContains(middleware, 'resolveTrustedStaffSession', 'middleware');
assertContains(middleware, "context.set('staffAuthorization'", 'middleware');
assertContains(session, 'resolveAssignmentStaffAuthorization', 'session');
assertContains(session, 'resolveStaffDataScope', 'session');
assertContains(session, 'issued_session_version', 'session');
assertContains(session, 'issued_authorization_version', 'session');
// The forbidden-column vocabulary is scoped to the staff_sessions segment and
// the session runtime; unrelated tables in the clean baseline may use similar
// column names (e.g. scheduled job liveness), which is out of scope here.
const sessionsSegment = (migration.split('CREATE TABLE staff_sessions')[1] ?? '')
  .split(/CREATE (?:TABLE|TRIGGER|INDEX)/u)[0] ?? '';
for (const forbidden of ['last_seen', 'idle_timeout', 'refresh_token']) {
  assertNotContains(`${session}\n${sessionsSegment}`, forbidden, 'session model');
}
for (const forbiddenColumn of [
  'role_code TEXT', 'permission_code TEXT', 'team_id TEXT', 'scope_json',
]) assertNotContains(sessionsSegment, forbiddenColumn, 'staff_sessions');
assertNotContains(contracts, 'staff_id?:', 'Access bootstrap request');
assertContains(authRoutes, 'verifyCloudflareAccessIdentity', 'auth routes');
assertContains(authRoutes, 'staff_email_identities', 'auth routes');
assertContains(authRoutes, 'createInternalStaffSession', 'auth routes');
const logout = authRoutes.slice(
  authRoutes.indexOf('async function logout('),
  authRoutes.indexOf('async function logoutAll('),
);
const logoutOrigin = logout.indexOf('requireAllowedOrigin(context)');
assert(logoutOrigin >= 0
  && logoutOrigin < logout.indexOf('readStaffSessionCookie(context)')
  && logoutOrigin < logout.indexOf('clearStaffSessionCookie(context)'),
  'ordinary logout must validate Origin before cookie/session side effects');
for (const evidence of [
  'fails closed for wrong audience, bad signature and unavailable keys',
  'pre-existing active Moonwhite email identity',
  'rejects a foreign Origin before Staff session side effects',
]) assertContains(authTests, evidence, 'Cloudflare Access runtime tests');
for (const evidence of [
  'app.routes',
  'duplicateRegistrations',
  '/api/staff-auth/access/bootstrap',
  'app.routes',
]) assertContains(inventoryTests, evidence, 'route inventory runtime test');
for (const source of [index, middleware, authRoutes]) {
  assertNotContains(source, '/api/v2/', 'Wave13 Staff routing');
}
report('wave13-staff-auth-route-guard', {
  middleware_before_staff_routes: true,
  header_actor_paths: 0,
  api_v2_routes: 0,
  auth_provider: 'CLOUDFLARE_ACCESS',
});
