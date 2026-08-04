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
const customerRaceTests = readFileSync(join(customerRoot, 'customer-cache-race.msw.test.tsx'), 'utf8');
const staffSessionController = readFileSync(join(webRoot, 'auth/session.ts'), 'utf8');
const staffSessionTests = readFileSync(join(webRoot, 'auth/staff/staff-auth.msw.test.tsx'), 'utf8');
const identityRequest = readFileSync(join(webRoot, 'api/identity-request.ts'), 'utf8');
const protectedResources = readFileSync(join(webRoot, 'api/protected-resources.ts'), 'utf8');
const protectedResourceTests = readFileSync(join(webRoot, 'auth/protected-errors.msw.test.tsx'), 'utf8');
const sessionInvalidation = readFileSync(join(webRoot, 'auth/session-invalidation.ts'), 'utf8');
const mountedProtectedTests = readFileSync(join(webRoot, 'auth/mounted-protected-session.msw.test.tsx'), 'utf8');
const staffSessionBoundary = readFileSync(join(webRoot, 'auth/staff/StaffSessionBoundary.tsx'), 'utf8');
const mswRoot = join(webRoot, 'test/msw');
const mswServer = readFileSync(join(mswRoot, 'server.ts'), 'utf8');
const mswHandlers = readFileSync(join(mswRoot, 'handlers.ts'), 'utf8');
const mswFixtures = readFileSync(join(mswRoot, 'fixtures.ts'), 'utf8');
const mswLifecycle = readFileSync(join(mswRoot, 'lifecycle.ts'), 'utf8');
const webPackage = JSON.parse(readFileSync(join(workspace, 'apps/web/package.json'), 'utf8'));
const fileRoot = join(webRoot, 'files');
const fileProductionFiles = readdirSync(fileRoot)
  .filter((name) => /\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name));
const fileProduction = fileProductionFiles
  .map((name) => readFileSync(join(fileRoot, name), 'utf8'))
  .join('\n');
const filePurposeConfig = readFileSync(join(fileRoot, 'file-purpose-config.ts'), 'utf8');
const fileContracts = readFileSync(join(fileRoot, 'file-contracts.ts'), 'utf8');
const fileDescriptor = readFileSync(join(fileRoot, 'file-descriptor.ts'), 'utf8');
const fileUploadApi = readFileSync(join(fileRoot, 'file-upload-api.ts'), 'utf8');
const fileUploadTransport = readFileSync(join(fileRoot, 'file-upload-transport.ts'), 'utf8');
const fileUploadController = readFileSync(join(fileRoot, 'file-upload-controller.ts'), 'utf8');
const fileUploadOperation = readFileSync(join(fileRoot, 'file-upload-operation.ts'), 'utf8');
const fileTransferMachine = readFileSync(join(fileRoot, 'file-transfer-machine.ts'), 'utf8');
const fileUploadHarness = readFileSync(join(fileRoot, 'file-upload-test-harness.tsx'), 'utf8');
const fileUploadTests = readdirSync(fileRoot)
  .filter((name) => /\.(test|spec)\.(ts|tsx)$/.test(name))
  .map((name) => readFileSync(join(fileRoot, name), 'utf8'))
  .join('\n');
const fileReadApi = readFileSync(join(fileRoot, 'file-read-api.ts'), 'utf8');
const fileReadContracts = readFileSync(join(fileRoot, 'file-read-contracts.ts'), 'utf8');
const fileReadController = readFileSync(join(fileRoot, 'file-read-controller.ts'), 'utf8');
const fileReadMachine = readFileSync(join(fileRoot, 'file-read-machine.ts'), 'utf8');
const fileReadOperation = readFileSync(join(fileRoot, 'file-read-operation.ts'), 'utf8');
const fileReadTransport = readFileSync(join(fileRoot, 'file-read-transport.ts'), 'utf8');
const fileReadHarness = readFileSync(join(fileRoot, 'file-read-test-harness.tsx'), 'utf8');
const fileReadTests = readFileSync(join(fileRoot, 'file-read-controller.msw.test.tsx'), 'utf8');
const primitives = readFileSync(join(webRoot, 'ui/primitives.tsx'), 'utf8');
const primitiveTests = readFileSync(join(webRoot, 'ui/primitives.test.tsx'), 'utf8');
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
if (/error\.(?:stack|message)|String\(error\)|JSON\.stringify\(error\)/u.test(source)) {
  throw new Error('raw exception diagnostics must not enter production UI output');
}

