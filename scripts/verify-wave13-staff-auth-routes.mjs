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
const authRoutes = read('apps/api/src/staff-auth/routes.ts');
const contracts = read('packages/contracts/src/staff-auth.ts');
const migration = read('migrations/0027_staff_auth_sessions.sql');
const authTests = read('apps/api/src/staff-auth/staff-auth.test.ts');
const inventoryTests = read('apps/api/src/wave13-default-app-security.test.ts');

const authPosition = index.indexOf('registerStaffAuthRoutes(app');
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
for (const forbidden of ['last_seen', 'idle_timeout', 'refresh_token']) {
  assertNotContains(`${session}\n${migration}`, forbidden, 'session model');
}
for (const forbiddenColumn of [
  'role_code TEXT', 'permission_code TEXT', 'team_id TEXT', 'scope_json',
]) assertNotContains(migration.split('CREATE TABLE staff_sessions')[1] ?? '',
  forbiddenColumn, 'staff_sessions');
assertNotContains(contracts, 'staff_id?:', 'login start request');
assertContains(authRoutes, "provider: 'FEISHU'", 'auth routes');
assertContains(authRoutes, 'resolveVerifiedStaffIdentity', 'auth routes');
assertContains(authRoutes, 'createInternalStaffSession', 'auth routes');
const logout = authRoutes.slice(
  authRoutes.indexOf('async function logout('),
  authRoutes.indexOf('async function logoutAll('),
);
const logoutOrigin = logout.indexOf('requireAllowedOrigin(context, config)');
assert(logoutOrigin >= 0
  && logoutOrigin < logout.indexOf('readStaffSessionCookie(context)')
  && logoutOrigin < logout.indexOf('clearStaffSessionCookie(context)'),
  'ordinary logout must validate Origin before cookie/session side effects');
for (const evidence of [
  'requires an allowed Origin before logout has any side effect',
  "Origin: 'https://evil.example.test'",
  "'Sec-Fetch-Site': 'cross-site'",
  "status: string",
]) assertContains(authTests, evidence, 'ordinary logout runtime tests');
for (const evidence of [
  'app.routes',
  'duplicateRegistrations',
  'toHaveLength(139)',
  'toHaveLength(109)',
  'toHaveLength(30)',
]) assertContains(inventoryTests, evidence, 'route inventory runtime test');
for (const source of [index, middleware, authRoutes]) {
  assertNotContains(source, '/api/v2/', 'Wave13 Staff routing');
}
report('wave13-staff-auth-route-guard', {
  middleware_before_staff_routes: true,
  header_actor_paths: 0,
  api_v2_routes: 0,
  active_routes: 139,
});
