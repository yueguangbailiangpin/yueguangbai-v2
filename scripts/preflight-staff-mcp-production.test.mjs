import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  inspectStaffMcpTemplate,
  staffMcpManagedSecrets,
  staffMcpProductionAvailableTools,
  validateStaffMcpActivationEvidence,
  validateStaffMcpRenderedConfig,
} from './preflight-staff-mcp-production.mjs';

describe('Staff MCP production preflight', () => {
  for (const environment of ['staging', 'production']) {
    it(`keeps ${environment} template blocked, disabled and zero-network`, () => {
      const report = inspectStaffMcpTemplate(environment);
      expect(report.status).toBe('BLOCKED_NEEDS_OPERATOR_INPUT');
      expect(report.required_fields).toContain('vars.STAFF_MCP_RESOURCE');
      expect(report.required_binding_fields).toEqual([
        'services.STAFF_MCP_TOKEN_STATUS_SERVICE.service',
      ]);
      expect(report.required_managed_secret_names)
        .toEqual(['STAFF_MCP_BINDING_HASH_SECRET']);
      expect(report).toMatchObject({
        external_calls: 0,
        provider_calls: 0,
        deployments: 0,
        resource_mutations: 0,
        errors: [],
      });
    });
  }

  it('accepts an anonymous complete shape without receiving Secret values', () => {
    const config = anonymousConfig();
    expect(validateStaffMcpRenderedConfig(config, 'production')).toEqual([]);
    config.vars.STAFF_MCP_BINDING_HASH_SECRET = 'must-not-appear';
    const errors = validateStaffMcpRenderedConfig(config, 'production');
    expect(errors).toContain(
      'vars.STAFF_MCP_BINDING_HASH_SECRET:managed_secret_forbidden',
    );
    expect(JSON.stringify({ errors, staffMcpManagedSecrets }))
      .not.toContain('must-not-appear');
  });

  it('rejects disabled, local mock, resource and OAuth boundary drift', () => {
    const config = anonymousConfig();
    config.vars.STAFF_MCP_ENABLED = 'false';
    config.vars.STAFF_MCP_LOCAL_MOCK_ENABLED = 'true';
    config.vars.STAFF_MCP_RESOURCE = 'https://other.invalid/mcp';
    config.vars.STAFF_MCP_OAUTH_JWKS_URI = 'http://issuer.invalid/jwks';
    config.routes[0].pattern = 'other.invalid';
    config.vars.STAFF_MCP_RESOURCE_POLICY_URL = 'https://other.invalid/privacy';
    config.vars.STAFF_MCP_ENABLED_TOOLS = [
      'list_staff_tasks_v1',
      'read_task_screenshot_v1',
    ].join(',');
    expect(validateStaffMcpRenderedConfig(config, 'production')).toEqual(
      expect.arrayContaining([
        'vars.STAFF_MCP_ENABLED:must_be_true',
        'vars.STAFF_MCP_LOCAL_MOCK_ENABLED:must_be_false',
        'vars.STAFF_MCP_RESOURCE:origin_mismatch',
        'vars.STAFF_MCP_OAUTH_JWKS_URI:invalid_https_url',
        'routes.0.pattern:origin_mismatch',
        'vars.STAFF_MCP_RESOURCE_POLICY_URL:invalid_public_url',
        'vars.STAFF_MCP_ENABLED_TOOLS:invalid_tool_set',
      ]),
    );
  });

  it('validates Git-external activation evidence without treating it as production GO', () => {
    const config = anonymousConfig();
    const evidence = anonymousEvidence(config);
    expect(validateStaffMcpActivationEvidence(evidence, config, 'production')).toEqual([]);

    evidence.resource = 'https://other.invalid/mcp';
    evidence.client_registration.pkce_method = 'plain';
    evidence.enabled_tools = ['get_order_summary_v1'];
    expect(validateStaffMcpActivationEvidence(evidence, config, 'production')).toEqual(
      expect.arrayContaining([
        'evidence.resource:mismatch',
        'evidence.client_registration.pkce_method:must_be_s256',
        'evidence.enabled_tools:config_mismatch',
      ]),
    );
  });

  it('accepts only exact mode-specific client registration evidence', () => {
    const config = anonymousConfig();
    const cimd = anonymousEvidence(config);
    cimd.client_registration = {
      mode: 'client_id_metadata_document',
      client_id: 'https://client.invalid/mcp-client.json',
      redirect_uris: ['https://client.invalid/oauth/callback'],
      pkce_method: 'S256',
    };
    expect(validateStaffMcpActivationEvidence(cimd, config, 'production')).toEqual([]);

    const dcr = anonymousEvidence(config);
    dcr.client_registration = {
      mode: 'dynamic_client_registration',
      registration_endpoint: 'https://issuer.invalid/register',
      redirect_uris: ['https://client.invalid/oauth/callback'],
      pkce_method: 'S256',
    };
    expect(validateStaffMcpActivationEvidence(dcr, config, 'production')).toEqual([]);
    dcr.client_registration.redirect_uris = ['http://client.invalid/callback'];
    expect(validateStaffMcpActivationEvidence(dcr, config, 'production'))
      .toContain('evidence.client_registration.redirect_uris:invalid');
  });

  it('validates only paired Git-external files and redacts supplied values', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'ygb-staff-mcp-preflight-'));
    try {
      const configFile = path.join(directory, 'production.jsonc');
      const evidenceFile = path.join(directory, 'production-evidence.json');
      const config = anonymousConfig();
      const evidence = anonymousEvidence(config);
      writeFileSync(configFile, JSON.stringify(config));
      writeFileSync(evidenceFile, JSON.stringify(evidence));
      const result = runCli(configFile, evidenceFile);
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        status: 'LOCAL_CONFIG_AND_EVIDENCE_VALID_PRODUCTION_NO_GO',
        errors: [],
        validated_client_registration_mode: 'pre_registered',
        external_calls: 0,
        provider_calls: 0,
        deployments: 0,
        resource_mutations: 0,
      });
      for (const supplied of [
        configFile,
        evidenceFile,
        evidence.client_registration.client_id,
        evidence.client_registration.redirect_uris[0],
        evidence.resource,
      ]) expect(result.stdout).not.toContain(supplied);

      const repositoryEvidence = runCli(
        configFile,
        path.resolve(import.meta.dirname, '../docs/runbooks/STAFF_MCP_ACTIVATION_EVIDENCE.example.json'),
      );
      expect(repositoryEvidence.status).not.toBe(0);
      expect(JSON.parse(repositoryEvidence.stdout).errors)
        .toContain('evidence_path:repository_location_forbidden');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

