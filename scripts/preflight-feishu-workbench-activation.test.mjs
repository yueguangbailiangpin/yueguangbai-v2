import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  feishuWorkbenchManagedSecretNames,
  inspectFeishuWorkbenchActivationTemplate,
  validateFeishuWorkbenchActivationConfig,
} from './preflight-feishu-workbench-activation.mjs';
import { readLocalReleaseConfig, templatePath } from './preflight-cloudflare-release.mjs';

describe('Feishu workbench activation preflight', () => {
  for (const environment of ['staging', 'production']) {
    it(`keeps the ${environment} template disabled and reports a truthful local NO-GO`, () => {
      const report = inspectFeishuWorkbenchActivationTemplate(environment);
      expect(report).toMatchObject({
        status: 'LOCAL_NO_GO', migration_decision: 'NO_SCHEMA_CHANGE',
        external_calls: 0, provider_calls: 0, resource_mutations: 0, errors: [],
      });
      expect(report.required_managed_secret_names).toEqual(feishuWorkbenchManagedSecretNames);
      expect(report.blockers).toContain('real_provider_send_receive_not_checked_locally');
      expect(report.rollback_order).toContain('keep_ACQUISITION_MAINTENANCE_ENABLED_false');
    });
  }

  it('accepts anonymous activation structure by secret name without requiring Staff Auth', () => {
    const config = anonymousActivationConfig('production');
    expect(config.vars.STAFF_AUTH_ENABLED).toBe('false');
    expect(config.vars.ACQUISITION_MAINTENANCE_ENABLED).toBe('false');
    expect(validateFeishuWorkbenchActivationConfig(
      config, 'production', feishuWorkbenchManagedSecretNames,
    )).toEqual([]);
  });

  it('rejects missing secret declarations, unsafe origins, disabled scheduling and embedded values', () => {
    const config = anonymousActivationConfig('staging');
    config.vars.SCHEDULED_OPERATIONS_ENABLED = 'false';
    config.vars.ACQUISITION_MAINTENANCE_ENABLED = 'true';
    config.vars.FEISHU_WORKBENCH_API_ORIGIN = 'https://example.invalid';
    config.vars.FEISHU_WORKBENCH_APP_SECRET = 'must-not-be-in-vars';
    const errors = validateFeishuWorkbenchActivationConfig(config, 'staging', []);
    expect(errors).toContain('scheduled_operations:must_be_enabled');
    expect(errors).toContain('acquisition_maintenance:must_be_disabled');
    expect(errors).toContain('api_origin:official_origin_required');
    expect(errors).toContain('managed_secret.FEISHU_WORKBENCH_APP_SECRET:not_declared');
    expect(errors).toContain('vars.FEISHU_WORKBENCH_APP_SECRET:managed_secret_forbidden');
    expect(JSON.stringify(errors)).not.toContain('must-not-be-in-vars');
  });

  it('rejects a missing acquisition-maintenance isolation switch', () => {
    const config = anonymousActivationConfig('production');
    delete config.vars.ACQUISITION_MAINTENANCE_ENABLED;
    expect(validateFeishuWorkbenchActivationConfig(
      config, 'production', feishuWorkbenchManagedSecretNames,
    )).toContain('acquisition_maintenance:must_be_disabled');
  });

  it('validates only an external config path and redacts all values at the CLI boundary', () => {
    const directory=mkdtempSync(path.join(tmpdir(),'ygb-feishu-preflight-'));
    try{
      const file=path.join(directory,'production.jsonc');
      writeFileSync(file,JSON.stringify(anonymousActivationConfig('production')));
      const result=spawnSync(process.execPath,[
        path.resolve(import.meta.dirname,'preflight-feishu-workbench-activation.mjs'),
        '--environment','production','--config',file,
        ...feishuWorkbenchManagedSecretNames.flatMap((name)=>['--declared-secret',name]),
      ],{encoding:'utf8'});
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({status:'LOCAL_STRUCTURE_VALID_PRODUCTION_NO_GO',errors:[],external_calls:0,provider_calls:0,resource_mutations:0});
      expect(result.stdout).not.toContain(file);
      expect(result.stdout).not.toContain('anonymous-production-workbench-app');
      const repositoryPath=spawnSync(process.execPath,[
        path.resolve(import.meta.dirname,'preflight-feishu-workbench-activation.mjs'),
        '--environment','production','--config',templatePath('production'),
      ],{encoding:'utf8'});
      expect(repositoryPath.status).not.toBe(0);
      expect(JSON.parse(repositoryPath.stdout).errors).toEqual(['config_path:repository_location_forbidden']);
    }finally{rmSync(directory,{recursive:true,force:true});}
  });
});

function anonymousActivationConfig(environment) {
  const config = structuredClone(readLocalReleaseConfig(templatePath(environment)));
  const origin = `https://${environment}.example.invalid`;
  config.vars.APP_ORIGIN = origin;
  config.vars.FEISHU_WORKBENCH_WEB_ORIGIN = origin;
  config.vars.FEISHU_WORKBENCH_APP_ID = `anonymous-${environment}-workbench-app`;
  config.vars.FEISHU_WORKBENCH_TENANT_KEY = `anonymous-${environment}-workbench-tenant`;
  config.vars.SCHEDULED_OPERATIONS_ENABLED = 'true';
  config.vars.SCHEDULED_OPERATIONS_DISABLED_JOBS = 'reservation_expiry,instruction_expiry,outbox_delivery,file_orphan_cleanup,staff_auth_cleanup,drive_archive';
  config.vars.FEISHU_WORKBENCH_SYNC_ENABLED = 'true';
  config.vars.FEISHU_WORKBENCH_CALLBACK_ENABLED = 'true';
  return config;
}
