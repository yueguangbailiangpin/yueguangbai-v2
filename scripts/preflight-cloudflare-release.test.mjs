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
  readLocalReleaseConfig,
  requiredManagedSecrets,
  templatePath,
  validateReleaseConfig,
} from './preflight-cloudflare-release.mjs';

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

  it('rejects placeholders, missing bindings and duplicate/default resources', () => {
    const template = readLocalReleaseConfig(templatePath('production'));
    expect(validateReleaseConfig(template, 'production'))
      .toContain('account_id:placeholder');

    const config = anonymousConfig('production');
    config.d1_databases = [];
    config.services = [];
    config.r2_buckets = [
      { binding: 'FILE_OBJECT_STORAGE_R2', bucket_name: 'default' },
      { binding: 'FILE_OBJECT_STORAGE_R2', bucket_name: 'duplicate' },
    ];
    const errors = validateReleaseConfig(config, 'production');
    expect(errors).toContain('d1_databases:binding_invalid');
    expect(errors).toContain('r2_buckets:binding_invalid');
    expect(errors).toContain('services:staff_mcp_token_status_binding_invalid');
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
    if (value.endsWith('_ACCOUNT_ID')) return 'a'.repeat(32);
    if (value.endsWith('_WORKER_NAME')) return `ygb-${environment}`;
    if (value.endsWith('_CUSTOM_DOMAIN')) return `${environment}.example.invalid`;
    if (value.endsWith('_CRON')) return '0 * * * *';
    if (value.endsWith('_HTTPS_ORIGIN')) return origin;
    if (value.endsWith('_D1_NAME')) return `ygb_${environment}`;
    if (value.endsWith('_D1_ID')) return '11111111-1111-4111-8111-111111111111';
    if (value.endsWith('_R2_BUCKET_NAME')) return `ygb-${environment}-files`;
    if (value.endsWith('_FEISHU_AUTHORIZATION_ENDPOINT')) return 'https://feishu.example.invalid/authorize';
    if (value.endsWith('_FEISHU_TOKEN_ENDPOINT')) return 'https://feishu.example.invalid/token';
    if (value.endsWith('_FEISHU_IDENTITY_ENDPOINT')) return 'https://feishu.example.invalid/identity';
    if (value.endsWith('_FEISHU_APP_ID')) return `anonymous-${environment}-app`;
    if (value.endsWith('_FEISHU_SCOPE')) return 'anonymous:read';
    if (value.endsWith('_FEISHU_TENANT_KEY')) return `anonymous-${environment}-tenant`;
    if (value.endsWith('_FEISHU_REDIRECT_URI')) return `${origin}/api/staff-auth/feishu/callback`;
    if (value.endsWith('_FEISHU_WORKBENCH_APP_ID')) return `anonymous-${environment}-workbench-app`;
    if (value.endsWith('_FEISHU_WORKBENCH_TENANT_KEY')) return `anonymous-${environment}-workbench-tenant`;
    if (value.endsWith('_STAFF_MCP_RESOURCE')) return `${origin}/mcp`;
    if (value.endsWith('_STAFF_MCP_OAUTH_ISSUER')) return 'https://issuer.example.invalid/';
    if (value.endsWith('_STAFF_MCP_OAUTH_METADATA_URL')) return 'https://issuer.example.invalid/.well-known/oauth-authorization-server';
    if (value.endsWith('_STAFF_MCP_OAUTH_AUTHORIZATION_ENDPOINT')) return 'https://issuer.example.invalid/authorize';
    if (value.endsWith('_STAFF_MCP_OAUTH_TOKEN_ENDPOINT')) return 'https://issuer.example.invalid/token';
    if (value.endsWith('_STAFF_MCP_OAUTH_JWKS_URI')) return 'https://issuer.example.invalid/jwks';
    if (value.endsWith('_STAFF_MCP_OAUTH_REVOCATION_ENDPOINT')) return 'https://issuer.example.invalid/revoke';
    if (value.endsWith('_STAFF_MCP_TOKEN_STATUS_SERVICE')) return `ygb-${environment}-token-status`;
    throw new Error(`unmapped_placeholder:${value}`);
  });
  return config;
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
