import { describe, expect, it } from 'vitest';
import {
  inspectStaffAuthTemplate,
  staffAuthManagedSecrets,
  validateStaffAuthActivationConfig,
} from './preflight-staff-auth-production.mjs';

describe('Cloudflare Access Staff authentication production preflight', () => {
  for (const environment of ['staging', 'production']) {
    it(`keeps the ${environment} template local-only`, () => {
      expect(inspectStaffAuthTemplate(environment)).toMatchObject({
        status: 'LOCAL_NO_GO',
        migration_decision: 'NO_SCHEMA_CHANGE',
        required_managed_secret_names: [],
        external_calls: 0,
        provider_calls: 0,
        deployments: 0,
        resource_mutations: 0,
        errors: [],
      });
    });
  }

  it('accepts a complete Cloudflare Access shape without Staff auth Secrets', () => {
    expect(staffAuthManagedSecrets).toEqual([]);
    expect(validateStaffAuthActivationConfig(
      activationConfig(), 'production', staffAuthManagedSecrets,
    )).toEqual([]);
  });

  for (const environment of ['staging', 'production']) {
    it(`rejects ${environment} self-origin and arbitrary-host team domains`, () => {
      for (const domain of [
        `https://${environment}.example.invalid`,
        'https://arbitrary.example.com',
        'https://nested.team.cloudflareaccess.com',
      ]) {
        const config = activationConfig(environment);
        config.vars.STAFF_ACCESS_TEAM_DOMAIN = domain;
        expect(validateStaffAuthActivationConfig(config, environment))
          .toContain('vars.STAFF_ACCESS_TEAM_DOMAIN:invalid_access_team_origin');
      }
    });
  }

  it('rejects origin, team, audience, retired Feishu and Secret drift', () => {
    const config = activationConfig();
    config.vars.STAFF_AUTH_ALLOWED_ORIGINS = 'https://other.invalid';
    config.vars.STAFF_ACCESS_TEAM_DOMAIN = 'http://team.cloudflareaccess.com';
    config.vars.STAFF_ACCESS_AUD = 'short';
    config.vars.FEISHU_WORKBENCH_SYNC_ENABLED = 'true';
    config.vars.STAFF_AUTH_FEISHU_APP_ID = 'retired';
    config.vars.STAFF_AUTH_HASH_SECRET = 'must-not-appear';
    const errors = validateStaffAuthActivationConfig(
      config,
      'production',
      ['STAFF_AUTH_HASH_SECRET'],
    );
    expect(errors).toEqual(expect.arrayContaining([
      'vars.STAFF_AUTH_ALLOWED_ORIGINS:origin_mismatch',
      'vars.STAFF_ACCESS_TEAM_DOMAIN:invalid_access_team_origin',
      'vars.STAFF_ACCESS_AUD:missing_or_invalid',
      'vars.FEISHU_WORKBENCH_SYNC_ENABLED:retired_configuration_forbidden',
      'vars.STAFF_AUTH_FEISHU_APP_ID:retired_configuration_forbidden',
      'vars.STAFF_AUTH_HASH_SECRET:retired_configuration_forbidden',
      'vars.STAFF_AUTH_HASH_SECRET:managed_secret_forbidden',
      'managed_secret.STAFF_AUTH_HASH_SECRET:not_required_for_staff_access',
    ]));
    expect(JSON.stringify(errors)).not.toContain('must-not-appear');
  });
});

function activationConfig(environment = 'production') {
  const origin = `https://${environment}.example.invalid`;
  return { vars: {
    APP_ENVIRONMENT: environment,
    APP_ORIGIN: origin,
    STAFF_AUTH_ALLOWED_ORIGINS: origin,
    STAFF_ACCESS_TEAM_DOMAIN: 'https://moonwhite.cloudflareaccess.com',
    STAFF_ACCESS_AUD: 'anonymous-production-access-audience',
  } };
}
