import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const rootReal = realpathSync.native(root);
const environments = new Set(['staging', 'production']);
const placeholderPattern = /REQUIRED|REPLACE|PLACEHOLDER|CHANGEME|TODO/iu;
const disabledFlags = [
  'SCHEDULED_OPERATIONS_ENABLED',
  'ACQUISITION_MAINTENANCE_ENABLED',
  'DRIVE_ARCHIVE_ENABLED',
  'DRIVE_ARCHIVE_COPY_ENABLED',
  'DRIVE_ARCHIVE_PROXY_READ_ENABLED',
  'DRIVE_ARCHIVE_R2_DELETE_ENABLED',
  'FEISHU_WORKBENCH_SYNC_ENABLED',
  'FEISHU_WORKBENCH_CALLBACK_ENABLED',
  'STAFF_AUTH_ENABLED',
  'STAFF_MCP_ENABLED',
  'STAFF_MCP_PRODUCTION_TRANSPORT_ENABLED',
  'STAFF_MCP_LOCAL_MOCK_ENABLED',
  'STAFF_MCP_CLEANUP_ENABLED',
];

export const requiredManagedSecrets = Object.freeze({
  initial_auth: Object.freeze([
    'CUSTOMER_SESSION_SECRET',
    'CUSTOMER_SECURITY_TOKEN_SECRET',
    'STAFF_AUTH_HASH_SECRET',
    'STAFF_AUTH_FEISHU_APP_SECRET',
  ]),
  capability_specific_before_separate_approval: Object.freeze([
    'KEYWORD_GENERATOR_SHARED_SECRET',
    'KEYWORD_HMAC_SECRET',
    'GOOGLE_DRIVE_CLIENT_SECRET',
    'GOOGLE_DRIVE_REFRESH_TOKEN',
    'FEISHU_WORKBENCH_APP_SECRET',
    'FEISHU_WORKBENCH_ENCRYPT_KEY',
    'FEISHU_WORKBENCH_VERIFICATION_TOKEN',
    'STAFF_MCP_BINDING_HASH_SECRET',
  ]),
});

export function readLocalReleaseConfig(file) {
  const content = readFileSync(file, 'utf8');
  return JSON.parse(stripJsonComments(content));
}

export function externalReleaseConfigPath(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) {
    return Object.freeze({ file: null, error: 'config_path:not_absolute' });
  }
  const lexical = path.resolve(file);
  if (isWithin(root, lexical)) {
    return Object.freeze({
      file: null,
      error: 'config_path:repository_location_forbidden',
    });
  }
  try {
    const real = realpathSync.native(lexical);
    if (!statSync(real).isFile()) {
      return Object.freeze({
        file: null,
        error: 'config_path:unreadable_or_not_file',
      });
    }
    if (isWithin(rootReal, real)) {
      return Object.freeze({
        file: null,
        error: 'config_path:repository_location_forbidden',
      });
    }
    return Object.freeze({ file: real, error: null });
  } catch {
    return Object.freeze({
      file: null,
      error: 'config_path:unreadable_or_not_file',
    });
  }
}

export function templatePath(environment) {
  requireEnvironment(environment);
  return path.join(root, 'apps/api', `wrangler.${environment}.template.jsonc`);
}

export function inspectReleaseTemplate(environment, file = templatePath(environment)) {
  const config = readLocalReleaseConfig(file);
  const requiredFields = placeholderPaths(config);
  const errors = validateFrozenDefaults(config, environment);
  if (requiredFields.length === 0) errors.push('template.placeholders:missing');
  return Object.freeze({
    status: errors.length === 0
      ? 'BLOCKED_NEEDS_OPERATOR_INPUT'
      : 'INVALID_TEMPLATE',
    environment,
    required_fields: Object.freeze(requiredFields),
    required_managed_secrets: requiredManagedSecrets,
    required_owner_approvals: Object.freeze([
      'cloudflare_account_and_distinct_environment_resources',
      'custom_domain_dns_https_and_route',
      'managed_secret_injection_and_rotation',
      'read_only_production_migration_ledger_check',
      'deployment_and_rollback_window',
      'real_r2_and_network_acceptance',
    ]),
    external_calls: 0,
    deployments: 0,
    resource_mutations: 0,
    errors: Object.freeze(errors),
  });
}

