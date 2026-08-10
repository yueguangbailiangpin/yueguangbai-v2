import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  externalReleaseConfigPath,
  readLocalReleaseConfig,
  templatePath,
} from './preflight-cloudflare-release.mjs';

const environments = new Set(['staging', 'production']);
const placeholders = /REQUIRED|REPLACE|PLACEHOLDER|CHANGEME|TODO/iu;
const FEISHU_ONLY_DISABLED_JOBS = Object.freeze([
  'reservation_expiry',
  'instruction_expiry',
  'outbox_delivery',
  'file_orphan_cleanup',
  'staff_auth_cleanup',
  'drive_archive',
]);

export const feishuProductionAppScopes = Object.freeze([
  'contact:user.base:readonly',
  'task:task:write',
  'im:message:send_as_bot',
]);

export const feishuProductionAppManagedSecrets = Object.freeze([
  'STAFF_AUTH_FEISHU_APP_SECRET',
  'STAFF_AUTH_HASH_SECRET',
  'FEISHU_WORKBENCH_APP_SECRET',
  'FEISHU_WORKBENCH_ENCRYPT_KEY',
  'FEISHU_WORKBENCH_VERIFICATION_TOKEN',
  'FEISHU_OPERATIONAL_ALERT_CHAT_ID',
]);

export function inspectFeishuProductionAppTemplate(environment) {
  requireEnvironment(environment);
  const vars = record(readLocalReleaseConfig(templatePath(environment)).vars);
  const errors = [];
  for (const flag of [
    'STAFF_AUTH_ENABLED',
    'SCHEDULED_OPERATIONS_ENABLED',
    'FEISHU_WORKBENCH_SYNC_ENABLED',
    'FEISHU_WORKBENCH_CALLBACK_ENABLED',
    'FEISHU_OPERATIONAL_ALERT_ENABLED',
  ]) {
    if (vars?.[flag] !== 'false') errors.push(`vars.${flag}:template_must_be_false`);
  }
  if (vars?.FEISHU_OPERATIONAL_ALERT_RATE_LIMIT_PER_SECOND !== '1') {
    errors.push('vars.FEISHU_OPERATIONAL_ALERT_RATE_LIMIT_PER_SECOND:template_must_be_1');
  }
  for (const name of feishuProductionAppManagedSecrets) {
    if (Object.hasOwn(vars ?? {}, name)) errors.push(`vars.${name}:managed_secret_forbidden`);
  }
  return Object.freeze({
    status: errors.length === 0 ? 'LOCAL_NO_GO' : 'INVALID_TEMPLATE',
    environment,
    migration_decision: 'NO_SCHEMA_CHANGE',
    required_scopes: feishuProductionAppScopes,
    oauth_redirect_path: '/api/staff-auth/feishu/callback',
    workbench_callback_path: '/api/feishu-workbench/callback',
    required_managed_secret_names: feishuProductionAppManagedSecrets,
    blockers: productionBlockers(),
    external_calls: 0,
    provider_calls: 0,
    deployments: 0,
    resource_mutations: 0,
    errors: Object.freeze(errors),
  });
}

