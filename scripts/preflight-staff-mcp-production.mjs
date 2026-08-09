import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  externalReleaseConfigPath,
  readLocalReleaseConfig,
  templatePath,
} from './preflight-cloudflare-release.mjs';

const environments = new Set(['staging', 'production']);
const placeholders = /REQUIRED|REPLACE|PLACEHOLDER|CHANGEME|TODO/iu;

export const staffMcpManagedSecrets = Object.freeze([
  'STAFF_MCP_BINDING_HASH_SECRET',
]);

export function inspectStaffMcpTemplate(environment) {
  requireEnvironment(environment);
  const config = readLocalReleaseConfig(templatePath(environment));
  const errors = validateDisabledTemplate(config, environment);
  const requiredFields = mcpPlaceholderFields(config);
  const requiredBindings = mcpPlaceholderBindings(config);
  return Object.freeze({
    status: errors.length === 0
      ? 'BLOCKED_NEEDS_OPERATOR_INPUT'
      : 'INVALID_TEMPLATE',
    environment,
    required_fields: Object.freeze(requiredFields),
    required_binding_fields: Object.freeze(requiredBindings),
    required_managed_secret_names: staffMcpManagedSecrets,
    required_external_approvals: Object.freeze([
      'oauth_authorization_server_and_client_registration',
      'openai_chatgpt_workspace_and_app_review',
      'cloudflare_deployment_domain_and_network',
      'revocation_propagation_and_rotation_drill',
      'privacy_security_and_owner_production_go',
    ]),
    external_calls: 0,
    provider_calls: 0,
    deployments: 0,
    resource_mutations: 0,
    errors: Object.freeze(errors),
  });
}

export function validateStaffMcpRenderedConfig(config, environment) {
  requireEnvironment(environment);
  const errors = [];
  const vars = record(record(config)?.vars);
  if (!vars) return ['vars:missing'];
  if (vars.APP_ENVIRONMENT !== environment) errors.push('vars.APP_ENVIRONMENT:wrong_environment');
  if (vars.STAFF_MCP_ENABLED !== 'true') errors.push('vars.STAFF_MCP_ENABLED:must_be_true');
  if (vars.STAFF_MCP_PRODUCTION_TRANSPORT_ENABLED !== 'true') {
    errors.push('vars.STAFF_MCP_PRODUCTION_TRANSPORT_ENABLED:must_be_true');
  }
  if (vars.STAFF_MCP_LOCAL_MOCK_ENABLED !== 'false') {
    errors.push('vars.STAFF_MCP_LOCAL_MOCK_ENABLED:must_be_false');
  }
  if (vars.STAFF_MCP_CLEANUP_ENABLED !== 'true') {
    errors.push('vars.STAFF_MCP_CLEANUP_ENABLED:must_be_true');
  }
  const origin = exactHttpsOrigin(vars.APP_ORIGIN);
  const resource = exactHttpsUrl(vars.STAFF_MCP_RESOURCE);
  if (!origin) errors.push('vars.APP_ORIGIN:invalid_https_origin');
  if (!resource || resource !== `${origin}/mcp`) {
    errors.push('vars.STAFF_MCP_RESOURCE:origin_mismatch');
  }
  if (vars.STAFF_MCP_OAUTH_AUDIENCE !== resource) {
    errors.push('vars.STAFF_MCP_OAUTH_AUDIENCE:resource_mismatch');
  }
  for (const key of [
    'STAFF_MCP_OAUTH_ISSUER',
    'STAFF_MCP_OAUTH_METADATA_URL',
    'STAFF_MCP_OAUTH_AUTHORIZATION_ENDPOINT',
    'STAFF_MCP_OAUTH_TOKEN_ENDPOINT',
    'STAFF_MCP_OAUTH_JWKS_URI',
    'STAFF_MCP_OAUTH_REVOCATION_ENDPOINT',
  ]) {
    if (!exactHttpsUrl(vars[key])) errors.push(`vars.${key}:invalid_https_url`);
  }
  for (const key of [
    'STAFF_MCP_GLOBAL_RATE_LIMIT_PER_MINUTE',
    'STAFF_MCP_TOOL_RATE_LIMIT_PER_MINUTE',
    'STAFF_MCP_CLEANUP_LIMIT',
  ]) {
    if (!/^[1-9]\d{0,3}$/u.test(String(vars[key] ?? ''))
      || Number(vars[key]) > 10_000) errors.push(`vars.${key}:invalid_integer`);
  }
  if (!/^\d{2,5}$/u.test(String(vars.STAFF_MCP_TOKEN_STATUS_TIMEOUT_MS ?? ''))
    || Number(vars.STAFF_MCP_TOKEN_STATUS_TIMEOUT_MS) < 50
    || Number(vars.STAFF_MCP_TOKEN_STATUS_TIMEOUT_MS) > 10_000) {
    errors.push('vars.STAFF_MCP_TOKEN_STATUS_TIMEOUT_MS:invalid_integer');
  }
  const service = tokenStatusService(config);
  if (!service || placeholders.test(service.service)) {
    errors.push('services.STAFF_MCP_TOKEN_STATUS_SERVICE:invalid_service');
  }
  for (const key of Object.keys(vars)) {
    if (/SECRET|PASSWORD|(?:ACCESS|REFRESH)_TOKEN/iu.test(key)) {
      errors.push(`vars.${key}:managed_secret_forbidden`);
    }
  }
  return [...new Set(errors)].sort();
}