export function validateReleaseConfig(config, environment) {
  requireEnvironment(environment);
  const errors = validateFrozenDefaults(config, environment);
  for (const field of placeholderPaths(config)) {
    errors.push(`${field}:placeholder`);
  }
  const record = asRecord(config);
  const vars = asRecord(record?.vars);
  const origin = exactHttpsOrigin(vars?.APP_ORIGIN);
  requiredString(record, 'account_id', errors);
  requiredString(record, 'name', errors);
  if (!/^[0-9a-f]{32}$/u.test(String(record?.account_id ?? ''))) {
    errors.push('account_id:invalid');
  }
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(String(record?.name ?? ''))) {
    errors.push('name:invalid');
  }
  if (!origin) errors.push('vars.APP_ORIGIN:invalid_https_origin');
  for (const key of [
    'APP_ALLOWED_ORIGINS',
    'STAFF_AUTH_ALLOWED_ORIGINS',
    'FEISHU_WORKBENCH_WEB_ORIGIN',
  ]) {
    if (vars?.[key] !== origin) errors.push(`vars.${key}:origin_mismatch`);
  }
  if (origin && vars?.STAFF_AUTH_FEISHU_REDIRECT_URI
    !== `${origin}/api/staff-auth/feishu/callback`) {
    errors.push('vars.STAFF_AUTH_FEISHU_REDIRECT_URI:origin_mismatch');
  }
  for (const key of [
    'STAFF_AUTH_FEISHU_AUTHORIZATION_ENDPOINT',
    'STAFF_AUTH_FEISHU_TOKEN_ENDPOINT',
    'STAFF_AUTH_FEISHU_IDENTITY_ENDPOINT',
  ]) {
    if (!exactHttpsUrl(vars?.[key])) errors.push(`vars.${key}:invalid_https_url`);
  }
  for (const key of [
    'STAFF_AUTH_FEISHU_APP_ID',
    'STAFF_AUTH_FEISHU_SCOPE',
    'STAFF_AUTH_FEISHU_TENANT_KEY',
  ]) requiredString(vars, key, errors, 'vars.');
  if (vars?.FEISHU_WORKBENCH_API_ORIGIN !== 'https://open.feishu.cn') {
    errors.push('vars.FEISHU_WORKBENCH_API_ORIGIN:official_origin_required');
  }
  for (const key of ['FEISHU_WORKBENCH_APP_ID', 'FEISHU_WORKBENCH_TENANT_KEY']) {
    requiredString(vars, key, errors, 'vars.');
  }
  for (const [key, minimum, maximum] of [
    ['FEISHU_WORKBENCH_REQUEST_TIMEOUT_MS', 100, 10_000],
    ['FEISHU_WORKBENCH_MAX_ATTEMPTS', 1, 3],
    ['FEISHU_WORKBENCH_RATE_LIMIT_PER_SECOND', 1, 10],
  ]) {
    const value = String(vars?.[key] ?? '');
    if (!/^\d+$/u.test(value) || Number(value) < minimum || Number(value) > maximum) {
      errors.push(`vars.${key}:invalid_integer`);
    }
  }

  const route = exactOne(record?.routes);
  if (!route || route.custom_domain !== true || typeof route.pattern !== 'string') {
    errors.push('routes:invalid_custom_domain');
  } else if (!origin || route.pattern !== new URL(origin).hostname) {
    errors.push('routes.0.pattern:origin_mismatch');
  }
  const cron = exactOne(asRecord(record?.triggers)?.crons);
  if (typeof cron !== 'string' || cron.trim().split(/\s+/u).length !== 5) {
    errors.push('triggers.crons:invalid');
  }
  const d1 = exactOne(record?.d1_databases);
  if (!d1 || d1.binding !== 'DB') errors.push('d1_databases:binding_invalid');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
    .test(String(d1?.database_id ?? ''))) errors.push('d1_databases.0.database_id:invalid');
  if (!isResourceName(d1?.database_name)) errors.push('d1_databases.0.database_name:invalid');
  const r2 = exactOne(record?.r2_buckets);
  if (!r2 || r2.binding !== 'FILE_OBJECT_STORAGE_R2') {
    errors.push('r2_buckets:binding_invalid');
  }
  if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/u.test(String(r2?.bucket_name ?? ''))) {
    errors.push('r2_buckets.0.bucket_name:invalid');
  }
  const tokenStatus = exactOne(record?.services);
  if (!tokenStatus
    || tokenStatus.binding !== 'STAFF_MCP_TOKEN_STATUS_SERVICE'
    || !isResourceName(tokenStatus.service)) {
    errors.push('services:staff_mcp_token_status_binding_invalid');
  }
  for (const key of Object.keys(vars ?? {})) {
    if (/SECRET|PASSWORD|REFRESH_TOKEN|CLIENT_SECRET/iu.test(key)) {
      errors.push(`vars.${key}:managed_secret_forbidden`);
    }
  }
  return Object.freeze([...new Set(errors)].sort());
}

