import { pathToFileURL } from 'node:url';
import {
  externalReleaseConfigPath,
  readLocalReleaseConfig,
  templatePath,
} from './preflight-cloudflare-release.mjs';

export const feishuWorkbenchManagedSecretNames = Object.freeze([
  'FEISHU_WORKBENCH_APP_SECRET',
  'FEISHU_WORKBENCH_ENCRYPT_KEY',
  'FEISHU_WORKBENCH_VERIFICATION_TOKEN',
]);

export function inspectFeishuWorkbenchActivationTemplate(environment) {
  const config = readLocalReleaseConfig(templatePath(environment));
  const vars = record(config.vars);
  const errors = validateTemplateFields(vars, environment);
  if (vars?.FEISHU_WORKBENCH_SYNC_ENABLED !== 'false') errors.push('sync:default_must_be_disabled');
  if (vars?.FEISHU_WORKBENCH_CALLBACK_ENABLED !== 'false') errors.push('callback:default_must_be_disabled');
  if (vars?.FEISHU_OPERATIONAL_ALERT_ENABLED !== 'false') errors.push('operational_alert:template_must_be_disabled');
  if (vars?.ACQUISITION_MAINTENANCE_ENABLED !== 'false') errors.push('acquisition_maintenance:template_must_be_disabled');
  if (vars?.STAFF_AUTH_ENABLED !== 'false') errors.push('staff_auth:template_default_must_remain_independent_and_disabled');
  return Object.freeze({
    status: errors.length === 0 ? 'LOCAL_NO_GO' : 'INVALID_TEMPLATE',
    environment,
    migration_decision: 'NO_SCHEMA_CHANGE',
    callback_path: '/api/feishu-workbench/callback',
    required_managed_secret_names: feishuWorkbenchManagedSecretNames,
    activation_order: Object.freeze([
      'inject_managed_secrets_without_printing_values',
      'register_official_https_callback',
      'run_real_provider_acceptance_with_owner_approval',
      'enable_callback_then_sync_in_a_controlled_window',
    ]),
    rollback_order: Object.freeze([
      'set_FEISHU_WORKBENCH_SYNC_ENABLED_false',
      'set_FEISHU_WORKBENCH_CALLBACK_ENABLED_false',
      'keep_ACQUISITION_MAINTENANCE_ENABLED_false',
      'keep_D1_business_facts_and_outbox_intact',
      'revoke_or_rotate_provider_credentials_outside_this_change',
    ]),
    blockers: Object.freeze([
      'managed_secret_presence_not_checked_locally',
      'real_tenant_permissions_not_checked_locally',
      'real_callback_registration_not_checked_locally',
      'real_provider_send_receive_not_checked_locally',
      'owner_approval_not_recorded',
    ]),
    external_calls: 0,
    provider_calls: 0,
    resource_mutations: 0,
    errors: Object.freeze([...new Set(errors)].sort()),
  });
}

function validateTemplateFields(vars, environment) {
  const errors = [];
  if (!vars) return ['vars:not_object'];
  if (vars.APP_ENVIRONMENT !== environment) errors.push('environment:mismatch');
  if (vars.APP_ORIGIN !== vars.FEISHU_WORKBENCH_WEB_ORIGIN
    || !String(vars.APP_ORIGIN ?? '').startsWith(`REQUIRED_${environment.toUpperCase()}_HTTPS_ORIGIN`)) {
    errors.push('web_origin:template_placeholder_invalid');
  }
  if (vars.FEISHU_WORKBENCH_API_ORIGIN !== 'https://open.feishu.cn') errors.push('api_origin:official_origin_required');
  for (const key of ['FEISHU_WORKBENCH_APP_ID', 'FEISHU_WORKBENCH_TENANT_KEY']) {
    if (!String(vars[key] ?? '').startsWith(`REQUIRED_${environment.toUpperCase()}_FEISHU_WORKBENCH_`)) {
      errors.push(`${key}:template_placeholder_invalid`);
    }
  }
  for (const [key, minimum, maximum] of [
    ['FEISHU_WORKBENCH_REQUEST_TIMEOUT_MS', 100, 10_000],
    ['FEISHU_WORKBENCH_MAX_ATTEMPTS', 1, 3],
    ['FEISHU_WORKBENCH_RATE_LIMIT_PER_SECOND', 1, 10],
  ]) {
    const value = String(vars[key] ?? '');
    if (!/^\d+$/u.test(value) || Number(value) < minimum || Number(value) > maximum) errors.push(`${key}:invalid`);
  }
  return errors;
}

