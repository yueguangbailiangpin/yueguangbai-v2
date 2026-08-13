import { describe, expect, it } from 'vitest';
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  externalReleaseConfigPath,
  inspectReleaseTemplate,
  operationalAlertFingerprint,
  readLocalReleaseConfig,
  requiredManagedSecrets,
  templatePath,
  validateReleaseConfig,
} from './preflight-cloudflare-release.mjs';
import { operationalAlertDescriptorFromService } from '../packages/domain/src/operational-alert-binding.ts';

const root = path.resolve(import.meta.dirname, '..');
const script = path.join(root, 'scripts/preflight-cloudflare-release.mjs');

describe('Cloudflare release preflight', () => {
  for (const environment of ['staging', 'production']) {
    it(`reports ${environment} operator fields without treating the template as deployable`, () => {
      const report = inspectReleaseTemplate(environment);
      expect(report.status).toBe('BLOCKED_NEEDS_OPERATOR_INPUT');
      expect(report.required_fields).toContain('account_id');
      expect(report.required_fields).toContain('d1_databases.0.database_id');
      expect(report.required_fields).toContain('r2_buckets.0.bucket_name');
      expect(report.external_calls).toBe(0);
      expect(report.deployments).toBe(0);
      expect(report.resource_mutations).toBe(0);
    });

    it(`accepts only a complete anonymous ${environment} rendering`, () => {
      const config = anonymousConfig(environment);
      expect(validateReleaseConfig(config, environment)).toEqual([]);
      config.vars.DRIVE_ARCHIVE_R2_DELETE_ENABLED = 'true';
      expect(validateReleaseConfig(config, environment))
        .toContain('vars.DRIVE_ARCHIVE_R2_DELETE_ENABLED:must_be_false');
    });
  }

  it('rejects embedded secrets and never serializes their values', () => {
    const config = anonymousConfig('production');
    config.vars.CUSTOMER_SESSION_SECRET = 'must-never-appear-in-output';
    const errors = validateReleaseConfig(config, 'production');
    expect(errors).toContain('vars.CUSTOMER_SESSION_SECRET:managed_secret_forbidden');
    const serialized = JSON.stringify({ errors, requiredManagedSecrets });
    expect(serialized).not.toContain('must-never-appear-in-output');
    expect(serialized).toContain('CUSTOMER_SESSION_SECRET');
  });

  it('rejects environment and origin/domain mismatches', () => {
    const config = anonymousConfig('staging');
    config.vars.APP_ENVIRONMENT = 'production';
    config.routes[0].pattern = 'wrong.example.invalid';
    const errors = validateReleaseConfig(config, 'staging');
    expect(errors).toContain('vars.APP_ENVIRONMENT:wrong_environment');
    expect(errors).toContain('routes.0.pattern:origin_mismatch');
  });

  it('requires a canonical bound production sink descriptor and derived fingerprint', () => {
    const config = anonymousConfig('production');
    config.vars.OPERATIONAL_ALERT_MODE = 'disabled';
    delete config.vars.OPERATIONAL_ALERT_SINK_IDENTITY;
    config.vars.OPERATIONAL_ALERT_SINK_CONFIG_FINGERPRINT = 'invalid';
    config.services = [];
    const errors = validateReleaseConfig(config, 'production');
    expect(errors).toContain('vars.OPERATIONAL_ALERT_MODE:must_be_bound');
    expect(errors).toContain('services:operational_alert_sink_binding_required');
    const staging = anonymousConfig('staging');
    expect(staging.vars).toMatchObject({ OPERATIONAL_ALERT_MODE: 'disabled' });
    expect(validateReleaseConfig(staging, 'staging')).toEqual([]);
  });

  it('rejects stale fingerprints after service, entrypoint, props, identity or deployment-version drift',()=>{
    const mutations=[
      (config)=>{config.services[0].service='ygb-operational-alerts-b';config.services[0].props.service_target='ygb-operational-alerts-b';config.vars.OPERATIONAL_ALERT_SINK_SERVICE='ygb-operational-alerts-b';},
      (config)=>{config.services[0].entrypoint='OtherEntrypoint';config.services[0].props.entrypoint='OtherEntrypoint';config.vars.OPERATIONAL_ALERT_SINK_ENTRYPOINT='OtherEntrypoint';},
      (config)=>{config.services[0].props.extra='not-allowed';},
      (config)=>{config.services[0].props.sink_identity='service:operations-other';config.vars.OPERATIONAL_ALERT_SINK_IDENTITY='service:operations-other';},
      (config)=>{config.services[0].props.sink_deployment_version='deploy-002';config.vars.OPERATIONAL_ALERT_SINK_DEPLOYMENT_VERSION='deploy-002';},
    ];
    for(const mutate of mutations){const config=anonymousConfig('production');mutate(config);expect(validateReleaseConfig(config,'production')).not.toEqual([]);}
  });

  it('canonicalizes an omitted service entrypoint as the explicit runtime default',()=>{
    const config=anonymousConfig('production');delete config.services[0].entrypoint;config.services[0].props.entrypoint='default';config.vars.OPERATIONAL_ALERT_SINK_ENTRYPOINT='default';config.vars.OPERATIONAL_ALERT_SINK_CONFIG_FINGERPRINT=operationalAlertFingerprint(operationalAlertDescriptorFromService(config.services[0]));
    expect(validateReleaseConfig(config,'production')).toEqual([]);
  });

  it('fails closed for the previous null mirror input and missing runtime mirror',()=>{
    const previousInput=anonymousConfig('production');delete previousInput.services[0].entrypoint;previousInput.services[0].props.entrypoint=null;previousInput.vars.OPERATIONAL_ALERT_SINK_ENTRYPOINT='default';
    expect(validateReleaseConfig(previousInput,'production')).not.toEqual([]);
    const missingRuntime=anonymousConfig('production');delete missingRuntime.vars.OPERATIONAL_ALERT_SINK_ENTRYPOINT;
    expect(validateReleaseConfig(missingRuntime,'production')).not.toEqual([]);
  });

  it('uses one strict named-entrypoint algorithm for rendered and runtime mirrors',()=>{
    const dollar=anonymousConfig('production');setEntrypoint(dollar,'$sink');
    expect(validateReleaseConfig(dollar,'production')).toContain('vars.OPERATIONAL_ALERT_SINK_CONFIG_FINGERPRINT:derived_mismatch');
    dollar.vars.OPERATIONAL_ALERT_SINK_CONFIG_FINGERPRINT=operationalAlertFingerprint(operationalAlertDescriptorFromService(dollar.services[0]));
    expect(validateReleaseConfig(dollar,'production')).toEqual([]);

    const underscoreDollar=anonymousConfig('production');setEntrypoint(underscoreDollar,'_$sink');
    underscoreDollar.vars.OPERATIONAL_ALERT_SINK_CONFIG_FINGERPRINT=operationalAlertFingerprint(operationalAlertDescriptorFromService(underscoreDollar.services[0]));
    expect(validateReleaseConfig(underscoreDollar,'production')).toEqual([]);
    expect(underscoreDollar.vars.OPERATIONAL_ALERT_SINK_CONFIG_FINGERPRINT).not.toBe(dollar.vars.OPERATIONAL_ALERT_SINK_CONFIG_FINGERPRINT);

    for(const entrypoint of [' white','with.dot']){
      const invalid=anonymousConfig('production');setEntrypoint(invalid,entrypoint);
      expect(validateReleaseConfig(invalid,'production')).not.toEqual([]);
    }
  });

  it('requires an exact 40-character hexadecimal release SHA while treating the template placeholder as operator input',()=>{
    expect(inspectReleaseTemplate('production')).toMatchObject({status:'BLOCKED_NEEDS_OPERATOR_INPUT',errors:[]});
    for(const value of [undefined,'abc1234','g'.repeat(40),'a'.repeat(39),'a'.repeat(41),'REQUIRED_RELEASE_COMMIT_SHA']){
      const config=anonymousConfig('production');
      if(value===undefined)delete config.vars.APP_RELEASE_SHA;else config.vars.APP_RELEASE_SHA=value;
      expect(validateReleaseConfig(config,'production')).toContain(value==='REQUIRED_RELEASE_COMMIT_SHA'?'vars.APP_RELEASE_SHA:placeholder':'vars.APP_RELEASE_SHA:must_be_exact_git_sha');
    }
  });

  it('rejects retired and optional runtime configuration in the core release', () => {
    const config = anonymousConfig('production');
    config.vars.FEISHU_WORKBENCH_SYNC_ENABLED = 'false';
    config.vars.STAFF_MCP_ENABLED = 'false';
    config.vars.STAFF_ACCESS_TEAM_DOMAIN = 'http://team.cloudflareaccess.com';
    config.vars.STAFF_ACCESS_AUD = 'short';
    const errors = validateReleaseConfig(config, 'production');
    expect(errors).toContain('vars.FEISHU_WORKBENCH_SYNC_ENABLED:core_runtime_configuration_forbidden');
    expect(errors).toContain('vars.STAFF_MCP_ENABLED:core_runtime_configuration_forbidden');
    expect(errors).toContain('vars.STAFF_ACCESS_TEAM_DOMAIN:invalid_https_origin');
    expect(errors).toContain('vars.STAFF_ACCESS_AUD:missing_or_invalid');
  });

  it('rejects placeholders, missing bindings and duplicate/default resources', () => {
    const template = readLocalReleaseConfig(templatePath('production'));
    expect(validateReleaseConfig(template, 'production'))
      .toContain('account_id:placeholder');

    const config = anonymousConfig('production');
    config.d1_databases = [];
    config.services = [{
      binding: 'STAFF_MCP_TOKEN_STATUS_SERVICE',
      service: 'obsolete-token-status-service',
    }];
    config.r2_buckets = [
      { binding: 'FILE_OBJECT_STORAGE_R2', bucket_name: 'default' },
      { binding: 'FILE_OBJECT_STORAGE_R2', bucket_name: 'duplicate' },
    ];
    const errors = validateReleaseConfig(config, 'production');
    expect(errors).toContain('d1_databases:binding_invalid');
    expect(errors).toContain('r2_buckets:binding_invalid');
    expect(errors).toContain('services:operational_alert_sink_binding_required');
  });

  it('allows only real files outside the repository by lexical and real path', () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'ygb-release-config-'));
    const inside = mkdtempSync(path.join(root, '.preflight-path-test-'));
    try {
      const outsideConfig = path.join(outside, 'production.jsonc');
      writeFileSync(outsideConfig, JSON.stringify(anonymousConfig('production')));
      const insideTemplate = templatePath('production');
      const insideLink = path.join(inside, 'outside-link.jsonc');
      const outsideLink = path.join(outside, 'inside-link.jsonc');
      symlinkSync(outsideConfig, insideLink);
      symlinkSync(insideTemplate, outsideLink);

      expect(externalReleaseConfigPath(outsideConfig)).toMatchObject({
        file: realpathSync.native(outsideConfig),
        error: null,
      });
      for (const blocked of [insideTemplate, insideLink, outsideLink]) {
        expect(externalReleaseConfigPath(blocked)).toMatchObject({
          file: null,
          error: 'config_path:repository_location_forbidden',
        });
        const result = runConfig(blocked);
        expect(result.status).not.toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({
          status: 'BLOCKED',
          errors: ['config_path:repository_location_forbidden'],
        });
        expect(result.stdout).not.toContain(blocked);
      }

      const relative = runConfig('apps/api/wrangler.production.template.jsonc');
      expect(relative.status).not.toBe(0);
      expect(JSON.parse(relative.stdout).errors)
        .toEqual(['config_path:not_absolute']);

      const allowed = runConfig(outsideConfig);
      expect(allowed.status).toBe(0);
      expect(JSON.parse(allowed.stdout).status).toBe('LOCAL_CONFIG_VALID');
    } finally {
      rmSync(inside, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('redacts external config values at the command entrypoint', () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'ygb-release-redaction-'));
    try {
      const file = path.join(outside, 'production.jsonc');
      const config = anonymousConfig('production');
      config.vars.CUSTOMER_SESSION_SECRET = 'must-never-appear-in-cli-output';
      writeFileSync(file, JSON.stringify(config));
      const result = runConfig(file);
      expect(result.status).not.toBe(0);
      expect(result.stdout).toContain('CUSTOMER_SESSION_SECRET');
      expect(result.stdout).not.toContain('must-never-appear-in-cli-output');
      expect(result.stdout).not.toContain(file);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

function runConfig(file) {
  return spawnSync(process.execPath, [
    script,
    '--environment', 'production',
    '--config', file,
  ], { encoding: 'utf8' });
}

function anonymousConfig(environment) {
  const config = structuredClone(readLocalReleaseConfig(templatePath(environment)));
  const origin = `https://${environment}.example.invalid`;
  replacePlaceholders(config, (value) => {
    if (value === 'REQUIRED_RELEASE_COMMIT_SHA') return 'a'.repeat(40);
    if (value === 'REQUIRED_PRODUCTION_OPERATIONAL_ALERT_SINK_IDENTITY') return 'service:operations-primary';
    if (value === 'REQUIRED_PRODUCTION_OPERATIONAL_ALERT_SINK_CONFIG_SHA256') return '0'.repeat(64);
    if (value === 'REQUIRED_PRODUCTION_OPERATIONAL_ALERT_SINK_DEPLOYMENT_VERSION') return 'deploy-001';
    if (value === 'REQUIRED_PRODUCTION_OPERATIONAL_ALERT_SERVICE') return 'ygb-operational-alerts';
    if (value.endsWith('_CLOUDFLARE_ACCESS_TEAM_HTTPS_ORIGIN')
      || value === 'REQUIRED_CLOUDFLARE_ACCESS_TEAM_HTTPS_ORIGIN') {
      return `https://${environment}-team.cloudflareaccess.com`;
    }
    if (value.endsWith('_CLOUDFLARE_ACCESS_APPLICATION_AUD')
      || value === 'REQUIRED_CLOUDFLARE_ACCESS_APPLICATION_AUD') {
      return `anonymous-${environment}-access-audience`;
    }
    if (value.endsWith('_ACCOUNT_ID')) return 'a'.repeat(32);
    if (value.endsWith('_WORKER_NAME')) return `ygb-${environment}`;
    if (value.endsWith('_CUSTOM_DOMAIN')) return `${environment}.example.invalid`;
    if (value.endsWith('_CRON')) return '0 * * * *';
    if (value.endsWith('_HTTPS_ORIGIN')) return origin;
    if (value.endsWith('_D1_NAME')) return `ygb_${environment}`;
    if (value.endsWith('_D1_ID')) return '11111111-1111-4111-8111-111111111111';
    if (value.endsWith('_R2_BUCKET_NAME')) return `ygb-${environment}-files`;
    throw new Error(`unmapped_placeholder:${value}`);
  });
  if(environment==='production')config.vars.OPERATIONAL_ALERT_SINK_CONFIG_FINGERPRINT=operationalAlertFingerprint(operationalAlertDescriptorFromService(config.services[0]));
  return config;
}

function setEntrypoint(config,entrypoint){
  config.services[0].entrypoint=entrypoint;
  config.services[0].props.entrypoint=entrypoint;
  config.vars.OPERATIONAL_ALERT_SINK_ENTRYPOINT=entrypoint;
}

function replacePlaceholders(value, replacement) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      if (typeof item === 'string' && item.startsWith('REQUIRED_')) value[index] = replacement(item);
      else replacePlaceholders(item, replacement);
    });
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string' && item.startsWith('REQUIRED_')) value[key] = replacement(item);
    else replacePlaceholders(item, replacement);
  }
}