function runCli(configFile, evidenceFile) {
  return spawnSync(process.execPath, [
    path.resolve(import.meta.dirname, 'preflight-staff-mcp-production.mjs'),
    '--environment', 'production',
    '--config', configFile,
    '--evidence', evidenceFile,
  ], { encoding: 'utf8' });
}

function anonymousConfig() {
  return {
    vars: {
      APP_ENVIRONMENT: 'production',
      APP_ORIGIN: 'https://staff-mcp.invalid',
      STAFF_MCP_ENABLED: 'true',
      STAFF_MCP_PRODUCTION_TRANSPORT_ENABLED: 'true',
      STAFF_MCP_LOCAL_MOCK_ENABLED: 'false',
      STAFF_MCP_CLEANUP_ENABLED: 'true',
      STAFF_MCP_CLEANUP_LIMIT: '100',
      STAFF_MCP_DISABLED_TOOLS: '',
      STAFF_MCP_ENABLED_TOOLS: staffMcpProductionAvailableTools.join(','),
      STAFF_MCP_RESOURCE: 'https://staff-mcp.invalid/mcp',
      STAFF_MCP_RESOURCE_DOCUMENTATION_URL:
        'https://staff-mcp.invalid/staff-mcp-guide',
      STAFF_MCP_RESOURCE_POLICY_URL:
        'https://staff-mcp.invalid/privacy/staff-mcp',
      STAFF_MCP_OAUTH_AUDIENCE: 'https://staff-mcp.invalid/mcp',
      STAFF_MCP_OAUTH_ISSUER: 'https://issuer.invalid/',
      STAFF_MCP_OAUTH_METADATA_URL:
        'https://issuer.invalid/.well-known/oauth-authorization-server',
      STAFF_MCP_OAUTH_AUTHORIZATION_ENDPOINT:
        'https://issuer.invalid/authorize',
      STAFF_MCP_OAUTH_TOKEN_ENDPOINT: 'https://issuer.invalid/token',
      STAFF_MCP_OAUTH_JWKS_URI: 'https://issuer.invalid/jwks',
      STAFF_MCP_OAUTH_REVOCATION_ENDPOINT: 'https://issuer.invalid/revoke',
      STAFF_MCP_GLOBAL_RATE_LIMIT_PER_MINUTE: '120',
      STAFF_MCP_TOOL_RATE_LIMIT_PER_MINUTE: '30',
      STAFF_MCP_TOKEN_STATUS_TIMEOUT_MS: '3000',
    },
    services: [{
      binding: 'STAFF_MCP_TOKEN_STATUS_SERVICE',
      service: 'anonymous-token-status-service',
    }],
    workers_dev: false,
    preview_urls: false,
    routes: [{ pattern: 'staff-mcp.invalid', custom_domain: true }],
  };
}

function anonymousEvidence(config) {
  return {
    schema_version: 1,
    environment: 'production',
    resource: config.vars.STAFF_MCP_RESOURCE,
    documentation_url: config.vars.STAFF_MCP_RESOURCE_DOCUMENTATION_URL,
    privacy_policy_url: config.vars.STAFF_MCP_RESOURCE_POLICY_URL,
    client_registration: {
      mode: 'pre_registered',
      client_id: 'anonymous-public-client-id',
      redirect_uris: ['https://client.invalid/oauth/callback'],
      pkce_method: 'S256',
    },
    enabled_tools: [...staffMcpProductionAvailableTools],
  };
}
