import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { canonicalJson } from '../packages/domain/src/serialization/canonical-json.ts';
import { DEFAULT_OPERATIONAL_ALERT_ENTRYPOINT,operationalAlertDescriptorFromService,parseExactGitCommitSha } from '../packages/domain/src/operational-alert-binding.ts';

const root = path.resolve(import.meta.dirname, '..');
const rootReal = realpathSync.native(root);
const environments = new Set(['staging', 'production']);
const placeholderPattern = /REQUIRED|REPLACE|PLACEHOLDER|CHANGEME|TODO/iu;
const disabledFlags = [
  'OUTBOX_DELIVERY_ENABLED',
  'DRIVE_ARCHIVE_ENABLED',
  'DRIVE_ARCHIVE_COPY_ENABLED',
  'DRIVE_ARCHIVE_PROXY_READ_ENABLED',
  'DRIVE_ARCHIVE_R2_DELETE_ENABLED',
];
const retiredCoreRuntimeKey = /^(?:FEISHU_|STAFF_AUTH_FEISHU|STAFF_MCP_)|^(?:STAFF_AUTH_PROVIDER|STAFF_AUTH_ENABLED|STAFF_AUTH_HASH_SECRET)$/u;

export const requiredManagedSecrets = Object.freeze({
  initial_auth: Object.freeze([
    'CUSTOMER_SESSION_SECRET',
    'CUSTOMER_SECURITY_TOKEN_SECRET',
  ]),
  capability_specific_before_separate_approval: Object.freeze([
    'KEYWORD_GENERATOR_SHARED_SECRET',
    'KEYWORD_HMAC_SECRET',
    'GOOGLE_DRIVE_CLIENT_SECRET',
    'GOOGLE_DRIVE_REFRESH_TOKEN',
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
  ]) {
    if (vars?.[key] !== origin) errors.push(`vars.${key}:origin_mismatch`);
  }
  if (!exactHttpsOrigin(vars?.STAFF_ACCESS_TEAM_DOMAIN)) {
    errors.push('vars.STAFF_ACCESS_TEAM_DOMAIN:invalid_https_origin');
  }
  if (!safeReleaseValue(vars?.STAFF_ACCESS_AUD, 200, 8)) {
    errors.push('vars.STAFF_ACCESS_AUD:missing_or_invalid');
  }
  if (environment === 'staging') {
    if (!/^yueguangbai-v2-staging(?:-[a-z0-9-]+)?$/u.test(String(record?.name ?? ''))) {
      errors.push('name:staging_resource_required');
    }
    if (!origin || !hasEnvironmentToken(new URL(origin).hostname, 'staging')) {
      errors.push('vars.APP_ORIGIN:staging_hostname_required');
    }
  }

  const route = exactOne(record?.routes);
  if (!route || route.custom_domain !== true || typeof route.pattern !== 'string') {
    errors.push('routes:invalid_custom_domain');
  } else if (!origin || route.pattern !== new URL(origin).hostname) {
    errors.push('routes.0.pattern:origin_mismatch');
  }
  const cron = exactOne(asRecord(record?.triggers)?.crons);
  if (environment === 'production') {
    if (typeof cron !== 'string' || cron.trim().split(/\s+/u).length !== 5) {
      errors.push('triggers.crons:invalid');
    }
  } else if (record?.triggers !== undefined) {
    errors.push('triggers:forbidden_when_scheduler_disabled');
  }
  const d1 = exactOne(record?.d1_databases);
  if (!d1 || d1.binding !== 'DB') errors.push('d1_databases:binding_invalid');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
    .test(String(d1?.database_id ?? ''))) errors.push('d1_databases.0.database_id:invalid');
  if (!isResourceName(d1?.database_name)) errors.push('d1_databases.0.database_name:invalid');
  if (environment === 'staging'
    && !/^yueguangbai-v2-staging(?:-[a-z0-9-]+)?$/u.test(String(d1?.database_name ?? ''))) {
    errors.push('d1_databases.0.database_name:staging_resource_required');
  }
  const r2 = exactOne(record?.r2_buckets);
  if (!r2 || r2.binding !== 'FILE_OBJECT_STORAGE_R2') {
    errors.push('r2_buckets:binding_invalid');
  }
  if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/u.test(String(r2?.bucket_name ?? ''))) {
    errors.push('r2_buckets.0.bucket_name:invalid');
  }
  if (environment === 'staging'
    && !/^yueguangbai-v2-staging-files(?:-[a-z0-9-]+)?$/u.test(String(r2?.bucket_name ?? ''))) {
    errors.push('r2_buckets.0.bucket_name:staging_resource_required');
  }
  for (const key of Object.keys(vars ?? {})) {
    if (retiredCoreRuntimeKey.test(key)) {
      errors.push(`vars.${key}:core_runtime_configuration_forbidden`);
    }
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
  if (!parseExactGitCommitSha(vars?.APP_RELEASE_SHA)
    && !(typeof vars?.APP_RELEASE_SHA==='string'&&placeholderPattern.test(vars.APP_RELEASE_SHA))) {
    errors.push('vars.APP_RELEASE_SHA:must_be_exact_git_sha');
  }
  validateAlertService(record.services, vars, environment, errors);
  const alertModeExpected = environment === 'production' ? 'bound' : 'disabled';
  if (vars?.OPERATIONAL_ALERT_MODE !== alertModeExpected) {
    errors.push(`vars.OPERATIONAL_ALERT_MODE:must_be_${alertModeExpected}`);
  }
  if (environment === 'production') {
    // The rendered service descriptor validator below owns every sink field.
  } else if (['OPERATIONAL_ALERT_SINK_SERVICE','OPERATIONAL_ALERT_SINK_ENTRYPOINT','OPERATIONAL_ALERT_SINK_IDENTITY','OPERATIONAL_ALERT_SINK_DEPLOYMENT_VERSION','OPERATIONAL_ALERT_SINK_CONFIG_FINGERPRINT'].some((key)=>vars?.[key]!==undefined)) {
    errors.push('vars.OPERATIONAL_ALERT_ATTESTATION:forbidden_outside_production');
  }
  const scheduledExpected = environment === 'production' ? 'true' : 'false';
  for (const flag of ['SCHEDULED_OPERATIONS_ENABLED', 'ACQUISITION_MAINTENANCE_ENABLED']) {
    if (vars?.[flag] !== scheduledExpected) {
      errors.push(`vars.${flag}:must_be_${scheduledExpected}`);
    }
  }
  if (environment === 'staging') {
    if (vars?.BUYER_SELF_REGISTRATION_ENABLED !== 'true') {
      errors.push('vars.BUYER_SELF_REGISTRATION_ENABLED:must_be_true');
    }
    if (vars?.BUYER_SELF_REGISTRATION_CHANNEL_ID !== 'staging-buyer-channel') {
      errors.push('vars.BUYER_SELF_REGISTRATION_CHANNEL_ID:invalid');
    }
    if (vars?.BUYER_SELF_REGISTRATION_HUMAN_VERIFICATION_REQUIRED !== 'false') {
      errors.push('vars.BUYER_SELF_REGISTRATION_HUMAN_VERIFICATION_REQUIRED:must_be_false');
    }
  }
  for (const flag of disabledFlags) {
    if (vars?.[flag] !== 'false') errors.push(`vars.${flag}:must_be_false`);
  }
  for (const key of Object.keys(vars ?? {})) {
    if (retiredCoreRuntimeKey.test(key)) {
      errors.push(`vars.${key}:core_runtime_configuration_forbidden`);
    }
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
  const observabilityExpected = true;
  if (asRecord(record.observability)?.enabled !== observabilityExpected) {
    errors.push(`observability.enabled:must_be_${String(observabilityExpected)}`);
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

function hasEnvironmentToken(value, token) {
  if (typeof value !== 'string') return false;
  const tokens = value.toLowerCase().split(/[^a-z0-9]+/u).filter(Boolean);
  return tokens.includes(token)
    && !tokens.includes('production')
    && !tokens.includes('prod')
    && !tokens.includes('default');
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

function validateAlertService(value, vars, environment, errors) {
  if (environment === 'production') {
    const service = exactOne(value);
    const props=asRecord(service?.props);
    if (!service||!allowedKeys(service,['binding','service','props'],['entrypoint'])||!props
      ||!exactKeys(props,['service_target','entrypoint','sink_identity','sink_deployment_version'])
      ||service.binding!=='OPERATIONAL_ALERT_SINK') {
      errors.push('services:operational_alert_sink_binding_required');
      return;
    }
    const entrypointMirror=Object.hasOwn(service,'entrypoint')
      ?service.entrypoint:DEFAULT_OPERATIONAL_ALERT_ENTRYPOINT;
    const rawMatches=props.service_target===service.service&&props.entrypoint===entrypointMirror
      &&vars?.OPERATIONAL_ALERT_SINK_SERVICE===service.service
      &&vars?.OPERATIONAL_ALERT_SINK_ENTRYPOINT===entrypointMirror
      &&vars?.OPERATIONAL_ALERT_SINK_IDENTITY===props.sink_identity
      &&vars?.OPERATIONAL_ALERT_SINK_DEPLOYMENT_VERSION===props.sink_deployment_version;
    if(!rawMatches)errors.push('services:operational_alert_descriptor_mismatch');
    const containsPlaceholder=placeholderPaths(service).length>0
      ||['OPERATIONAL_ALERT_SINK_SERVICE','OPERATIONAL_ALERT_SINK_IDENTITY','OPERATIONAL_ALERT_SINK_DEPLOYMENT_VERSION','OPERATIONAL_ALERT_SINK_CONFIG_FINGERPRINT'].some((key)=>typeof vars?.[key]==='string'&&placeholderPattern.test(vars[key]));
    if(containsPlaceholder){
      if(!(typeof vars?.OPERATIONAL_ALERT_SINK_CONFIG_FINGERPRINT==='string'&&placeholderPattern.test(vars.OPERATIONAL_ALERT_SINK_CONFIG_FINGERPRINT)))errors.push('vars.OPERATIONAL_ALERT_SINK_CONFIG_FINGERPRINT:operator_input_required');
      return;
    }
    const descriptor=operationalAlertDescriptorFromService(service);
    if(!descriptor){errors.push('services:operational_alert_descriptor_invalid');return;}
    const fingerprint=operationalAlertFingerprint(descriptor);
    if(vars?.OPERATIONAL_ALERT_SINK_CONFIG_FINGERPRINT!==fingerprint)errors.push('vars.OPERATIONAL_ALERT_SINK_CONFIG_FINGERPRINT:derived_mismatch');
    return;
  }
  if (value !== undefined && (!Array.isArray(value) || value.length !== 0)) {
    errors.push('services:forbidden_outside_production');
  }
}

export function operationalAlertFingerprint(descriptor){return createHash('sha256').update(canonicalJson(descriptor),'utf8').digest('hex');}

function safeReleaseValue(value, maximum, minimum = 1) {
  return typeof value === 'string'
    && value.length >= minimum
    && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/u.test(value)
    && !placeholderPattern.test(value);
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function exactOne(value) {
  return Array.isArray(value) && value.length === 1 ? asRecord(value[0]) ?? value[0] : null;
}

function exactKeys(value, expected) {
  const actual=Object.keys(value).sort(),keys=[...expected].sort();
  return actual.length===keys.length&&actual.every((key,index)=>key===keys[index]);
}

function allowedKeys(value, required, optional) {
  return required.every((key)=>Object.hasOwn(value,key))
    &&Object.keys(value).every((key)=>required.includes(key)||optional.includes(key));
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