export function validateFeishuProductionAppConfig(
  config,
  environment,
  declaredSecretNames = [],
) {
  requireEnvironment(environment);
  const vars = record(record(config)?.vars);
  const errors = [];
  if (!vars) return Object.freeze(['vars:missing']);
  if (vars.APP_ENVIRONMENT !== environment) {
    errors.push('vars.APP_ENVIRONMENT:wrong_environment');
  }
  const origin = exactHttpsOrigin(vars.APP_ORIGIN);
  if (!origin) errors.push('vars.APP_ORIGIN:invalid_https_origin');
  if (vars.APP_ALLOWED_ORIGINS !== origin
    || vars.STAFF_AUTH_ALLOWED_ORIGINS !== origin
    || vars.FEISHU_WORKBENCH_WEB_ORIGIN !== origin) {
    errors.push('vars.application_origin:mismatch');
  }

  exactValue(vars, 'STAFF_AUTH_ENABLED', 'true', errors);
  exactValue(vars, 'STAFF_AUTH_PROVIDER', 'FEISHU', errors);
  exactValue(vars, 'STAFF_AUTH_FEISHU_AUTHORIZATION_ENDPOINT',
    'https://accounts.feishu.cn/open-apis/authen/v1/authorize', errors);
  exactValue(vars, 'STAFF_AUTH_FEISHU_TOKEN_ENDPOINT',
    'https://open.feishu.cn/open-apis/authen/v2/oauth/token', errors);
  exactValue(vars, 'STAFF_AUTH_FEISHU_IDENTITY_ENDPOINT',
    'https://open.feishu.cn/open-apis/authen/v1/user_info', errors);
  exactValue(vars, 'STAFF_AUTH_FEISHU_SCOPE',
    'contact:user.base:readonly', errors);
  exactValue(vars, 'STAFF_AUTH_ALLOWED_RETURN_TO', '/staff', errors);
  if (!origin || vars.STAFF_AUTH_FEISHU_REDIRECT_URI
    !== `${origin}/api/staff-auth/feishu/callback`) {
    errors.push('vars.STAFF_AUTH_FEISHU_REDIRECT_URI:origin_mismatch');
  }

  exactValue(vars, 'SCHEDULED_OPERATIONS_ENABLED', 'true', errors);
  exactValue(vars, 'ACQUISITION_MAINTENANCE_ENABLED', 'false', errors);
  const disabled = new Set(String(vars.SCHEDULED_OPERATIONS_DISABLED_JOBS ?? '')
    .split(',').map((value) => value.trim()).filter(Boolean));
  if (disabled.size !== FEISHU_ONLY_DISABLED_JOBS.length
    || FEISHU_ONLY_DISABLED_JOBS.some((name) => !disabled.has(name))) {
    errors.push('vars.SCHEDULED_OPERATIONS_DISABLED_JOBS:feishu_only_set_required');
  }
  exactValue(vars, 'FEISHU_WORKBENCH_SYNC_ENABLED', 'true', errors);
  exactValue(vars, 'FEISHU_WORKBENCH_CALLBACK_ENABLED', 'true', errors);
  exactValue(vars, 'FEISHU_WORKBENCH_API_ORIGIN',
    'https://open.feishu.cn', errors);
  exactValue(vars, 'FEISHU_OPERATIONAL_ALERT_ENABLED', 'true', errors);
  exactValue(vars, 'OPERATIONAL_ALERT_MODE', 'disabled', errors);

  for (const key of ['STAFF_AUTH_FEISHU_APP_ID', 'FEISHU_WORKBENCH_APP_ID']) {
    if (!safe(vars[key], 128)) errors.push(`vars.${key}:missing_or_invalid`);
  }
  for (const key of ['STAFF_AUTH_FEISHU_TENANT_KEY', 'FEISHU_WORKBENCH_TENANT_KEY']) {
    if (!safe(vars[key], 200)) errors.push(`vars.${key}:missing_or_invalid`);
  }
  if (vars.STAFF_AUTH_FEISHU_APP_ID !== vars.FEISHU_WORKBENCH_APP_ID) {
    errors.push('vars.FEISHU_APP_ID:not_same_formal_app');
  }
  if (vars.STAFF_AUTH_FEISHU_TENANT_KEY !== vars.FEISHU_WORKBENCH_TENANT_KEY) {
    errors.push('vars.FEISHU_TENANT_KEY:not_same_formal_app');
  }

  for (const [key, minimum, maximum] of [
    ['FEISHU_WORKBENCH_REQUEST_TIMEOUT_MS', 100, 10_000],
    ['FEISHU_WORKBENCH_MAX_ATTEMPTS', 1, 3],
    ['FEISHU_WORKBENCH_RATE_LIMIT_PER_SECOND', 1, 10],
    ['FEISHU_OPERATIONAL_ALERT_RATE_LIMIT_PER_SECOND', 1, 5],
  ]) {
    const value = String(vars[key] ?? '');
    if (!/^\d+$/u.test(value)
      || Number(value) < minimum || Number(value) > maximum) {
      errors.push(`vars.${key}:invalid_integer`);
    }
  }

  for (const key of [
    'DRIVE_ARCHIVE_ENABLED',
    'DRIVE_ARCHIVE_COPY_ENABLED',
    'DRIVE_ARCHIVE_PROXY_READ_ENABLED',
    'DRIVE_ARCHIVE_R2_DELETE_ENABLED',
    'STAFF_MCP_ENABLED',
    'STAFF_MCP_PRODUCTION_TRANSPORT_ENABLED',
    'STAFF_MCP_LOCAL_MOCK_ENABLED',
    'STAFF_MCP_CLEANUP_ENABLED',
  ]) exactValue(vars, key, 'false', errors);

  const declared = new Set(declaredSecretNames);
  for (const name of feishuProductionAppManagedSecrets) {
    if (!declared.has(name)) errors.push(`managed_secret.${name}:not_declared`);
  }
  for (const key of Object.keys(vars)) {
    if (/SECRET|PASSWORD|(?:ACCESS|REFRESH)_TOKEN|VERIFICATION_TOKEN|ENCRYPT_KEY|CHAT_ID/iu.test(key)) {
      errors.push(`vars.${key}:managed_secret_forbidden`);
    }
  }
  return Object.freeze([...new Set(errors)].sort());
}