function validateFrozenDefaults(config, environment) {
  const errors = [];
  const record = asRecord(config);
  const vars = asRecord(record?.vars);
  if (!record) return ['config:not_object'];
  if (record.env !== undefined) errors.push('env:forbidden_use_separate_templates');
  if (record.main !== 'src/worker.ts') errors.push('main:invalid');
  if (record.workers_dev !== false) errors.push('workers_dev:must_be_false');
  if (record.preview_urls !== false) errors.push('preview_urls:must_be_false');
  if (vars?.APP_ENVIRONMENT !== environment) errors.push('vars.APP_ENVIRONMENT:wrong_environment');
  if (vars?.OPERATIONAL_ALERT_MODE !== 'disabled') {
    errors.push('vars.OPERATIONAL_ALERT_MODE:must_be_disabled');
  }
  for (const flag of disabledFlags) {
    if (vars?.[flag] !== 'false') errors.push(`vars.${flag}:must_be_false`);
  }
  const assets = asRecord(record.assets);
  if (assets?.directory !== '../web/dist'
    || assets?.binding !== 'WEB_ASSETS'
    || assets?.not_found_handling !== 'single-page-application'
    || assets?.run_worker_first !== true) errors.push('assets:invalid_spa_contract');
  const d1 = exactOne(record.d1_databases);
  if (d1?.migrations_dir !== '../../migrations') {
    errors.push('d1_databases.0.migrations_dir:invalid');
  }
  if (asRecord(record.observability)?.enabled !== false) {
    errors.push('observability.enabled:must_be_false_until_alert_change');
  }
  return errors;
}

function placeholderPaths(value, prefix = '') {
  const result = [];
  if (typeof value === 'string' && placeholderPattern.test(value)) {
    result.push(prefix || '$');
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => result.push(...placeholderPaths(
      item, `${prefix}.${index}`.replace(/^\./u, ''),
    )));
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      result.push(...placeholderPaths(item, `${prefix}.${key}`.replace(/^\./u, '')));
    }
  }
  return result.sort();
}

function stripJsonComments(input) {
  let output = '';
  let string = false;
  let escaped = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];
    if (string) {
      output += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') string = false;
      continue;
    }
    if (char === '"') {
      string = true;
      output += char;
      continue;
    }
    if (char === '/' && next === '/') {
      while (index < input.length && input[index] !== '\n') index += 1;
      output += '\n';
      continue;
    }
    if (char === '/' && next === '*') {
      index += 2;
      while (index < input.length
        && !(input[index] === '*' && input[index + 1] === '/')) index += 1;
      index += 1;
      continue;
    }
    output += char;
  }
  return output;
}

function exactHttpsOrigin(value) {
  if (typeof value !== 'string' || placeholderPattern.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === value
      && !url.username && !url.password ? value : null;
  } catch { return null; }
}

function exactHttpsUrl(value) {
  if (typeof value !== 'string' || placeholderPattern.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
  } catch { return false; }
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function exactOne(value) {
  return Array.isArray(value) && value.length === 1 ? asRecord(value[0]) ?? value[0] : null;
}

function requiredString(record, key, errors, prefix = '') {
  if (typeof record?.[key] !== 'string' || record[key].trim() === '') {
    errors.push(`${prefix}${key}:missing`);
  }
}

function isResourceName(value) {
  return typeof value === 'string' && value.length >= 3 && value.length <= 128
    && /^[a-z0-9][a-z0-9_-]*$/u.test(value);
}

function requireEnvironment(environment) {
  if (!environments.has(environment)) throw new Error('environment_must_be_staging_or_production');
}

function isWithin(directory, candidate) {
  const relative = path.relative(directory, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`)
    && relative !== '..' && !path.isAbsolute(relative));
}

function parseArgs(argv) {
  const input = { environment: '', config: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--environment') input.environment = argv[++index] ?? '';
    else if (argv[index] === '--config') input.config = argv[++index] ?? null;
    else throw new Error(`unknown_argument:${argv[index]}`);
  }
  requireEnvironment(input.environment);
  return input;
}

function main() {
  let input;
  try {
    input = parseArgs(process.argv.slice(2));
  } catch {
    printBlocked(null, ['arguments:invalid']);
    return;
  }
  if (!input.config) {
    const report = inspectReleaseTemplate(input.environment);
    console.log(JSON.stringify(report, null, 2));
    if (report.status === 'INVALID_TEMPLATE') process.exitCode = 1;
    return;
  }
  const external = externalReleaseConfigPath(input.config);
  if (!external.file) {
    printBlocked(input.environment, [external.error]);
    return;
  }
  let config;
  try {
    config = readLocalReleaseConfig(external.file);
  } catch {
    printBlocked(input.environment, ['config:unreadable_or_invalid']);
    return;
  }
  const errors = validateReleaseConfig(config, input.environment);
  console.log(JSON.stringify({
    status: errors.length === 0 ? 'LOCAL_CONFIG_VALID' : 'BLOCKED',
    environment: input.environment,
    errors,
    required_managed_secrets: requiredManagedSecrets,
    external_calls: 0,
    deployments: 0,
    resource_mutations: 0,
  }, null, 2));
  if (errors.length > 0) process.exitCode = 1;
}

function printBlocked(environment, errors) {
  console.log(JSON.stringify({
    status: 'BLOCKED',
    environment,
    errors,
    required_managed_secrets: requiredManagedSecrets,
    external_calls: 0,
    deployments: 0,
    resource_mutations: 0,
  }, null, 2));
  process.exitCode = 1;
}

if (process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
