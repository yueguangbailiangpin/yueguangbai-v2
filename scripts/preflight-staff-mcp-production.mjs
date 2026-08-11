import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  externalReleaseConfigPath,
  readLocalReleaseConfig,
  templatePath,
} from './preflight-cloudflare-release.mjs';

const environments = new Set(['staging', 'production']);
const placeholders = /REQUIRED|REPLACE|PLACEHOLDER|CHANGEME|TODO/iu;
const clientRegistrationModes = Object.freeze([
  'client_id_metadata_document',
  'pre_registered',
  'dynamic_client_registration',
]);

const allStaffMcpTools = Object.freeze([
  'list_staff_tasks_v1',
  'list_staff_exceptions_v1',
  'get_customer_summary_v1',
  'get_order_summary_v1',
  'get_review_summary_v1',
  'get_refund_summary_v1',
  'get_settlement_summary_v1',
  'read_task_screenshot_v1',
  'draft_wechat_message_v1',
  'draft_reconciliation_v1',
  'draft_payment_batch_v1',
  'draft_review_recommendation_v1',
  'get_web_confirmation_step_v1',
]);

export const staffMcpProductionAvailableTools = Object.freeze(
  allStaffMcpTools.filter((tool) => ![
    'list_staff_exceptions_v1',
    'read_task_screenshot_v1',
  ].includes(tool)),
);

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
      ? 'DISABLED_BY_DEFAULT'
      : 'INVALID_TEMPLATE',
    environment,
    required_fields: Object.freeze(requiredFields),
    required_binding_fields: Object.freeze(requiredBindings),
    required_managed_secret_names: staffMcpManagedSecrets,
    required_activation_evidence_fields: Object.freeze([
      'schema_version',
      'environment',
      'resource',
      'documentation_url',
      'privacy_policy_url',
      'client_registration',
      'enabled_tools',
    ]),
    supported_client_registration_modes: clientRegistrationModes,
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
  const root = record(config);
  const vars = record(root?.vars);
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
  const documentationUrl = exactPublicResourceUrl(
    vars.STAFF_MCP_RESOURCE_DOCUMENTATION_URL,
    origin,
  );
  const policyUrl = exactPublicResourceUrl(vars.STAFF_MCP_RESOURCE_POLICY_URL, origin);
  if (!documentationUrl) {
    errors.push('vars.STAFF_MCP_RESOURCE_DOCUMENTATION_URL:invalid_public_url');
  }
  if (!policyUrl) errors.push('vars.STAFF_MCP_RESOURCE_POLICY_URL:invalid_public_url');
  if (documentationUrl && policyUrl && documentationUrl === policyUrl) {
    errors.push('vars.STAFF_MCP_RESOURCE_POLICY_URL:must_be_distinct');
  }
  const enabledTools = parseToolSet(
    vars.STAFF_MCP_ENABLED_TOOLS,
    staffMcpProductionAvailableTools,
    false,
  );
  if (!enabledTools) errors.push('vars.STAFF_MCP_ENABLED_TOOLS:invalid_tool_set');
  const disabledTools = parseToolSet(
    vars.STAFF_MCP_DISABLED_TOOLS,
    allStaffMcpTools,
    true,
  );
  if (!disabledTools) errors.push('vars.STAFF_MCP_DISABLED_TOOLS:invalid_tool_set');
  if (enabledTools && disabledTools
    && enabledTools.every((tool) => disabledTools.includes(tool))) {
    errors.push('vars.STAFF_MCP_ENABLED_TOOLS:all_tools_disabled');
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
  if (root.workers_dev !== false) errors.push('workers_dev:must_be_false');
  if (root.preview_urls !== false) errors.push('preview_urls:must_be_false');
  const route = exactOneRecord(root.routes);
  if (!route || route.custom_domain !== true || typeof route.pattern !== 'string') {
    errors.push('routes:invalid_custom_domain');
  } else if (!origin || route.pattern !== new URL(origin).hostname) {
    errors.push('routes.0.pattern:origin_mismatch');
  }
  for (const key of Object.keys(vars)) {
    if (/SECRET|PASSWORD|(?:ACCESS|REFRESH)_TOKEN/iu.test(key)) {
      errors.push(`vars.${key}:managed_secret_forbidden`);
    }
  }
  return [...new Set(errors)].sort();
}

