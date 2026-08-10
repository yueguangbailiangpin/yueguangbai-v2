import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  externalReleaseConfigPath,
  readLocalReleaseConfig,
  templatePath,
} from './preflight-cloudflare-release.mjs';

const environments = new Set(['staging', 'production']);
const placeholders = /REQUIRED|REPLACE|PLACEHOLDER|CHANGEME|TODO/iu;

export const staffAuthManagedSecrets = Object.freeze([
  'STAFF_AUTH_FEISHU_APP_SECRET',
  'STAFF_AUTH_HASH_SECRET',
]);

export function inspectStaffAuthTemplate(environment) {
  requireEnvironment(environment);
  const config = readLocalReleaseConfig(templatePath(environment));
  const vars = record(config.vars);
  const errors = [];
  if (vars?.STAFF_AUTH_ENABLED !== 'false') {
    errors.push('vars.STAFF_AUTH_ENABLED:template_must_be_false');
  }
  for (const name of staffAuthManagedSecrets) {
    if (Object.hasOwn(vars ?? {}, name)) {
      errors.push(`vars.${name}:managed_secret_forbidden`);
    }
  }
  return Object.freeze({
    status: errors.length === 0 ? 'LOCAL_NO_GO' : 'INVALID_TEMPLATE',
    environment,
    migration_decision: 'NO_SCHEMA_CHANGE',
    required_managed_secret_names: staffAuthManagedSecrets,
    blockers: Object.freeze([
      'managed_secret_presence_not_checked_locally',
      'real_feishu_redirect_not_checked_locally',
      'real_known_staff_login_not_checked_locally',
      'owner_activation_approval_not_recorded_locally',
    ]),
    external_calls: 0,
    provider_calls: 0,
    deployments: 0,
    resource_mutations: 0,
    errors: Object.freeze(errors),
  });
}

export function validateStaffAuthActivationConfig(
  config,
  environment,
  declaredSecretNames = [],
) {
  requireEnvironment(environment);
  const vars = record(record(config)?.vars);
  const errors = [];
  if (!vars) return ['vars:missing'];
  if (vars.APP_ENVIRONMENT !== environment) {
    errors.push('vars.APP_ENVIRONMENT:wrong_environment');
  }
  const origin = exactHttpsOrigin(vars.APP_ORIGIN);
  if (!origin) errors.push('vars.APP_ORIGIN:invalid_https_origin');
  if (vars.STAFF_AUTH_ENABLED !== 'true') {
    errors.push('vars.STAFF_AUTH_ENABLED:must_be_true');
  }
  if (vars.STAFF_AUTH_PROVIDER !== 'FEISHU') {
    errors.push('vars.STAFF_AUTH_PROVIDER:must_be_FEISHU');
  }
  const exact = {
    STAFF_AUTH_FEISHU_AUTHORIZATION_ENDPOINT:
      'https://accounts.feishu.cn/open-apis/authen/v1/authorize',
    STAFF_AUTH_FEISHU_TOKEN_ENDPOINT:
      'https://open.feishu.cn/open-apis/authen/v2/oauth/token',
    STAFF_AUTH_FEISHU_IDENTITY_ENDPOINT:
      'https://open.feishu.cn/open-apis/authen/v1/user_info',
    STAFF_AUTH_FEISHU_SCOPE: 'contact:user.base:readonly',
    STAFF_AUTH_ALLOWED_RETURN_TO: '/staff',
  };
  for (const [key, expected] of Object.entries(exact)) {
    if (vars[key] !== expected) errors.push(`vars.${key}:invalid`);
  }
  for (const key of ['STAFF_AUTH_FEISHU_APP_ID', 'STAFF_AUTH_FEISHU_TENANT_KEY']) {
    if (!safe(vars[key], key.endsWith('APP_ID') ? 128 : 200)) {
      errors.push(`vars.${key}:missing_or_invalid`);
    }
  }
  if (!origin || vars.STAFF_AUTH_ALLOWED_ORIGINS !== origin) {
    errors.push('vars.STAFF_AUTH_ALLOWED_ORIGINS:origin_mismatch');
  }
  if (!origin || vars.STAFF_AUTH_FEISHU_REDIRECT_URI
    !== `${origin}/api/staff-auth/feishu/callback`) {
    errors.push('vars.STAFF_AUTH_FEISHU_REDIRECT_URI:origin_mismatch');
  }
  for (const key of [
    'SCHEDULED_OPERATIONS_ENABLED',
    'ACQUISITION_MAINTENANCE_ENABLED',
    'DRIVE_ARCHIVE_ENABLED',
    'DRIVE_ARCHIVE_COPY_ENABLED',
    'DRIVE_ARCHIVE_PROXY_READ_ENABLED',
    'DRIVE_ARCHIVE_R2_DELETE_ENABLED',
    'FEISHU_WORKBENCH_SYNC_ENABLED',
    'FEISHU_WORKBENCH_CALLBACK_ENABLED',
    'FEISHU_OPERATIONAL_ALERT_ENABLED',
    'STAFF_MCP_ENABLED',
    'STAFF_MCP_PRODUCTION_TRANSPORT_ENABLED',
    'STAFF_MCP_LOCAL_MOCK_ENABLED',
    'STAFF_MCP_CLEANUP_ENABLED',
  ]) {
    if (vars[key] !== 'false') errors.push(`vars.${key}:must_remain_false`);
  }
  const declared = new Set(declaredSecretNames);
  for (const name of staffAuthManagedSecrets) {
    if (!declared.has(name)) errors.push(`managed_secret.${name}:not_declared`);
  }
  for (const key of Object.keys(vars)) {
    if (/SECRET|PASSWORD|(?:ACCESS|REFRESH)_TOKEN/iu.test(key)) {
      errors.push(`vars.${key}:managed_secret_forbidden`);
    }
  }
  return Object.freeze([...new Set(errors)].sort());
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

function requireEnvironment(environment) {
  if (!environments.has(environment)) throw new Error('invalid_environment');
}

function main(argv) {
  const environmentIndex = argv.indexOf('--environment');
  const configIndex = argv.indexOf('--config');
  const environment = environmentIndex >= 0 ? argv[environmentIndex + 1] : '';
  if (!environments.has(environment)) {
    print('BLOCKED', environment || null, ['arguments:invalid']);
    return;
  }
  if (configIndex < 0) {
    console.log(JSON.stringify(inspectStaffAuthTemplate(environment), null, 2));
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
    const errors = validateStaffAuthActivationConfig(
      readLocalReleaseConfig(external.file),
      environment,
      declared,
    );
    print(errors.length === 0
      ? 'LOCAL_STRUCTURE_VALID_PRODUCTION_NO_GO'
      : 'BLOCKED', environment, errors);
  } catch {
    print('BLOCKED', environment, ['config:unreadable_or_invalid']);
  }
}

function print(status, environment, errors) {
  console.log(JSON.stringify({
    status,
    environment,
    errors,
    required_managed_secret_names: staffAuthManagedSecrets,
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
