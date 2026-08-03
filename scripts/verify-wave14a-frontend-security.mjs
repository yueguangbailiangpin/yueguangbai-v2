import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const workspace = process.cwd();
const webRoot = join(workspace, 'apps/web/src');
const customerRoot = join(webRoot, 'auth/customer');
const files = [];

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (/\.(ts|tsx|css)$/.test(entry.name) && !/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) files.push(path);
  }
}

function requireText(source, values, label) {
  for (const value of values) {
    if (!source.includes(value)) throw new Error(`${label} missing: ${value}`);
  }
}

walk(webRoot);
const source = files.map((file) => readFileSync(file, 'utf8')).join('\n');
const customerSource = readdirSync(customerRoot)
  .filter((name) => /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name))
  .map((name) => readFileSync(join(customerRoot, name), 'utf8'))
  .join('\n');
const tests = readdirSync(customerRoot)
  .filter((name) => /\.test\.tsx?$/.test(name))
  .map((name) => readFileSync(join(customerRoot, name), 'utf8'))
  .join('\n');
const app = readFileSync(join(webRoot, 'App.tsx'), 'utf8');
const invalidation = readFileSync(join(webRoot, 'auth/customer-transport-invalidation.ts'), 'utf8');
const customerInvalidation = invalidation.split('export async function clearStaffTransport')[0] ?? '';
const mismatch = readFileSync(join(customerRoot, 'customer-mismatch-cleanup.ts'), 'utf8');
const sessionController = readFileSync(join(customerRoot, 'customer-session-controller.ts'), 'utf8');
const passwordController = readFileSync(join(customerRoot, 'customer-password-operation.ts'), 'utf8');
const passwordPage = readFileSync(join(customerRoot, 'CustomerChangePasswordPage.tsx'), 'utf8');
const passwordRouteBoundary = readFileSync(join(customerRoot, 'CustomerPasswordRouteBoundary.tsx'), 'utf8');
const passwordRouteController = readFileSync(join(customerRoot, 'customer-password-route-controller.ts'), 'utf8');
const passwordRouteTests = readFileSync(join(customerRoot, 'customer-password-route-flow.test.tsx'), 'utf8');
const mswRoot = join(webRoot, 'test/msw');
const mswServer = readFileSync(join(mswRoot, 'server.ts'), 'utf8');
const mswHandlers = readFileSync(join(mswRoot, 'handlers.ts'), 'utf8');
const mswFixtures = readFileSync(join(mswRoot, 'fixtures.ts'), 'utf8');
const mswLifecycle = readFileSync(join(mswRoot, 'lifecycle.ts'), 'utf8');
const mswTestFiles = [];
function collectMswTests(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collectMswTests(path);
    else if (/\.msw\.test\.tsx?$/.test(entry.name)
      || entry.name === 'msw-lifecycle.test.ts') mswTestFiles.push(path);
  }
}
collectMswTests(webRoot);
const mswTests = mswTestFiles.map((file) => readFileSync(file, 'utf8')).join('\n');

const changeFiles = [];
function walkChange(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walkChange(path);
    else changeFiles.push(path);
  }
}
walkChange(join(workspace, 'openspec/changes/wave14a-frontend-foundation-auth-api-client'));
const changeSource = changeFiles.map((file) => readFileSync(file, 'utf8')).join('\n');

