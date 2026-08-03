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
requireText(app, [
  'path="/buyer/login"',
  'path="/seller/login"',
  'path="/buyer/change-password"',
  'path="/seller/change-password"',
  'CustomerSessionBoundary target="buyer"',
  'CustomerSessionBoundary target="seller"',
], 'Customer route boundary');
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