requireText(source, [
  "credentials: 'include'",
  'CUSTOMER_TRANSPORT_INVALIDATION_GROUP',
  'clearStaffTransport',
  'safeReturnPath',
  'assertFileUploadTransition',
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
  'request-${identity}-protected-${status}',
  "['buyer', '/api/buyer-portal/me']",
  "['seller', '/api/seller-portal/me']",
  "['staff', '/api/staff/me/assignments']",
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

function requireFreshSessionGate(controller, label, successResult) {
  requireText(controller, [
    "refetchOnMount: 'always'",
    'query.isFetchedAfterMount',
    '!query.isFetching',
    'freshSessionResolved',
    'if (!freshSessionResolved)',
    successResult,
  ], `${label} fresh Session gate`);
  const gate = controller.lastIndexOf('if (!freshSessionResolved)');
  const authorization = controller.lastIndexOf(successResult);
  if (gate < 0 || authorization <= gate) {
    throw new Error(`${label} authorizes cached Session data before the current mount resolves`);
  }
}

function require401ClearBeforeUnauthenticated(
  controller,
  label,
  clearingState,
  clearCall,
  clearedState,
  failedState,
) {
  const start = controller.indexOf('query.error.httpStatus === 401');
  const clearing = controller.indexOf(clearingState, start);
  const clear = controller.indexOf(clearCall, clearing);
  const cleared = controller.indexOf(clearedState, clear);
  if (start < 0 || clearing < start || clear < clearing || cleared < clear) {
    throw new Error(`${label} 401 does not enter clearing and await cache removal before unauthenticated state`);
  }
  requireText(controller, [
    ".catch(() => {",
    failedState,
  ], `${label} 401 cleanup failure state`);
}

requireFreshSessionGate(
  sessionController,
  'Customer protected Session',
  "return { status: 'AUTHENTICATED', value: query.data",
);
requireFreshSessionGate(
  passwordRouteController,
  'Customer password route Session',
  "return { status: 'ALLOWED', session: query.data }",
);
requireFreshSessionGate(
  staffSessionController,
  'Staff protected Session',
  "return { status: 'AUTHENTICATED', value: query.data }",
);
require401ClearBeforeUnauthenticated(
  sessionController,
  'Customer protected Session',
  "state: 'CLEARING'",
  'CUSTOMER_TRANSPORT_INVALIDATION_GROUP.clear(client)',
  "state: 'CLEARED'",
  "state: 'FAILED'",
);
require401ClearBeforeUnauthenticated(
  passwordRouteController,
  'Customer password route Session',
  "state: 'CLEARING'",
  'CUSTOMER_TRANSPORT_INVALIDATION_GROUP.clear(client)',
  "state: 'CLEARED'",
  "state: 'FAILED'",
);
require401ClearBeforeUnauthenticated(
  staffSessionController,
  'Staff protected Session',
  "setClearing({ state: 'CLEARING'",
  'clearStaffTransport(client)',
  "setClearing({ state: 'CLEARED'",
  "setClearing({ state: 'FAILED'",
);

requireText(customerRaceTests, [
  'sessionGate',
  'sessionRequestStarted',
  "screen.queryByText(shell)).not.toBeInTheDocument()",
  "['buyer', buyerSessionFixture, 'BUYER SHELL']",
  "['seller', sellerSessionFixture, 'SELLER SHELL']",
  'PASSWORD FORM',
  'request-fresh-${target}-503',
  'loginSnapshots).toEqual([0])',
  'cancelQueries).toHaveBeenCalledTimes(2)',
], 'Customer fresh Session and 401 ordering evidence');
requireText(staffSessionTests, [
  'request-fresh-staff',
  "queryByText('STAFF SHELL')",
  'loginSnapshots).toEqual([0])',
  'cancelQueries).toHaveBeenCalledOnce()',
  "findByText('DEPENDENCY_ERROR')",
], 'Staff fresh Session and 401 ordering evidence');

requireText(identityRequest, [
  'identity: RequestIdentity',
  'client: QueryClient',
  'request: ApiRequest<T>',
  'withIdentity401Invalidation<T>',
  'operation: () => Promise<T>',
  'return await operation()',
  'withIdentity401Invalidation(identity, client, () => apiRequest(request))',
  'error.httpStatus === 401',
  'captureSessionCycle(client, identity)',
  'invalidateSessionCycle(client, identity, requestCycle, error.requestId)',
  'finally {',
  'throw error',
], 'identity-aware protected request boundary');
if ((identityRequest.match(/\bapiRequest\(/gu) ?? []).length !== 1) {
  throw new Error('identityApiRequest must call the unique apiRequest transport exactly once');
}
if (/apiRequest|CUSTOMER_TRANSPORT_INVALIDATION_GROUP|clearStaffTransport/u.test(
  protectedResources.replaceAll('identityApiRequest', ''),
)) {
  throw new Error('protected resource adapters must not bypass or duplicate identityApiRequest invalidation');
}
requireText(protectedResources, [
  "identityApiRequest(\n    'buyer'",
  "identityApiRequest(\n    'seller'",
  "identityApiRequest(\n    'staff'",
  "path: '/api/buyer-portal/me'",
  "path: '/api/seller-portal/me'",
  "path: '/api/staff/me/assignments'",
], 'real protected resource adapters');
if ((protectedResources.match(/\bidentityApiRequest\(/gu) ?? []).length !== 3) {
  throw new Error('each real protected resource adapter must cross identityApiRequest exactly once');
}
for (const file of files) {
  const body = readFileSync(file, 'utf8');
  if (/\/api\/(?:buyer-portal|seller-portal|staff\/)/u.test(body)
    && /\b(?:apiRequest|fetch|XMLHttpRequest)\b/u.test(body)
    && !body.includes('identityApiRequest')
    && !body.includes('withIdentity401Invalidation')) {
    throw new Error(`protected business adapter bypasses identityApiRequest: ${file}`);
  }
}

if (webPackage.dependencies?.['@ygb/contracts'] !== '0.1.0') {
  throw new Error('apps/web must declare exact @ygb/contracts 0.1.0 direct dependency');
}
requireText(filePurposeConfig, [
  'FILE_UPLOAD_WORKFLOW_KEYS',
  "'buyerOrderEvidence'",
  "'buyerReviewEvidence'",
  "'sellerProductApplicationImage'",
  "'staffBuyerRefundProof'",
  "'staffSellerSettlementProof'",
  'maximumFileCount: 1',
  'maximumFileCount: 10',
  'maximumFileCount: 8',
  'maximumFileCount: 6',
  'maximumByteSize: 10 * MEBIBYTE',
  'maximumByteSize: 20 * MEBIBYTE',
  'requireFileUploadWorkflow(',
  'unsupported_file_upload_workflow',
], 'five fixed Purpose-bound upload policies');
if ((filePurposeConfig.match(/identity:/gu) ?? []).length !== 6
  || (filePurposeConfig.match(/intentPath:/gu) ?? []).length !== 6
  || (filePurposeConfig.match(/lifecyclePrefix:/gu) ?? []).length !== 6
  || (filePurposeConfig.match(/purpose:/gu) ?? []).length !== 6
  || (filePurposeConfig.match(/visibility:/gu) ?? []).length !== 6) {
  throw new Error('file upload workflow config must contain exactly five concrete entries');
}
for (const deferred of [
  'ORDER_EVIDENCE_INTERNAL_COMMUNICATION',
  'PRODUCT_IMAGE',
  'ORDER_INSTRUCTION_KEYWORD_IMAGE',
  'SUPPORT_ATTACHMENT',
]) {
  if (fileProduction.includes(deferred)) {
    throw new Error(`unsupported file workflow leaked into production Web: ${deferred}`);
  }
}
requireText(fileDescriptor, [
  'validateFileSelection(',
  'descriptorForFile(',
  'duplicate_file_object',
  'duplicate_file_descriptor',
  'extension_mime_mismatch',
  'file_size_exceeded',
  'file.size < 1',
], 'client file descriptor validation');
if (/packages\/domain|@ygb\/domain/u.test(fileProduction)) {
  throw new Error('Web file client must not import Domain implementation');
}
requireText(fileContracts, [
  'uploadIntentRequestSchema',
  'uploadIntentResponseSchema',
  'uploadContentResponseSchema',
  'completeUploadRequestSchema',
  'completeUploadResponseSchema',
  '.strict()',
  'Number.MAX_SAFE_INTEGER',
  '/^[a-f0-9]{64}$/u',
  'assertIntentMatchesWorkflow(',
  'assertCompleteMatchesIntent(',
  'uploadedReceipts.get(file.file_object_id)',
  'result.version !== input.intentVersion + 1',
  'file.detected_mime !== receipt.detectedMime',
  'file.byte_size !== receipt.byteSize',
  'file.sha256 !== receipt.sha256',
  'file.version !== receipt.uploadedVersion + 1',
], 'strict file upload DTO and Manifest schemas');
requireText(fileUploadApi, [
  'identityApiRequest(',
  'input.workflow.intentPath',
  'input.workflow.lifecyclePrefix',
  'expected_version',
  'operationHeaders(',
  'assertIntentMatchesWorkflow(',
  'assertCompleteMatchesIntent(',
], 'purpose-bound Intent and Complete adapters');
requireText(fileUploadTransport, [
  'new XMLHttpRequest()',
  "xhr.open('PUT', path)",
  'xhr.withCredentials = true',
  "xhr.setRequestHeader('X-Upload-Token'",
  "xhr.setRequestHeader('Idempotency-Key'",
  "formData.append('file', input.file)",
  'xhr.upload.onprogress',
  'measuredUploadProgress(event)',
  "mode: 'INDETERMINATE'",
  'input.signal.addEventListener',
  'xhr.abort()',
  'withIdentity401Invalidation(',
  'parseApiSuccessEnvelope(',
  'parseApiFailureEnvelope(',
], 'single-file credentialed XHR upload transport');
if ((fileUploadTransport.match(/\.append\(/gu) ?? []).length !== 1) {
  throw new Error('multipart transport must append exactly one form part');
}
if (/setRequestHeader\(['"]Content-Type/iu.test(fileUploadTransport)) {
  throw new Error('multipart transport must leave Content-Type boundary to the browser');
}
requireText(fileUploadOperation, [
  "'RESTART_REQUIRED'",
  "'FILE_COMPENSATION_REQUIRED'",
  "'DEPENDENCY_UNAVAILABLE'",
  'SafeVerifiedManifest',
  'file_version',
  'restartRequired: boolean',
  'canCancel: boolean',
  'canStartNewOperation: boolean',
  'canReplaceFiles: boolean',
  'requiresFileReselection: boolean',
  "'FILE_NOT_VERIFIED'",
], 'safe file upload operation snapshot');
for (const secretField of ['uploadToken', 'idempotencyKey', 'File;']) {
  if (fileUploadOperation.includes(secretField)) {
    throw new Error(`public upload snapshot exposes private operation material: ${secretField}`);
  }
}
requireText(fileUploadController, [
  'private createKey:',
  'private completeKey:',
  'uploadToken: string | null',
  'idempotencyKey: string | null',
  'replaceFiles(',
  'this.cancel()',
  'result.data.replayed',
  "'UPLOAD_INTENT_REPLAYED'",
  "'FILE_UPLOAD_EXPIRED'",
  "'IDEMPOTENCY_CONFLICT'",
  "'REQUEST_IN_PROGRESS'",
  "'FILE_COMPENSATION_REQUIRED'",
  "state: 'VERIFIED'",
  'completePurposeBoundUploadIntent({',
  'file_version: file.version',
  'receipt: UploadedFileReceipt | null',
  'slot.receipt = Object.freeze({',
  'uploadedReceipts: new Map(',
  'releaseAllSlotAuthorities()',
  'slot.uploadToken = null',
  'slot.idempotencyKey = null',
  'isAmbiguousRemoteResult(apiError)',
  "apiError.code === 'FILE_NOT_VERIFIED'",
  "this.publishFailure(apiError, 'FILE_NOT_VERIFIED', false, true)",
  'if (!this.snapshot.canCancel) return',
  'this.completeKey ??= this.generateKey()',
  'requiresFileReselection',
  'start(workflowKey: unknown',
  'if (!this.snapshot.canStartNewOperation)',
  'if (!this.snapshot.canReplaceFiles)',
  'this.isCompleteRecoveryLocked()',
  "this.retryStage === 'COMPLETE'",
  'canStartNewOperation: this.canStartNewOperation(snapshot)',
  'canReplaceFiles: this.canReplaceFiles(snapshot)',
  'if (error instanceof FileUploadTransitionError) throw error',
], 'private upload Controller lifecycle');
requireText(fileTransferMachine, [
  'FILE_UPLOAD_TRANSITIONS',
  'FileUploadTransitionError',
  'assertFileUploadTransition(',
  "COMPLETING: stateSet(",
  "FILE_COMPENSATION_REQUIRED: stateSet()",
  "next.state === 'COMPLETING'",
  "slot.state !== 'UPLOADED'",
  "next.state === 'VERIFIED'",
  'options.completeValidated !== true',
], 'authoritative file upload transition guard');
if (fileTransferMachine.includes('fileTransferReducer')
  || fileUploadTests.includes('fileTransferReducer')) {
  throw new Error('decorative fileTransferReducer must not remain in production or tests');
}
if ((fileTransferMachine.match(/FILE_UPLOAD_TRANSITIONS\s*:/gu) ?? []).length !== 1) {
  throw new Error('file upload must define exactly one authoritative transition table');
}
if (/COMPLETING:[^\n]*CANCEL|FILE_COMPENSATION_REQUIRED:[^\n]*CANCEL/iu.test(fileTransferMachine)) {
  throw new Error('Completing and compensation terminal states must not transition to CANCELED');
}
requireText(fileUploadHarness, [
  'disabled={!snapshot.canCancel}',
  'disabled={!snapshot.canReplaceFiles}',
  'props.controller.cancel()',
], 'file upload cancel capability projection');
const startCapabilityGuard = fileUploadController.indexOf('if (!this.snapshot.canStartNewOperation)');
const workflowValidation = fileUploadController.indexOf('workflow = requireFileUploadWorkflow(workflowKey)');
const firstPrivateRelease = fileUploadController.indexOf('this.releasePrivateState(true)', startCapabilityGuard);
if (startCapabilityGuard < 0 || workflowValidation < startCapabilityGuard
  || firstPrivateRelease < workflowValidation) {
  throw new Error('start must enforce operation lock and runtime workflow validation before releasing state');
}
const replaceCapabilityGuard = fileUploadController.indexOf('if (!this.snapshot.canReplaceFiles)');
const replaceCancel = fileUploadController.indexOf('this.cancel()', replaceCapabilityGuard);
if (replaceCapabilityGuard < 0 || replaceCancel < replaceCapabilityGuard) {
  throw new Error('replaceFiles must enforce its public capability before releasing upload authority');
}
const restartMethod = fileUploadController.indexOf('restart(): Promise<void>');
const restartLock = fileUploadController.indexOf('this.isCompleteRecoveryLocked()', restartMethod);
const restartRelease = fileUploadController.indexOf('this.releaseIntentSecrets()', restartMethod);
if (restartMethod < 0 || restartLock < restartMethod || restartRelease < restartLock) {
  throw new Error('restart must preserve a locked Complete recovery context');
}
const cancelGuard = fileUploadController.indexOf('if (!this.snapshot.canCancel) return');
const cancelAbort = fileUploadController.indexOf('this.abortController?.abort()', cancelGuard);
if (cancelGuard < 0 || cancelAbort < cancelGuard) {
  throw new Error('Controller must reject illegal cancel before aborting an operation');
}
const compensationBranch = fileUploadController.indexOf("apiError.code === 'FILE_COMPENSATION_REQUIRED'");
const compensationRelease = fileUploadController.indexOf('this.releasePrivateState(true)', compensationBranch);
const compensationPublish = fileUploadController.indexOf("'FILE_COMPENSATION_REQUIRED'", compensationRelease);
if (compensationBranch < 0 || compensationRelease < compensationBranch
  || compensationPublish < compensationRelease) {
  throw new Error('Compensation terminal handling must release files and all authority before publishing');
}
const completeCall = fileUploadController.indexOf('completePurposeBoundUploadIntent({');
const verifiedState = fileUploadController.indexOf("state: 'VERIFIED'", completeCall);
if (completeCall < 0 || verifiedState < completeCall) {
  throw new Error('Upload success must not mark VERIFIED before strict Complete');
}
if (/localStorage|sessionStorage|console\.|URLSearchParams/u.test(fileProduction)) {
  throw new Error('file token, key, and bytes must remain private memory only');
}
if (/\/api\/[\s\S]{0,80}(?:link|grant)/iu.test(fileProduction)) {
  throw new Error('general file client must not call Link or Grant endpoints');
}
requireText(fileUploadTests, [
  "import '../test/msw/lifecycle'",
  'Controller to exact Intent/XHR/Complete routes',
  "request.credentials).toBe('include')",
  "request.headers.get('X-Upload-Token')",
  "request.headers.get('Idempotency-Key')",
  "record.uploadParts).toEqual([['file']])",
  'multipart\\/form-data; boundary=',
  'explicit network retry',
  'cancel aborts the active XHR',
  'old upload 401',
  'Upload 401 uses the existing identity cleanup cycle',
  'FILE_COMPENSATION_REQUIRED',
  'VERSION_CONFLICT',
  'REQUEST_IN_PROGRESS',
  'does not show VERIFIED after Upload until Complete succeeds',
  'request-malformed-upload',
  'request-malformed-manifest',
  'keeps VERIFIED and its complete Manifest unchanged when cancel is called',
  'keeps FILE_COMPENSATION_REQUIRED request correlation and rejects terminal actions',
  'does not abort Complete or enter CANCELED while COMPLETING',
  'does not replace files or create another Intent while COMPLETING',
  'publishes accurate canCancel values across the real Controller lifecycle',
  'abandons every old Slot authority after first-slot 401',
  'abandons every old Slot authority after first-slot 422',
  'preserves the current Slot token/key after malformed success',
  'reuses the same Complete key and body after a malformed successful response',
  'enters explicit FILE_NOT_VERIFIED state without automatic Complete retry',
  'rejects Manifest %s mismatch against the Upload receipt',
  'rejects Complete Intent Version that is not Intent version plus one',
  'accepts the exact backend v1→v2 Intent and v2→v3 File evolution',
  'requiresFileReselection: true',
  'expect(keys[0]).toBe(keys[1])',
  'expect(tokens[0]).toBe(tokens[1])',
  "expect(bodies).toEqual([{ expected_version: 1 }, { expected_version: 1 }])",
  'locks %s Complete recovery until explicit retry',
  'canStartNewOperation: false',
  'canReplaceFiles: false',
  'keeps start, replace, and restart occupied by an in-flight Complete',
  'allows VERIFIED to begin a separate Intent with new operation keys',
  'allows a fresh selection after FILE_VALIDATION_FAILED releases the old upload',
  'explicitly replaces an ambiguous Upload and creates a new Intent/key',
  'allows a new start only after ambiguous Upload is explicitly canceled',
  'deferred internal communication Purpose',
  'ORDER_EVIDENCE_INTERNAL_COMMUNICATION',
  'rejects %s before state or network authority is created',
  "expect(requests).toBe(0)",
  "code: 'VALIDATION_ERROR'",
  "workflow: null",
  'accepts a legal workflow after a rejected runtime workflow',
  'expect(generated).toBe(0)',
], 'formal MSW file upload safety evidence');
if (!fileUploadTests.includes('server.use(')
  || !fileUploadTests.includes('http.put(')
  || !fileUploadTests.includes('FileUploadController')) {
  throw new Error('file upload tests must traverse Controller, XHR, and MSW');
}

requireText(fileReadContracts, [
  'FILE_PURPOSES',
  'FILE_VISIBILITIES',
  'file_object_id: identifier',
  'file_version: positiveSafeInteger',
  'purpose: z.enum(FILE_PURPOSES)',
  'visibility: z.enum(FILE_VISIBILITIES)',
  'expected_file_version: positiveSafeInteger',
  '.strict()',
  'Number.MAX_SAFE_INTEGER',
], 'strict Safe File Reference and Read Intent contracts');
requireText(fileReadApi, [
  "buyer: '/api/buyer-portal'",
  "seller: '/api/seller-portal'",
  "staff: '/api/staff'",
  '/files/${input.reference.file_object_id}/read-intents',
  'identityApiRequest(input.identity, input.client',
  'operationHeaders({ key: input.idempotencyKey, body })',
  'result.data.replayed === result.data.access_token_available',
], 'fixed identity-bound file Read Intent adapter');
requireText(fileReadTransport, [
  'MAXIMUM_FILE_READ_BYTES = 25 * 1024 * 1024',
  "'image/jpeg'",
  "'image/png'",
  "'image/webp'",
  "'application/pdf'",
  '/file-read-intents/${input.readIntentId}/content',
  'approvedApiPath(path)',
  'withIdentity401Invalidation(input.identity, input.client',
  "credentials: 'include'",
  "Accept: 'application/octet-stream'",
  "'X-File-Read-Token': input.accessToken",
  'parseApiFailureEnvelope(',
  "response.headers.get('Content-Length')",
  "cacheDirectives.includes('no-store')",
  "!== 'nosniff'",
  'response.body.getReader()',
  'loadedBytes > totalBytes',
  'loadedBytes !== totalBytes',
  'Math.min(99',
], 'bounded credentialed binary read transport');
requireText(fileReadOperation, [
  "| 'CREATING_READ_INTENT'",
  "| 'READ_READY'",
  "| 'DOWNLOADING'",
  "| 'READY'",
  "| 'RESTART_REQUIRED'",
  "| 'DEPENDENCY_UNAVAILABLE'",
  "| 'FILE_STORAGE_CONFLICT'",
  'ephemeralObjectUrl: string | null',
  'canRetry: boolean',
  'restartRequired: boolean',
], 'safe file read operation snapshot');
for (const privateMaterial of ['accessToken', 'idempotencyKey', 'Uint8Array', 'ArrayBuffer']) {
  if (fileReadOperation.includes(privateMaterial)) {
    throw new Error(`public file read snapshot exposes private material: ${privateMaterial}`);
  }
}
requireText(fileReadController, [
  'private intent: PrivateReadIntent | null',
  'private createKey: string | null',
  'private objectUrl: string | null',
  'this.createKey = this.generateKey()',
  'result.data.replayed',
  "'FILE_READ_INTENT_REPLAYED'",
  "'RESTART_REQUIRED'",
  'this.intent.accessToken = null',
  'const blob = new Blob([result.bytes]',
  'this.objectUrls.createObjectURL(blob)',
  'this.objectUrls.revokeObjectURL(this.objectUrl)',
  "apiError.code === 'RATE_LIMITED'",
  "apiError.httpStatus === 429",
  "apiError.httpStatus === 503",
  "apiError.code === 'FILE_STORAGE_CONFLICT'",
  "apiError.code === 'FILE_UPLOAD_EXPIRED'",
  "apiError.code === 'NETWORK_FAILURE'",
  "apiError.code === 'MALFORMED_RESPONSE'",
  'releaseIntentAuthority()',
  'dispose(): void',
], 'private file read Controller lifecycle');
const verifiedRead = fileReadController.indexOf('const blob = new Blob([result.bytes]');
const createdObjectUrl = fileReadController.indexOf('this.objectUrls.createObjectURL(blob)', verifiedRead);
const readyPublication = fileReadController.indexOf("state: 'READY'", createdObjectUrl);
if (verifiedRead < 0 || createdObjectUrl < verifiedRead || readyPublication < createdObjectUrl) {
  throw new Error('Object URL must be created only after the binary transport verifies all bytes');
}
requireText(fileReadMachine, [
  'FILE_READ_TRANSITIONS',
  'assertFileReadTransition(',
  'readyBytesValidated',
  "next.state === 'READY'",
  'next.ephemeralObjectUrl === null',
  "next.state !== 'READY' && next.ephemeralObjectUrl !== null",
], 'authoritative file read transition guard');
requireText(fileReadHarness, [
  'useSyncExternalStore(',
  'props.controller.dispose()',
  'snapshot.ephemeralObjectUrl',
  'disabled={!snapshot.canRelease}',
], 'file read lifecycle projection');
if (/localStorage|sessionStorage|console\.|URLSearchParams|base64/iu.test(
  fileReadApi + fileReadContracts + fileReadController + fileReadMachine
  + fileReadOperation + fileReadTransport,
)) {
  throw new Error('file read authority and bytes must remain private memory only');
}
requireText(fileReadTests, [
  "import '../test/msw/lifecycle'",
  "it.each(['buyer', 'seller', 'staff'] as const)",
  "request.headers.get('X-File-Read-Token')",
  "request.headers.get('Idempotency-Key')",
  "record.credentials).toEqual(['include', 'include'])",
  "'application/json', 'application/octet-stream'",
  'requires an explicit restart with a fresh key after tokenless replay',
  'rejects %s before object URL creation',
  'over 25 MiB',
  'rejects a body shorter than Content-Length',
  'stops immediately when streamed bytes exceed Content-Length',
  'never publishes 100 before completion',
  'allows explicit same-token retry for clear %i',
  "[409, 'FILE_STORAGE_CONFLICT', 'FILE_STORAGE_CONFLICT', false]",
  "[410, 'FILE_UPLOAD_EXPIRED', 'RESTART_REQUIRED', true]",
  '%s 401 clears only its session domain after invalidation completes',
  'ignores an old download 401 after a fresh session generation is established',
  'revokes on release and revokes the first URL before creating a second',
  'dispose aborts an active operation without creating or leaking a URL',
  'expect(localStorage.length).toBe(0)',
  'expect(sessionStorage.length).toBe(0)',
], 'formal MSW file read safety evidence');
if (!fileReadTests.includes('server.use(')
  || !fileReadTests.includes('FileReadController')
  || !fileReadTests.includes('ReadableStream')) {
  throw new Error('file read tests must traverse Controller, streaming transport, and MSW');
}

for (const primitive of [
  'AppShell', 'IdentityShell', 'PageHeader', 'Sidebar', 'BottomNavigation',
  'StatusBadge', 'Button', 'IconButton', 'TextInput', 'Select', 'SearchInput',
  'Checkbox', 'FormField', 'Card', 'MetricCard', 'DataTable', 'Drawer',
  'Dialog', 'Tabs', 'Pagination', 'Breadcrumb', 'Timeline', 'Progress',
  'Alert', 'Toast', 'EmptyState', 'LoadingState', 'ErrorState',
  'PermissionDenied', 'NotFound', 'DependencyUnavailable',
  'RequestIdDisplay', 'Skeleton',
]) {
  if (!primitives.includes(`export function ${primitive}`)) {
    throw new Error(`shared UI primitive missing: ${primitive}`);
  }
}
requireText(primitives, [
  "addEventListener('keydown'",
  'if (opener?.isConnected) opener.focus()',
  "aria-live={tone === 'danger' ? 'assertive' : 'polite'}",
  "role={tone === 'danger' ? 'alert' : 'status'}",
  "aria-current={page === currentPage ? 'page' : undefined}",
], 'accessible shared UI primitive behavior');
requireText(primitiveTests, [
  'traps Drawer focus, closes on Escape, and restores the opener',
  'cycles Dialog tabs, blocks Escape while busy, then restores focus',
  'moves Tabs with arrows, Home, and End',
  'renders DataTable caption and scoped headers inside an overflow region',
  'renders complete empty/loading/error/403/404/503 states',
  'copies Request ID without exposing any error detail',
], 'shared UI component acceptance evidence');
if (/AuthContext|createContext\s*\([^)]*auth|dispatchEvent\s*\([^)]*auth|addEventListener\s*\([^)]*auth/iu.test(source)) {
  throw new Error('global AuthContext or authentication event invalidation is prohibited');
}
requireText(protectedResourceTests, [
  "['buyer', '/api/buyer-portal/me']",
  "['seller', '/api/seller-portal/me']",
  "['staff', '/api/staff/me/assignments']",
  'cancellationGate',
  'expect(rejected).toBe(false)',
  'expectCustomerClearedStaffPreserved(client)',
  'expectStaffClearedCustomerPreserved(client)',
  'expectEveryIdentityPreserved(client)',
  '[409, \'STATE_CONFLICT\']',
  '[422, \'VALIDATION_ERROR\']',
  '[429, \'RATE_LIMITED\']',
  "[503, 'DEPENDENCY_UNAVAILABLE']",
  "code: 'MALFORMED_RESPONSE'",
  "code: 'NETWORK_FAILURE'",
  "code: 'CANCELED'",
  'request-${identity}-protected-${status}',
], 'protected API identity invalidation and non-401 preservation evidence');

requireText(sessionInvalidation, [
  "type SessionInvalidationStatus = 'STABLE' | 'CLEARING' | 'INVALIDATED' | 'FAILED'",
  'new WeakMap<QueryClient, ClientChannels>()',
  'useSyncExternalStore(',
  'customer: createChannel()',
  'staff: createChannel()',
  'captureSessionCycle(',
  'establishFreshSessionCycle(',
  'current.generation !== requestCycle.generation',
  'channel.active?.generation === generation',
  'return channel.active.promise',
  "publish(channel, { status: 'CLEARING'",
  'remainsCurrent',
  "publish(channel, { status: 'INVALIDATED'",
  "publish(channel, { status: 'FAILED'",
  'retrySessionInvalidation(',
], 'QueryClient-scoped mounted Session invalidation coordinator');
if (/localStorage|sessionStorage|window\.|document\.|dispatchEvent|CustomEvent/iu.test(sessionInvalidation)) {
  throw new Error('mounted Session invalidation must not use storage or window/DOM events');
}
if ((sessionInvalidation.match(/new WeakMap</gu) ?? []).length !== 1) {
  throw new Error('mounted Session invalidation must have one QueryClient-scoped WeakMap');
}
const clearingPublish = sessionInvalidation.indexOf("publish(channel, { status: 'CLEARING'");
const protectedClear = sessionInvalidation.indexOf('clearStaffTransport(client, remainsCurrent)', clearingPublish);
const invalidatedPublish = sessionInvalidation.indexOf("publish(channel, { status: 'INVALIDATED'", protectedClear);
if (clearingPublish < 0 || protectedClear < clearingPublish || invalidatedPublish < protectedClear) {
  throw new Error('mounted protected 401 must publish CLEARING before cleanup and INVALIDATED after cleanup');
}

requireText(staffSessionBoundary, [
  'export function StaffSessionBoundary(',
  'useStaffSession(adapter)',
  "session.status === 'LOADING'",
  "session.status === 'DEPENDENCY_ERROR'",
  'session.cleanupFailed',
  "session.status === 'UNAUTHENTICATED'",
  '<Navigate to={`/staff/login?return_to=${returnTo}`}',
  '重新清理',
], 'independent Staff Session Boundary');
requireText(app, [
  "import { StaffSessionBoundary } from './auth/staff/StaffSessionBoundary'",
  '<StaffSessionBoundary><StaffShell /></StaffSessionBoundary>',
  '<StaffSessionBoundary><Routes>',
], 'App Staff Session Boundary integration');
if (app.includes('function StaffProtected')) {
  throw new Error('Staff Session Boundary must not remain an App-private function');
}

requireText(mountedProtectedTests, [
  "import '../test/msw/lifecycle'",
  'CustomerSessionBoundary',
  'StaffSessionBoundary',
  'protectedResourcesApi.readBuyerMe(client)',
  'protectedResourcesApi.readSellerMe(client)',
  'protectedResourcesApi.readStaffAssignments(client)',
  '<Routes>',
  'MOUNTED SHELL',
  'PRIVATE CONTENT',
  "screen.queryByText(`${label} MOUNTED SHELL`)).not.toBeInTheDocument()",
  "screen.queryByText(`${label} LOGIN`)).not.toBeInTheDocument()",
  'releaseCancellation()',
  "screen.findByText(`${label} LOGIN`)",
  'expectCustomerClearedStaffPreserved(client)',
  'expectStaffClearedCustomerPreserved(client)',
  '并发读取',
  'toHaveBeenCalledTimes(expectedCancellations)',
  'firstGeneration + 1',
  'request-${identity}-stale-401',
  'expect(cancelQueries).not.toHaveBeenCalled()',
  'mounted 403 and 404 keep the authenticated identity Shell',
  "screen.getByText(`${label} PRIVATE CONTENT`)).toBeVisible()",
  '会话清理失败，请重试或刷新',
  "getByRole('button', { name: '重新清理' })",
], 'mounted protected API Session transition evidence');
if (/CUSTOMER_TRANSPORT_INVALIDATION_GROUP|clearStaffTransport/u.test(mountedProtectedTests)) {
  throw new Error('mounted Session transition tests must traverse adapters and Boundaries, not call cleanup directly');
}
if ((mountedProtectedTests.match(/installProtectedFailure\(path, 401/gu) ?? []).length < 2
  || !mountedProtectedTests.includes("installProtectedFailure(path, 401, 'UNAUTHENTICATED'")) {
  throw new Error('Buyer, Seller, and Staff mounted protected 401 chains are incomplete');
}
if ((mountedProtectedTests.match(/\[identity, path, label, 403/gu) ?? []).length !== 1
  || (mountedProtectedTests.match(/\[identity, path, label, 404/gu) ?? []).length !== 1) {
  throw new Error('mounted Buyer, Seller, and Staff 403/404 matrix is incomplete');
}
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
requireText(rootEntry, [
  '>月光白</h1>',
  '请使用工作人员发送的专属链接登录。',
], 'finished dedicated-link root notice');
const browserFixtures = readFileSync(join(workspace, 'apps/web/e2e/foundation.spec.ts'), 'utf8');
if (!browserFixtures.includes('success({ session:')) throw new Error('Playwright fixture must use data.session');
requireText(browserFixtures, [
  'root is a finished dedicated-link notice with no identity controls',
  'Buyer shell is task-focused with five fixed items and no fake business data',
  'Buyer shell keeps navigation clear at 320px and safe content padding',
  'Seller Drawer traps focus, closes with Escape, and restores its opener',
  'Seller small screen uses a card fallback without page overflow',
  'Staff desktop shell preserves queue-detail-action DOM order and separation',
  'Staff narrow shell opens the ordered action Drawer and restores focus',
  'Staff ordinary logout clears the local session before navigation',
  'Staff logout-all requires a busy-safe Dialog and completes explicitly',
  '401 route guard redirects without rendering Buyer shell content',
  'mismatch fails closed, logs out, and returns to the correct login',
  '403 state is durable, explicit, and retains a safe request ID',
  '404 state does not disclose protected resource detail',
  '503 session state is persistent and carries request_id',
  'reduced-motion removes meaningful animation duration',
  '200% equivalent text zoom reflows without critical horizontal clipping',
  'viewport retains the root notice without clipping',
], 'final browser acceptance matrix');
// Twenty-three declarations expand through the three frozen case matrices to
// twenty-nine final Playwright scenarios.
if ((browserFixtures.match(/\btest\(/gu) ?? []).length < 23) {
  throw new Error('final browser acceptance matrix is incomplete');
}
if (!existsSync(join(workspace, 'apps/web/dist/index.html'))) {
  process.stdout.write('Wave 14A auth, upload, read, UI, route, lifecycle, and test verifier passed (build artifact not present).\n');
} else {
  process.stdout.write('Wave 14A auth, upload, read, UI, route, lifecycle, test, and build verifier passed.\n');
}
