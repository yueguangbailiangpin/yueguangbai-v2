import { describe, expect, it } from 'vitest';
import {
  feishuProductionAppManagedSecrets,
  feishuProductionAppScopes,
  inspectFeishuProductionAppTemplate,
  validateFeishuProductionAppConfig,
} from './preflight-feishu-production-app.mjs';

describe('Feishu formal production app preflight', () => {
  for (const environment of ['staging', 'production']) {
    it(`keeps the ${environment} template default-off and non-authorizing`, () => {
      const report = inspectFeishuProductionAppTemplate(environment);
      expect(report).toMatchObject({
        status: 'LOCAL_NO_GO',
        migration_decision: 'NO_SCHEMA_CHANGE',
        external_calls: 0,
        provider_calls: 0,
        resource_mutations: 0,
      });
      expect(report.required_scopes).toEqual([
        'contact:user.base:readonly',
        'task:task:write',
        'im:message:send_as_bot',
      ]);
      expect(JSON.stringify(report)).not.toMatch(/oc_|cli_|tenant_access_token/u);
    });
  }

  it('accepts one anonymous App and Tenant with declared Secret names only', () => {
    expect(validateFeishuProductionAppConfig(
      config('production'),
      'production',
      feishuProductionAppManagedSecrets,
    )).toEqual([]);
    expect(feishuProductionAppScopes).not.toContain('im:message');
    expect(feishuProductionAppScopes).not.toContain('im:message.group_msg');
  });

  it('rejects split apps, unsafe scheduling, and embedded recipient values', () => {
    const value = config('production');
    value.vars.FEISHU_WORKBENCH_APP_ID = 'different-formal-app';
    value.vars.SCHEDULED_OPERATIONS_DISABLED_JOBS = 'drive_archive';
    value.vars.FEISHU_OPERATIONAL_ALERT_CHAT_ID = 'oc_must_never_appear';
    const errors = validateFeishuProductionAppConfig(
      value,
      'production',
      feishuProductionAppManagedSecrets.filter(
        (name) => name !== 'FEISHU_OPERATIONAL_ALERT_CHAT_ID',
      ),
    );
    expect(errors).toContain('vars.FEISHU_APP_ID:not_same_formal_app');
    expect(errors).toContain('vars.SCHEDULED_OPERATIONS_DISABLED_JOBS:feishu_only_set_required');
    expect(errors).toContain('vars.FEISHU_OPERATIONAL_ALERT_CHAT_ID:managed_secret_forbidden');
    expect(errors).toContain('managed_secret.FEISHU_OPERATIONAL_ALERT_CHAT_ID:not_declared');
    expect(JSON.stringify(errors)).not.toContain('oc_must_never_appear');
  });

  it('requires exact callbacks, least privilege and unrelated capability isolation', () => {
    const value = config('staging');
    value.vars.STAFF_AUTH_FEISHU_SCOPE = 'contact:contact:readonly_as_app';
    value.vars.STAFF_AUTH_FEISHU_REDIRECT_URI = 'https://other.invalid/callback';
    value.vars.STAFF_MCP_ENABLED = 'true';
    const errors = validateFeishuProductionAppConfig(
      value,
      'staging',
      feishuProductionAppManagedSecrets,
    );
    expect(errors).toContain('vars.STAFF_AUTH_FEISHU_SCOPE:invalid');
    expect(errors).toContain('vars.STAFF_AUTH_FEISHU_REDIRECT_URI:origin_mismatch');
    expect(errors).toContain('vars.STAFF_MCP_ENABLED:invalid');
  });
});

function config(environment) {
  const origin = `https://${environment}.example.invalid`;
  const appId = `anonymous-${environment}-formal-app`;
  const tenant = `anonymous-${environment}-tenant`;
  return {
    vars: {
      APP_ENVIRONMENT: environment,
      APP_ORIGIN: origin,
      APP_ALLOWED_ORIGINS: origin,
      STAFF_AUTH_ENABLED: 'true',
      STAFF_AUTH_PROVIDER: 'FEISHU',
      STAFF_AUTH_FEISHU_AUTHORIZATION_ENDPOINT:
        'https://accounts.feishu.cn/open-apis/authen/v1/authorize',
      STAFF_AUTH_FEISHU_TOKEN_ENDPOINT:
        'https://open.feishu.cn/open-apis/authen/v2/oauth/token',
      STAFF_AUTH_FEISHU_IDENTITY_ENDPOINT:
        'https://open.feishu.cn/open-apis/authen/v1/user_info',
      STAFF_AUTH_FEISHU_APP_ID: appId,
      STAFF_AUTH_FEISHU_SCOPE: 'contact:user.base:readonly',
      STAFF_AUTH_FEISHU_TENANT_KEY: tenant,
      STAFF_AUTH_FEISHU_REDIRECT_URI:
        `${origin}/api/staff-auth/feishu/callback`,
      STAFF_AUTH_ALLOWED_ORIGINS: origin,
      STAFF_AUTH_ALLOWED_RETURN_TO: '/staff',
      SCHEDULED_OPERATIONS_ENABLED: 'true',
      SCHEDULED_OPERATIONS_DISABLED_JOBS:
        'reservation_expiry,instruction_expiry,outbox_delivery,file_orphan_cleanup,staff_auth_cleanup,drive_archive',
      ACQUISITION_MAINTENANCE_ENABLED: 'false',
      OPERATIONAL_ALERT_MODE: 'disabled',
      FEISHU_WORKBENCH_SYNC_ENABLED: 'true',
      FEISHU_WORKBENCH_CALLBACK_ENABLED: 'true',
      FEISHU_WORKBENCH_WEB_ORIGIN: origin,
      FEISHU_WORKBENCH_API_ORIGIN: 'https://open.feishu.cn',
      FEISHU_WORKBENCH_APP_ID: appId,
      FEISHU_WORKBENCH_TENANT_KEY: tenant,
      FEISHU_WORKBENCH_REQUEST_TIMEOUT_MS: '3000',
      FEISHU_WORKBENCH_MAX_ATTEMPTS: '3',
      FEISHU_WORKBENCH_RATE_LIMIT_PER_SECOND: '10',
      FEISHU_OPERATIONAL_ALERT_ENABLED: 'true',
      FEISHU_OPERATIONAL_ALERT_RATE_LIMIT_PER_SECOND: '1',
      DRIVE_ARCHIVE_ENABLED: 'false',
      DRIVE_ARCHIVE_COPY_ENABLED: 'false',
      DRIVE_ARCHIVE_PROXY_READ_ENABLED: 'false',
      DRIVE_ARCHIVE_R2_DELETE_ENABLED: 'false',
      STAFF_MCP_ENABLED: 'false',
      STAFF_MCP_PRODUCTION_TRANSPORT_ENABLED: 'false',
      STAFF_MCP_LOCAL_MOCK_ENABLED: 'false',
      STAFF_MCP_CLEANUP_ENABLED: 'false',
    },
  };
}