export function validateFeishuWorkbenchActivationConfig(config, environment, declaredSecretNames = []) {
  const root = record(config);
  const vars = record(root?.vars);
  const errors = validateStaticFields(vars, environment);
  if (vars?.SCHEDULED_OPERATIONS_ENABLED !== 'true') errors.push('scheduled_operations:must_be_enabled');
  if (vars?.ACQUISITION_MAINTENANCE_ENABLED !== 'false') errors.push('acquisition_maintenance:must_be_disabled');
  const disabled = new Set(String(vars?.SCHEDULED_OPERATIONS_DISABLED_JOBS ?? '').split(',').map((value) => value.trim()).filter(Boolean));
  const requiredDisabled = ['reservation_expiry', 'instruction_expiry', 'outbox_delivery', 'file_orphan_cleanup', 'staff_auth_cleanup', 'drive_archive'];
  if (disabled.size !== requiredDisabled.length || requiredDisabled.some((name) => !disabled.has(name))) {
    errors.push('scheduled_operations:feishu_only_job_set_required');
  }
  if (vars?.FEISHU_WORKBENCH_SYNC_ENABLED !== 'true') errors.push('sync:not_enabled');
  if (vars?.FEISHU_WORKBENCH_CALLBACK_ENABLED !== 'true') errors.push('callback:not_enabled');
  if (vars?.FEISHU_OPERATIONAL_ALERT_ENABLED !== 'false') errors.push('operational_alert:must_remain_disabled');
  const declared = new Set(declaredSecretNames);
  for (const name of feishuWorkbenchManagedSecretNames) {
    if (!declared.has(name)) errors.push(`managed_secret.${name}:not_declared`);
  }
  for (const key of Object.keys(vars ?? {})) {
    if (/SECRET|ENCRYPT_KEY|VERIFICATION_TOKEN/iu.test(key)) errors.push(`vars.${key}:managed_secret_forbidden`);
  }
  return Object.freeze([...new Set(errors)].sort());
}

function validateStaticFields(vars, environment) {
  const errors = [];
  if (!vars) return ['vars:not_object'];
  if (vars.APP_ENVIRONMENT !== environment) errors.push('environment:mismatch');
  const origin = httpsOrigin(vars.APP_ORIGIN);
  if (!origin || vars.FEISHU_WORKBENCH_WEB_ORIGIN !== origin) errors.push('web_origin:mismatch_or_invalid');
  if (vars.FEISHU_WORKBENCH_API_ORIGIN !== 'https://open.feishu.cn') errors.push('api_origin:official_origin_required');
  if (!safe(vars.FEISHU_WORKBENCH_APP_ID, 128)) errors.push('app_id:missing_or_invalid');
  if (!safe(vars.FEISHU_WORKBENCH_TENANT_KEY, 200)) errors.push('tenant_key:missing_or_invalid');
  for (const [key, minimum, maximum] of [
    ['FEISHU_WORKBENCH_REQUEST_TIMEOUT_MS', 100, 10_000],
    ['FEISHU_WORKBENCH_MAX_ATTEMPTS', 1, 3],
    ['FEISHU_WORKBENCH_RATE_LIMIT_PER_SECOND', 1, 10],
  ]) {
    const value = String(vars[key] ?? '');
    if (!/^\d+$/u.test(value) || Number(value) < minimum || Number(value) > maximum) errors.push(`${key}:invalid`);
  }
  return errors;
}

function httpsOrigin(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.pathname === '/' && !url.search && !url.hash
      && !url.username && !url.password ? url.origin : null;
  } catch { return null; }
}
function safe(value, maximum) {
  return typeof value === 'string' && value.length >= 1 && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/u.test(value) && !/REQUIRED|REPLACE|PLACEHOLDER|CHANGEME|TODO/iu.test(value);
}
function record(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : null; }

function main(argv) {
  const configIndex=argv.indexOf('--config');
  if(configIndex>=0){
    const environmentIndex=argv.indexOf('--environment');
    const environment=environmentIndex>=0?argv[environmentIndex+1]:null;
    if(!['staging','production'].includes(environment)){
      process.stdout.write(`${JSON.stringify({status:'INVALID_ARGUMENT',errors:['environment:invalid'],external_calls:0,provider_calls:0,resource_mutations:0})}\n`);
      process.exitCode=1;return;
    }
    const resolved=externalReleaseConfigPath(argv[configIndex+1]);
    if(resolved.error||!resolved.file){
      process.stdout.write(`${JSON.stringify({status:'BLOCKED',errors:[resolved.error??'config_path:invalid'],external_calls:0,provider_calls:0,resource_mutations:0})}\n`);
      process.exitCode=1;return;
    }
    let config;
    try{config=readLocalReleaseConfig(resolved.file);}catch{
      process.stdout.write(`${JSON.stringify({status:'BLOCKED',errors:['config:unreadable_or_invalid'],external_calls:0,provider_calls:0,resource_mutations:0})}\n`);
      process.exitCode=1;return;
    }
    const declared=[];
    for(let index=0;index<argv.length;index+=1)if(argv[index]==='--declared-secret'&&argv[index+1])declared.push(argv[index+1]);
    const errors=validateFeishuWorkbenchActivationConfig(config,environment,declared);
    process.stdout.write(`${JSON.stringify({status:errors.length===0?'LOCAL_STRUCTURE_VALID_PRODUCTION_NO_GO':'BLOCKED',environment,errors,blockers:['real_provider_acceptance_absent','owner_approval_absent'],external_calls:0,provider_calls:0,resource_mutations:0})}\n`);
    if(errors.length>0)process.exitCode=1;
    return;
  }
  const environments = argv.includes('--environment')
    ? [argv[argv.indexOf('--environment') + 1]] : ['staging', 'production'];
  if (environments.some((value) => !['staging', 'production'].includes(value))) {
    process.stdout.write(`${JSON.stringify({ status: 'INVALID_ARGUMENT', external_calls: 0 })}\n`);
    process.exitCode = 1;
    return;
  }
  const reports = environments.map(inspectFeishuWorkbenchActivationTemplate);
  process.stdout.write(`${JSON.stringify({ status: reports.every((report) => report.status === 'LOCAL_NO_GO') ? 'LOCAL_NO_GO' : 'INVALID_TEMPLATE', reports })}\n`);
  if (reports.some((report) => report.status !== 'LOCAL_NO_GO')) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2));