export function validateStaffMcpActivationEvidence(
  evidence,
  config,
  environment,
) {
  requireEnvironment(environment);
  const errors = [];
  const root = record(evidence);
  const vars = record(record(config)?.vars);
  if (!root) return ['evidence:not_object'];
  if (!vars) return ['config.vars:missing'];
  if (!exactKeys(root, [
    'schema_version',
    'environment',
    'resource',
    'documentation_url',
    'privacy_policy_url',
    'client_registration',
    'enabled_tools',
  ])) errors.push('evidence:unknown_or_missing_fields');
  if (root.schema_version !== 1) errors.push('evidence.schema_version:invalid');
  if (root.environment !== environment) errors.push('evidence.environment:mismatch');
  if (root.resource !== vars.STAFF_MCP_RESOURCE) errors.push('evidence.resource:mismatch');
  if (root.documentation_url !== vars.STAFF_MCP_RESOURCE_DOCUMENTATION_URL) {
    errors.push('evidence.documentation_url:mismatch');
  }
  if (root.privacy_policy_url !== vars.STAFF_MCP_RESOURCE_POLICY_URL) {
    errors.push('evidence.privacy_policy_url:mismatch');
  }
  const effectiveTools = effectiveEnabledTools(vars);
  const evidenceTools = parseToolArray(root.enabled_tools, staffMcpProductionAvailableTools);
  if (!evidenceTools) errors.push('evidence.enabled_tools:invalid');
  else if (!effectiveTools || !sameStringSet(evidenceTools, effectiveTools)) {
    errors.push('evidence.enabled_tools:config_mismatch');
  }
  errors.push(...validateClientRegistration(root.client_registration));
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
  for (const key of Object.keys(vars)) {
    if (key.startsWith('STAFF_MCP_') && ![
      'STAFF_MCP_ENABLED',
      'STAFF_MCP_PRODUCTION_TRANSPORT_ENABLED',
      'STAFF_MCP_LOCAL_MOCK_ENABLED',
      'STAFF_MCP_CLEANUP_ENABLED',
      'STAFF_MCP_CLEANUP_LIMIT',
    ].includes(key)) errors.push(`vars.${key}:forbidden_while_disabled`);
  }
  const services = record(config)?.services;
  if (services !== undefined && (!Array.isArray(services) || services.length !== 0)) {
    errors.push('services:forbidden_while_staff_mcp_disabled');
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

function effectiveEnabledTools(vars) {
  const enabled = parseToolSet(
    vars.STAFF_MCP_ENABLED_TOOLS,
    staffMcpProductionAvailableTools,
    false,
  );
  const disabled = parseToolSet(vars.STAFF_MCP_DISABLED_TOOLS, allStaffMcpTools, true);
  if (!enabled || !disabled) return null;
  const disabledSet = new Set(disabled);
  const effective = enabled.filter((tool) => !disabledSet.has(tool));
  return effective.length > 0 ? effective : null;
}

function validateClientRegistration(value) {
  const errors = [];
  const registration = record(value);
  if (!registration || !clientRegistrationModes.includes(registration.mode)) {
    return ['evidence.client_registration.mode:invalid'];
  }
  const commonKeys = ['mode', 'redirect_uris', 'pkce_method'];
  const modeKey = registration.mode === 'dynamic_client_registration'
    ? 'registration_endpoint' : 'client_id';
  if (!exactKeys(registration, [...commonKeys, modeKey])) {
    errors.push('evidence.client_registration:unknown_or_missing_fields');
  }
  if (registration.pkce_method !== 'S256') {
    errors.push('evidence.client_registration.pkce_method:must_be_s256');
  }
  const redirects = parseRedirectUris(registration.redirect_uris);
  if (!redirects) errors.push('evidence.client_registration.redirect_uris:invalid');
  if (registration.mode === 'client_id_metadata_document') {
    const clientId = exactHttpsUrl(registration.client_id);
    if (!clientId || new URL(clientId).pathname === '/') {
      errors.push('evidence.client_registration.client_id:invalid_metadata_url');
    }
  } else if (registration.mode === 'pre_registered') {
    if (typeof registration.client_id !== 'string'
      || registration.client_id.length < 1
      || registration.client_id.length > 512
      || placeholders.test(registration.client_id)
      || /[\u0000-\u001f\u007f]/u.test(registration.client_id)) {
      errors.push('evidence.client_registration.client_id:invalid');
    }
  } else if (!exactHttpsUrl(registration.registration_endpoint)) {
    errors.push('evidence.client_registration.registration_endpoint:invalid_https_url');
  }
  return errors;
}

function parseRedirectUris(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8
    || value.some((item) => !exactHttpsUrl(item))) return null;
  return new Set(value).size === value.length ? value : null;
}

function parseToolSet(value, allowed, allowEmpty) {
  if (typeof value !== 'string') return null;
  if (value.trim() === '') return allowEmpty ? [] : null;
  return parseToolArray(value.split(',').map((tool) => tool.trim()), allowed);
}

function parseToolArray(value, allowed) {
  if (!Array.isArray(value) || value.length < 1
    || value.some((tool) => typeof tool !== 'string' || !allowed.includes(tool))
    || new Set(value).size !== value.length) return null;
  return value;
}

function sameStringSet(left, right) {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function exactKeys(value, keys) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function exactOneRecord(value) {
  return Array.isArray(value) && value.length === 1 ? record(value[0]) : null;
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

function exactPublicResourceUrl(value, origin) {
  const exact = exactHttpsUrl(value);
  if (!exact || !origin) return null;
  const url = new URL(exact);
  return url.origin === origin
    && url.pathname !== '/'
    && url.pathname !== '/mcp'
    && url.pathname !== '/.well-known/oauth-protected-resource/mcp'
    ? exact : null;
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function requireEnvironment(environment) {
  if (!environments.has(environment)) throw new Error('invalid_environment');
}

function main() {
  let input;
  try {
    input = parseArgs(process.argv.slice(2));
  } catch {
    print('BLOCKED', null, ['arguments:invalid']);
    return;
  }
  if (!input.config && !input.evidence) {
    console.log(JSON.stringify(inspectStaffMcpTemplate(input.environment), null, 2));
    return;
  }
  if (!input.config || !input.evidence) {
    print('BLOCKED', input.environment, [
      input.config ? 'evidence_path:required' : 'config_path:required',
    ]);
    return;
  }
  const external = externalReleaseConfigPath(input.config);
  const evidenceExternal = externalReleaseConfigPath(input.evidence);
  if (!external.file || !evidenceExternal.file) {
    const errors = [];
    if (!external.file) errors.push(external.error);
    if (!evidenceExternal.file) {
      errors.push(String(evidenceExternal.error).replace(/^config_path/u, 'evidence_path'));
    }
    print('BLOCKED', input.environment, errors);
    return;
  }
  try {
    const config = readLocalReleaseConfig(external.file);
    const evidence = readLocalReleaseConfig(evidenceExternal.file);
    const errors = [
      ...validateStaffMcpRenderedConfig(config, input.environment),
      ...validateStaffMcpActivationEvidence(evidence, config, input.environment),
    ];
    print(
      errors.length === 0
        ? 'LOCAL_CONFIG_AND_EVIDENCE_VALID_PRODUCTION_NO_GO'
        : 'BLOCKED',
      input.environment,
      [...new Set(errors)].sort(),
      safeRegistrationMode(evidence),
    );
  } catch {
    print('BLOCKED', input.environment, ['config_or_evidence:unreadable_or_invalid']);
  }
}

function parseArgs(argv) {
  const input = { environment: '', config: null, evidence: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--environment') input.environment = argv[++index] ?? '';
    else if (argv[index] === '--config') input.config = argv[++index] ?? null;
    else if (argv[index] === '--evidence') input.evidence = argv[++index] ?? null;
    else throw new Error('unknown_argument');
  }
  requireEnvironment(input.environment);
  return input;
}

function safeRegistrationMode(evidence) {
  const mode = record(record(evidence)?.client_registration)?.mode;
  return clientRegistrationModes.includes(mode) ? mode : null;
}

function print(status, environment, errors, registrationMode = null) {
  console.log(JSON.stringify({
    status,
    environment,
    errors,
    validated_client_registration_mode: registrationMode,
    required_managed_secret_names: staffMcpManagedSecrets,
    required_binding_names: ['STAFF_MCP_TOKEN_STATUS_SERVICE'],
    supported_client_registration_modes: clientRegistrationModes,
    external_calls: 0,
    provider_calls: 0,
    deployments: 0,
    resource_mutations: 0,
  }, null, 2));
  if (status === 'BLOCKED') process.exitCode = 1;
}

if (process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
