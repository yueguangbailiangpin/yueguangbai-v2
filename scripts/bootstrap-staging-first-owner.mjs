import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import { CloudflareD1RestDatabase } from './cloudflare-d1-rest-database.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIRMATION = 'STAGING_FIRST_OWNER';

export function inspectStagingFirstOwnerBootstrap() {
  return {
    status: 'BLOCKED_NEEDS_OPERATOR_INPUT',
    environment: 'staging',
    required_fields: [
      'account_id',
      'database_id',
      'database_name',
      'external_input_file.display_name',
      'external_input_file.email',
      'external_input_file.idempotency_key',
    ],
    required_confirmation: CONFIRMATION,
    authentication: 'WRANGLER_OAUTH_OR_CLOUDFLARE_API_TOKEN',
    remote_writes: 0,
  };
}

export function parseBootstrapArguments(argv) {
  if (argv.length === 1 && argv[0] === '--inspect') return { mode: 'inspect' };
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || !value || values.has(key)) argumentError();
    values.set(key, value);
  }
  const allowed = new Set([
    '--execute', '--account-id', '--database-id', '--database-name', '--input',
  ]);
  if ([...values.keys()].some((key) => !allowed.has(key))
    || values.get('--execute') !== CONFIRMATION) argumentError();
  const accountId = values.get('--account-id') ?? '';
  const databaseId = values.get('--database-id') ?? '';
  const databaseName = values.get('--database-name') ?? '';
  const inputFile = values.get('--input') ?? '';
  if (!/^[0-9a-f]{32}$/u.test(accountId)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(databaseId)
    || !/^yueguangbai-v2-staging(?:-[a-z0-9-]+)?$/u.test(databaseName)
    || !path.isAbsolute(inputFile)) argumentError();
  return { mode: 'execute', accountId, databaseId, databaseName, inputFile };
}

export function readExternalBootstrapInput(file) {
  let lexical;
  let real;
  try {
    lexical = path.resolve(file);
    real = realpathSync.native(lexical);
  } catch { throw new Error('input_file_unreadable'); }
  const relativeLexical = path.relative(repositoryRoot, lexical);
  const relativeReal = path.relative(repositoryRoot, real);
  if (inside(relativeLexical) || inside(relativeReal)) throw new Error('input_file_repository_location_forbidden');
  let stat;
  try { stat = statSync(real); } catch { throw new Error('input_file_unreadable'); }
  const currentUid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (!stat.isFile() || (stat.mode & 0o077) !== 0
    || (currentUid !== null && stat.uid !== currentUid)) {
    throw new Error('input_file_permissions_unsafe');
  }
  let value;
  try { value = JSON.parse(readFileSync(real, 'utf8')); }
  catch { throw new Error('input_file_invalid'); }
  const keys = value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value).sort()
    : [];
  if (keys.join(',') !== 'display_name,email,idempotency_key'
    || typeof value.display_name !== 'string'
    || typeof value.email !== 'string'
    || typeof value.idempotency_key !== 'string') {
    throw new Error('input_file_invalid');
  }
  return {
    displayName: value.display_name,
    email: value.email,
    idempotencyKey: value.idempotency_key,
  };
}

export async function executeStagingFirstOwnerBootstrap(options, dependencies = {}) {
  const token = dependencies.token ?? readWranglerToken();
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const input = readExternalBootstrapInput(options.inputFile);
  await assertRemoteDatabaseIdentity(options, token, fetchImpl);
  const database = new CloudflareD1RestDatabase({
    accountId: options.accountId,
    databaseId: options.databaseId,
    token,
    fetchImpl,
  });
  let sourceLoader = null;
  let bootstrap = dependencies.bootstrap;
  if (!bootstrap) {
    sourceLoader = await createServer({
      root: repositoryRoot,
      configFile: false,
      appType: 'custom',
      server: { middlewareMode: true, hmr: false },
    });
    ({ bootstrapStagingFirstOwner: bootstrap } = await sourceLoader.ssrLoadModule(
      '/apps/api/src/staging-bootstrap/first-owner.ts',
    ));
  }
  let result;
  try {
    result = await bootstrap(database, {
      environment: 'staging',
      databaseName: options.databaseName,
      databaseId: options.databaseId,
      ...input,
    });
  } finally {
    await sourceLoader?.close();
  }
  return {
    status: 'STAGING_FIRST_OWNER_BOOTSTRAPPED',
    staff_id: result.staff_id,
    role_code: result.role_code,
    remote_writes: 1,
    production_touched: false,
  };
}

async function assertRemoteDatabaseIdentity(options, token, fetchImpl) {
  const response = await fetchImpl(
    `https://api.cloudflare.com/client/v4/accounts/${options.accountId}/d1/database/${options.databaseId}`,
    { headers: { Authorization: `Bearer ${token}` } },
  ).catch(() => null);
  if (!response?.ok) throw new Error('staging_database_identity_unverified');
  const envelope = await response.json().catch(() => null);
  if (envelope?.success !== true
    || envelope?.result?.uuid !== options.databaseId
    || envelope?.result?.name !== options.databaseName
    || String(envelope?.result?.name ?? '').includes('production')) {
    throw new Error('staging_database_identity_mismatch');
  }
}

function readWranglerToken() {
  const configured = process.env.CLOUDFLARE_API_TOKEN;
  if (typeof configured === 'string' && configured.length >= 20) return configured;
  const wrangler = path.join(repositoryRoot, 'node_modules', '.bin', 'wrangler');
  const result = spawnSync(wrangler, ['auth', 'token', '--json'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) throw new Error('wrangler_authentication_unavailable');
  let parsed;
  try { parsed = JSON.parse(result.stdout); }
  catch { throw new Error('wrangler_authentication_unavailable'); }
  if (parsed?.type !== 'oauth' || typeof parsed?.token !== 'string' || parsed.token.length < 20) {
    throw new Error('wrangler_authentication_unavailable');
  }
  return parsed.token;
}

function inside(relative) {
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
function argumentError() { throw new Error('invalid_staging_first_owner_arguments'); }

async function main() {
  try {
    const options = parseBootstrapArguments(process.argv.slice(2));
    const report = options.mode === 'inspect'
      ? inspectStagingFirstOwnerBootstrap()
      : await executeStagingFirstOwnerBootstrap(options);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      status: 'BLOCKED',
      reason: safeReason(error),
      production_touched: false,
    }, null, 2));
    process.exitCode = 1;
  }
}

function safeReason(error) {
  const known = new Set([
    'invalid_staging_first_owner_arguments',
    'input_file_repository_location_forbidden',
    'input_file_permissions_unsafe',
    'input_file_unreadable',
    'input_file_invalid',
    'wrangler_authentication_unavailable',
    'staging_database_identity_unverified',
    'staging_database_identity_mismatch',
    'INVALID_STAGING_TARGET',
    'INVALID_INPUT',
    'SCHEMA_NOT_READY',
    'STAFF_AUTHORITY_NOT_EMPTY',
    'STAGING_FOUNDATION_NOT_EMPTY',
    'IDEMPOTENCY_CONFLICT',
    'REQUEST_IN_PROGRESS',
    'DEPENDENCY_UNAVAILABLE',
  ]);
  const message = error instanceof Error ? error.message : '';
  return known.has(message) ? message : 'staging_first_owner_failed';
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