const forbidden = [
  /\/api\/v2/,
  /document\.cookie/,
  /localStorage|sessionStorage/,
  /dangerouslySetInnerHTML/,
  /object_key/,
  /permanent_url/,
  /signed_url/,
  /from ['"].*apps\/api/,
  /redux|mobx/i,
  /Moonlight White|Moonlight|月光白 V2/,
];
for (const rule of forbidden) {
  if (rule.test(source)) throw new Error(`wave14a security violation: ${rule}`);
}
if (/catch\s*\{\s*\}/u.test(customerSource) || /catch\s*\{\s*\}/u.test(app)) {
  throw new Error('Customer mismatch paths must not silently swallow errors');
}
if (/console\.|localStorage|sessionStorage|URLSearchParams/u.test(passwordController + passwordPage)) {
  throw new Error('password operation data must not enter logs, storage, or URLs');
}

requireText(source, [
  "credentials: 'include'",
  'CUSTOMER_TRANSPORT_INVALIDATION_GROUP',
  'clearStaffTransport',
  'safeReturnPath',
  'fileTransferReducer',
  "path: '/api/customer-auth/logout'",
  'staffProviderOrigin',
  'data.session',
], 'required Wave 14A boundary');

requireText(mswServer, [
  "from 'msw/node'",
  'setupServer(...handlers)',
], 'formal MSW server');
requireText(mswHandlers, [
  "from 'msw'",
  'http.get',
  'http.post',
  'HttpResponse.json',
  'export const handlers',
], 'formal MSW handlers');
requireText(mswFixtures, [
  'customerSessionEnvelopeFixture',
  'staffSessionEnvelopeFixture',
  'data: { session }',
  'malformedFixtures',
  'flatCustomerSession',
  'flatStaffSession',
], 'typed MSW fixtures');
requireText(mswLifecycle, [
  'beforeAll(() => {',
  "server.listen({ onUnhandledRequest: 'error' })",
  'afterEach(() => {',
  'server.resetHandlers()',
  'afterAll(() => {',
  'server.close()',
], 'strict MSW lifecycle');
if (mswTestFiles.length < 5) {
  throw new Error(`formal MSW test files missing: found ${mswTestFiles.length}`);
}
for (const file of mswTestFiles) {
  const body = readFileSync(file, 'utf8');
  if (!body.includes('msw/lifecycle')) {
    throw new Error(`MSW test bypasses unified lifecycle: ${file}`);
  }
}
if (/globalThis\.fetch\s*=|global\.fetch\s*=|vi\.stubGlobal\(['"]fetch/u.test(mswTests)) {
  throw new Error('formal MSW evidence must not stub global fetch');
}
requireText(mswTests, [
  "credentials).toBe('include')",
  "request.headers.get('Idempotency-Key')",
  'safeDetails',
  "shouldRetryQuery(0, new Error('unknown'))",
  'request-customer-401',
  'activeCanceled',
  'expectOnlyStaff(client)',
  'request-staff-401',
  'request-protected-${status}',
  "['customer', '/api/buyer-portal/me', 403, 'FORBIDDEN']",
  "['staff', '/api/staff/me/assignments', 404, 'NOT_FOUND']",
  'internal-communication-files',
  "code: 'NETWORK_FAILURE'",
], 'formal MSW network evidence');
if (!mswTests.includes('apiRequest({')
  || !mswTests.includes('customerAuthApi')
  || !mswTests.includes('staffAuthApi')) {
  throw new Error('formal MSW tests must traverse apiRequest and real Auth adapters');
}
const phantomRoute = '/api/staff/order-evidence/:id/internal-communication-files';
if (source.includes(phantomRoute) || mswHandlers.includes('internal-communication-files')) {
  throw new Error('phantom internal-communication route must have no production call or MSW handler');
}
requireText(app, [
  'path="/buyer/login"',
  'path="/seller/login"',
  'path="/buyer/change-password"',
  'path="/seller/change-password"',
  'CustomerSessionBoundary target="buyer"',
  'CustomerSessionBoundary target="seller"',
], 'Customer route boundary');
requireText(app, [
  'path="/buyer/change-password" element={<CustomerPasswordRouteBoundary target="buyer"><CustomerChangePasswordPage target="buyer" /></CustomerPasswordRouteBoundary>}',
  'path="/seller/change-password" element={<CustomerPasswordRouteBoundary target="seller"><CustomerChangePasswordPage target="seller" /></CustomerPasswordRouteBoundary>}',
], 'Customer password route guard');
if (/path="\/(buyer|seller)\/change-password"\s+element=\{<CustomerChangePasswordPage/u.test(app)) {
  throw new Error('Customer password page must not be mounted without its route boundary');
}
requireText(customerInvalidation, [
  'queryKeys.buyer.root',
  'queryKeys.seller.root',
  'client.cancelQueries',
  'client.removeQueries',
], 'Customer two-root invalidation');
if (customerInvalidation.includes('queryKeys.staff.root')) {
  throw new Error('Customer invalidation must not clear Staff');
}
requireText(mismatch, [
  "'IDLE'",
  "'CLEANING'",
  "'CLEANED'",
  "'FAILED'",
  'activeCleanup',
  'CUSTOMER_TRANSPORT_INVALIDATION_GROUP.clear',
  'this.api.logout()',
  'retry()',
], 'Customer mismatch cleanup coordinator');
requireText(sessionController, [
  'CustomerMismatchCleanupCoordinator',
  'query.data.account_type !== expectedAccountType(target)',
  'coordinator.clean()',
  "cleanup.state === 'CLEANING'",
  "cleanup.state === 'FAILED'",
], 'Customer Session mismatch cleanup');
requireText(passwordController, [
  "'IDLE'",
  "'EDITING'",
  "'SUBMITTING'",
  "'FAILED_RETRYABLE'",
  "'FAILED_TERMINAL'",
  "'SUCCESS'",
  "'CANCELED'",
  'idempotencyKey',
  'bodyFingerprint',
  'lastSafeError',
  'requestId',
  'operation.idempotencyKey',
  'this.api.readSession(signal)',
  "error.code === 'IDEMPOTENCY_CONFLICT'",
  "error.code === 'REQUEST_IN_PROGRESS'",
  'password_change_required',
], 'Customer password operation lifecycle');
if (/function submit[\s\S]{0,1200}crypto\.randomUUID/u.test(passwordPage)) {
  throw new Error('password submit must not generate a new Idempotency-Key on every attempt');
}
requireText(passwordRouteBoundary, [
  'useCustomerPasswordRouteController(target, adapter)',
  "route.status === 'MISMATCH_CLEANING'",
  "route.status === 'MISMATCH_CLEANUP_FAILED'",
  "route.status === 'DEPENDENCY_ERROR'",
  '<Navigate to={`/${target}/login`}',
  '重新清理',
], 'Customer password route boundary');
if (passwordRouteBoundary.includes('change-password')) {
  throw new Error('Customer password route boundary must not redirect to itself');
}
requireText(passwordRouteController, [
  "status: 'LOADING'",
  "status: 'ALLOWED'",
  "status: 'UNAUTHENTICATED'",
  "status: 'MISMATCH_CLEANING'",
  "status: 'MISMATCH_CLEANUP_FAILED'",
  "status: 'DEPENDENCY_ERROR'",
  'adapter.readSession(signal)',
  'query.data.account_type !== expectedAccountType(target)',
  'CustomerMismatchCleanupCoordinator',
  'coordinator.clean()',
  'CUSTOMER_TRANSPORT_INVALIDATION_GROUP.clear(client)',
  "query.error.httpStatus === 401",
], 'Customer password route controller');
if (/clearStaffTransport|queryKeys\.staff/u.test(passwordRouteController)) {
  throw new Error('Customer password route boundary must not clear Staff');
}

requireText(tests, [
  "createAdapter('SELLER_MEMBER'",
  "createAdapter('BUYER'",
  'request-cleanup',
  'request-session-cleanup',
  "getQueryData(['buyer', 'fixture'])",
  "getQueryData(['seller', 'fixture'])",
  "getQueryData(['staff', 'fixture'])",
  "['operation-key-1', 'operation-key-1']",
  "['operation-key-1', 'operation-key-2']",
  'view.rerender',
  "'IDEMPOTENCY_CONFLICT'",
  "'REQUEST_IN_PROGRESS'",
  "session('BUYER', true)",
  "queryByText('SELLER SHELL')",
], 'Customer auth chain-test evidence');
requireText(passwordRouteTests, [
  "'UNAUTHENTICATED', 401",
  "session('BUYER', true)",
  "session('SELLER_MEMBER', true)",
  "session('BUYER', false)",
  "session('SELLER_MEMBER', false)",
  'request-route-cleanup',
  'request-route-503',
  "getQueryData(['buyer', 'fixture'])",
  "getQueryData(['seller', 'fixture'])",
  "getQueryData(['staff', 'fixture'])",
  'view.rerender',
  'toHaveBeenCalledOnce()',
  "queryByRole('link', { name: /卖家/u })",
], 'Customer password route chain-test evidence');

for (const obsolete of [
  'correct entry',
  'correct identity entry',
  'Buyer entry action',
  'Seller entry action',
  'safe mismatch notice and correct entry link',
  '正确身份入口',
  '正确买家入口',
  '正确卖家入口',
]) {
  if (changeSource.toLowerCase().includes(obsolete.toLowerCase())) {
    throw new Error(`obsolete Wave 14A login semantics remain: ${obsolete}`);
  }
}
requireText(changeSource, [
  '请使用工作人员发送的专属链接登录。',
  '`/buyer/login`, `/seller/login`, and `/staff/login` remain directly reachable',
  'dedicated Customer password route boundary',
], 'Wave 14A dedicated-link and password-route semantics');

const rootEntry = app.match(/export function RootEntry\(\)[\s\S]*?\n}/)?.[0] ?? '';
for (const forbiddenRootControl of ['买家入口', '卖家入口', '员工入口', '<Link', '<NavLink']) {
  if (rootEntry.includes(forbiddenRootControl)) throw new Error(`root dedicated-link violation: ${forbiddenRootControl}`);
}
const browserFixtures = readFileSync(join(workspace, 'apps/web/e2e/foundation.spec.ts'), 'utf8');
if (!browserFixtures.includes('data: { session }')) throw new Error('Playwright fixture must use data.session');
if (!existsSync(join(workspace, 'apps/web/dist/index.html'))) {
  process.stdout.write('Wave 14A Customer auth source, route, lifecycle, and test verifier passed (build artifact not present).\n');
} else {
  process.stdout.write('Wave 14A Customer auth source, route, lifecycle, test, and build verifier passed.\n');
}
