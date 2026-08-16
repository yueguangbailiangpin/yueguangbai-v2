import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  externalReleaseConfigPath,
  readLocalReleaseConfig,
  templatePath,
} from './preflight-cloudflare-release.mjs';
import { exactCloudflareAccessTeamOrigin } from '../packages/domain/src/security/cloudflare-access-team-origin.ts';

const environments = new Set(['staging', 'production']);
const placeholders = /REQUIRED|REPLACE|PLACEHOLDER|CHANGEME|TODO/iu;
const retiredFeishuKey = /^(?:FEISHU_|STAFF_AUTH_FEISHU)|^(?:STAFF_AUTH_PROVIDER|STAFF_AUTH_ENABLED|STAFF_AUTH_HASH_SECRET)$/u;

// Cloudflare Access JWT verification uses the public team JWKS. Staff Auth
// therefore has no application Secret of its own.
export const staffAuthManagedSecrets = Object.freeze([]);

export function inspectStaffAuthTemplate(environment) {
  requireEnvironment(environment);
  const config = readLocalReleaseConfig(templatePath(environment));
  const vars = record(config.vars);
  const errors = validateTemplateShape(vars);
  return Object.freeze({
    status: errors.length === 0 ? 'LOCAL_NO_GO' : 'INVALID_TEMPLATE',
    environment,
    migration_decision: 'NO_SCHEMA_CHANGE',
    required_managed_secret_names: staffAuthManagedSecrets,
    blockers: Object.freeze([
      'real_cloudflare_access_application_not_checked_locally',
      'real_cloudflare_access_policy_not_checked_locally',
      'real_known_staff_email_mapping_not_checked_locally',
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
  if (vars.STAFF_AUTH_ALLOWED_ORIGINS !== origin) {
    errors.push('vars.STAFF_AUTH_ALLOWED_ORIGINS:origin_mismatch');
  }
  if (!exactCloudflareAccessTeamOrigin(vars.STAFF_ACCESS_TEAM_DOMAIN)) {
    errors.push('vars.STAFF_ACCESS_TEAM_DOMAIN:invalid_access_team_origin');
  }
  if (!safe(vars.STAFF_ACCESS_AUD, 200, 8)) {
    errors.push('vars.STAFF_ACCESS_AUD:missing_or_invalid');
  }
  for (const key of Object.keys(vars)) {
    if (retiredFeishuKey.test(key)) errors.push(`vars.${key}:retired_configuration_forbidden`);
    if (/SECRET|PASSWORD|(?:ACCESS|REFRESH)_TOKEN/iu.test(key)) {
      errors.push(`vars.${key}:managed_secret_forbidden`);
    }
  }
  for (const name of declaredSecretNames) {
    errors.push(`managed_secret.${name}:not_required_for_staff_access`);
  }
  return Object.freeze([...new Set(errors)].sort());
}

function validateTemplateShape(vars) {
  if (!vars) return ['vars:missing'];
  const errors = [];
  for (const key of [
    'APP_ENVIRONMENT',
    'APP_ORIGIN',
    'STAFF_AUTH_ALLOWED_ORIGINS',
    'STAFF_ACCESS_TEAM_DOMAIN',
    'STAFF_ACCESS_AUD',
  ]) {
    if (typeof vars[key] !== 'string' || vars[key].length === 0) {
      errors.push(`vars.${key}:missing`);
    }
  }
  for (const key of Object.keys(vars)) {
    if (retiredFeishuKey.test(key)) errors.push(`vars.${key}:retired_configuration_forbidden`);
  }
  return errors;
}

function exactHttpsOrigin(value) {
  if (typeof value !== 'string' || placeholders.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === value
      && url.pathname === '/' && !url.search && !url.hash
      && !url.username && !url.password ? value : null;
  } catch { return null; }
}

function safe(value, maximum, minimum = 1) {
  return typeof value === 'string' && value.length >= minimum && value.length <= maximum
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
