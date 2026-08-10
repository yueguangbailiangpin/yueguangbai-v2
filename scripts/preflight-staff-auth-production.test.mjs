import { describe, expect, it } from 'vitest';
import {
  inspectStaffAuthTemplate,
  staffAuthManagedSecrets,
  validateStaffAuthActivationConfig,
} from './preflight-staff-auth-production.mjs';

describe('Staff Auth Feishu production activation preflight', () => {
  for (const environment of ['staging', 'production']) {
    it(`keeps the ${environment} template disabled and local-only`, () => {
      expect(inspectStaffAuthTemplate(environment)).toMatchObject({
        status: 'LOCAL_NO_GO',
        migration_decision: 'NO_SCHEMA_CHANGE',
        external_calls: 0,
        provider_calls: 0,
        deployments: 0,
        resource_mutations: 0,
        errors: [],
      });
    });
  }

  it('accepts a complete anonymous activation shape by managed-secret name', () => {
    expect(validateStaffAuthActivationConfig(
      activationConfig(), 'production', staffAuthManagedSecrets,
    )).toEqual([]);
  });

  it('rejects provider, origin, scope, kill-switch and Secret drift', () => {
    const config = activationConfig();
    config.vars.STAFF_AUTH_PROVIDER = 'OTHER';
    config.vars.STAFF_AUTH_FEISHU_SCOPE = 'contact:user:readonly';
    config.vars.STAFF_AUTH_ALLOWED_ORIGINS = 'https://other.invalid';
    config.vars.FEISHU_WORKBENCH_SYNC_ENABLED = 'true';
    config.vars.FEISHU_OPERATIONAL_ALERT_ENABLED = 'true';
    config.vars.STAFF_AUTH_HASH_SECRET = 'must-not-appear';
    const errors = validateStaffAuthActivationConfig(config, 'production', []);
    expect(errors).toEqual(expect.arrayContaining([
      'vars.STAFF_AUTH_PROVIDER:must_be_FEISHU',
      'vars.STAFF_AUTH_FEISHU_SCOPE:invalid',
      'vars.STAFF_AUTH_ALLOWED_ORIGINS:origin_mismatch',
      'vars.FEISHU_WORKBENCH_SYNC_ENABLED:must_remain_false',
      'vars.FEISHU_OPERATIONAL_ALERT_ENABLED:must_remain_false',
      'managed_secret.STAFF_AUTH_HASH_SECRET:not_declared',
      'vars.STAFF_AUTH_HASH_SECRET:managed_secret_forbidden',
    ]));
    expect(JSON.stringify(errors)).not.toContain('must-not-appear');
  });
});

function activationConfig() {
  const origin = 'https://production.example.invalid';
  return { vars: {
    APP_ENVIRONMENT: 'production',
    APP_ORIGIN: origin,
    STAFF_AUTH_ENABLED: 'true',
    STAFF_AUTH_PROVIDER: 'FEISHU',
    STAFF_AUTH_FEISHU_AUTHORIZATION_ENDPOINT:
      'https://accounts.feishu.cn/open-apis/authen/v1/authorize',
    STAFF_AUTH_FEISHU_TOKEN_ENDPOINT:
      'https://open.feishu.cn/open-apis/authen/v2/oauth/token',
    STAFF_AUTH_FEISHU_IDENTITY_ENDPOINT:
      'https://open.feishu.cn/open-apis/authen/v1/user_info',
    STAFF_AUTH_FEISHU_APP_ID: 'cli_anonymous_release',
    STAFF_AUTH_FEISHU_SCOPE: 'contact:user.base:readonly',
    STAFF_AUTH_FEISHU_TENANT_KEY: 'anonymous-tenant',
    STAFF_AUTH_FEISHU_REDIRECT_URI:
      `${origin}/api/staff-auth/feishu/callback`,
    STAFF_AUTH_ALLOWED_ORIGINS: origin,
    STAFF_AUTH_ALLOWED_RETURN_TO: '/staff',
    SCHEDULED_OPERATIONS_ENABLED: 'false',
    ACQUISITION_MAINTENANCE_ENABLED: 'false',
    DRIVE_ARCHIVE_ENABLED: 'false',
    DRIVE_ARCHIVE_COPY_ENABLED: 'false',
    DRIVE_ARCHIVE_PROXY_READ_ENABLED: 'false',
    DRIVE_ARCHIVE_R2_DELETE_ENABLED: 'false',
    FEISHU_WORKBENCH_SYNC_ENABLED: 'false',
    FEISHU_WORKBENCH_CALLBACK_ENABLED: 'false',
    FEISHU_OPERATIONAL_ALERT_ENABLED: 'false',
    STAFF_MCP_ENABLED: 'false',
    STAFF_MCP_PRODUCTION_TRANSPORT_ENABLED: 'false',
    STAFF_MCP_LOCAL_MOCK_ENABLED: 'false',
    STAFF_MCP_CLEANUP_ENABLED: 'false',
  } };
}