function exactValue(vars, key, expected, errors) {
  if (vars[key] !== expected) errors.push(`vars.${key}:invalid`);
}
function exactHttpsOrigin(value) {
  if (typeof value !== 'string' || placeholders.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === value
      && !url.username && !url.password ? value : null;
  } catch { return null; }
}
function safe(value, maximum) {
  return typeof value === 'string' && value.length >= 1 && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/u.test(value) && !placeholders.test(value);
}
function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}
function requireEnvironment(value) {
  if (!environments.has(value)) throw new Error('invalid_environment');
}
function productionBlockers() {
  return Object.freeze([
    'real_application_scope_not_verified',
    'real_bot_private_chat_not_verified',
    'real_callback_and_oauth_redirect_not_verified',
    'real_version_publish_and_admin_approval_not_verified',
    'real_provider_send_receive_not_verified',
    'independent_non_feishu_primary_alert_not_verified',
    'owner_activation_and_rollback_approval_not_recorded',
  ]);
}

function main(argv) {
  const environmentIndex = argv.indexOf('--environment');
  const configIndex = argv.indexOf('--config');
  const environment = environmentIndex >= 0 ? argv[environmentIndex + 1] : null;
  if (configIndex < 0) {
    const selected = environment === null ? [...environments] : [environment];
    if (selected.some((value) => !environments.has(value))) {
      print('BLOCKED', environment, ['arguments:invalid']);
      return;
    }
    const reports = selected.map(inspectFeishuProductionAppTemplate);
    const status = reports.every((report) => report.status === 'LOCAL_NO_GO')
      ? 'LOCAL_NO_GO' : 'INVALID_TEMPLATE';
    console.log(JSON.stringify({ status, reports }, null, 2));
    if (status !== 'LOCAL_NO_GO') process.exitCode = 1;
    return;
  }
  if (!environments.has(environment)) {
    print('BLOCKED', environment, ['arguments:invalid']);
    return;
  }
  const external = externalReleaseConfigPath(argv[configIndex + 1]);
  if (!external.file) {
    print('BLOCKED', environment, [external.error]);
    return;
  }
  const declared = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--declared-secret' && argv[index + 1]) {
      declared.push(argv[index + 1]);
    }
  }
  try {
    const errors = validateFeishuProductionAppConfig(
      readLocalReleaseConfig(external.file), environment, declared,
    );
    print(errors.length === 0
      ? 'LOCAL_STRUCTURE_VALID_PRODUCTION_NO_GO' : 'BLOCKED', environment, errors);
  } catch {
    print('BLOCKED', environment, ['config:unreadable_or_invalid']);
  }
}

function print(status, environment, errors) {
  console.log(JSON.stringify({
    status,
    environment,
    migration_decision: 'NO_SCHEMA_CHANGE',
    errors,
    required_scopes: feishuProductionAppScopes,
    oauth_redirect_path: '/api/staff-auth/feishu/callback',
    workbench_callback_path: '/api/feishu-workbench/callback',
    required_managed_secret_names: feishuProductionAppManagedSecrets,
    blockers: productionBlockers(),
    external_calls: 0,
    provider_calls: 0,
    deployments: 0,
    resource_mutations: 0,
  }, null, 2));
  if (status === 'BLOCKED') process.exitCode = 1;
}

if (process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2));
}