function validateDisabledTemplate(config, environment) {
  const vars = record(record(config)?.vars);
  const errors = [];
  if (!vars) return ['vars:missing'];
  if (vars.APP_ENVIRONMENT !== environment) errors.push('vars.APP_ENVIRONMENT:wrong_environment');
  for (const key of [
    'STAFF_MCP_ENABLED',
    'STAFF_MCP_PRODUCTION_TRANSPORT_ENABLED',
    'STAFF_MCP_LOCAL_MOCK_ENABLED',
    'STAFF_MCP_CLEANUP_ENABLED',
  ]) {
    if (vars[key] !== 'false') errors.push(`vars.${key}:must_be_false`);
  }
  for (const secret of staffMcpManagedSecrets) {
    if (Object.hasOwn(vars, secret)) errors.push(`vars.${secret}:managed_secret_forbidden`);
  }
  const service = tokenStatusService(config);
  if (!service || !placeholders.test(service.service)) {
    errors.push('services.STAFF_MCP_TOKEN_STATUS_SERVICE:placeholder_required');
  }
  return errors;
}

function mcpPlaceholderFields(config) {
  const vars = record(record(config)?.vars) ?? {};
  return Object.entries(vars)
    .filter(([key, value]) => key.startsWith('STAFF_MCP_')
      && typeof value === 'string' && placeholders.test(value))
    .map(([key]) => `vars.${key}`)
    .sort();
}

function mcpPlaceholderBindings(config) {
  const service = tokenStatusService(config);
  return service && placeholders.test(service.service)
    ? ['services.STAFF_MCP_TOKEN_STATUS_SERVICE.service']
    : [];
}

function tokenStatusService(config) {
  const services = record(config)?.services;
  if (!Array.isArray(services)) return null;
  const matches = services.filter((value) => {
    const row = record(value);
    return row?.binding === 'STAFF_MCP_TOKEN_STATUS_SERVICE'
      && typeof row.service === 'string';
  });
  return matches.length === 1 ? matches[0] : null;
}

function exactHttpsOrigin(value) {
  if (typeof value !== 'string' || placeholders.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === value
      && !url.username && !url.password ? value : null;
  } catch { return null; }
}

function exactHttpsUrl(value) {
  if (typeof value !== 'string' || placeholders.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.toString() === value
      && !url.username && !url.password && !url.search && !url.hash
      ? value : null;
  } catch { return null; }
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function requireEnvironment(environment) {
  if (!environments.has(environment)) throw new Error('invalid_environment');
}

function main() {
  const args = process.argv.slice(2);
  const environmentIndex = args.indexOf('--environment');
  const configIndex = args.indexOf('--config');
  const environment = environmentIndex >= 0 ? args[environmentIndex + 1] : '';
  if (!environments.has(environment)
    || args.some((value, index) => value.startsWith('--')
      && !['--environment', '--config'].includes(value)
      && index !== environmentIndex + 1 && index !== configIndex + 1)) {
    print('BLOCKED', environment || null, ['arguments:invalid']);
    return;
  }
  if (configIndex < 0) {
    console.log(JSON.stringify(inspectStaffMcpTemplate(environment), null, 2));
    return;
  }
  const external = externalReleaseConfigPath(args[configIndex + 1]);
  if (!external.file) {
    print('BLOCKED', environment, [external.error]);
    return;
  }
  try {
    const errors = validateStaffMcpRenderedConfig(
      readLocalReleaseConfig(external.file),
      environment,
    );
    print(
      errors.length === 0
        ? 'LOCAL_CONFIG_VALID_PRODUCTION_NO_GO'
        : 'BLOCKED',
      environment,
      errors,
    );
  } catch {
    print('BLOCKED', environment, ['config:unreadable_or_invalid']);
  }
}

function print(status, environment, errors) {
  console.log(JSON.stringify({
    status,
    environment,
    errors,
    required_managed_secret_names: staffMcpManagedSecrets,
    required_binding_names: ['STAFF_MCP_TOKEN_STATUS_SERVICE'],
    external_calls: 0,
    provider_calls: 0,
    deployments: 0,
    resource_mutations: 0,
  }, null, 2));
  if (status === 'BLOCKED') process.exitCode = 1;
}

if (process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
