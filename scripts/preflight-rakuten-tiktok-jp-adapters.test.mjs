import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  inspectMarketplaceAdapterPreparation,
  tiktokShopManagedSecretNames,
  validateMarketplaceAdapterActivationManifest,
} from './preflight-rakuten-tiktok-jp-adapters.mjs';

describe('Rakuten/TikTok JP adapter preflight', () => {
  it('reports truthful local preparation with every external counter at zero', () => {
    expect(inspectMarketplaceAdapterPreparation()).toMatchObject({
      status: 'LOCAL_IMPLEMENTATION_READY_PRODUCTION_NO_GO',
      migration_decision: 'NO_SCHEMA_CHANGE',
      registry_status: { RAKUTEN_JP: 'UNAVAILABLE', TIKTOK_JP: 'UNAVAILABLE' },
      production_routes_registered: 0,
      scheduled_jobs_registered: 0,
      platform_write_methods: 0,
      external_calls: 0,
      provider_calls: 0,
      resource_mutations: 0,
      secret_reads: 0,
      secret_writes: 0,
      deployments: 0,
    });
  });

  it('accepts only the exact anonymous read-only structure', () => {
    expect(validateMarketplaceAdapterActivationManifest(
      anonymousManifest('production'),
      'production',
      tiktokShopManagedSecretNames,
    )).toEqual([]);
  });

  it('rejects write capability, excess scopes, IP callbacks and missing secret names', () => {
    const manifest = anonymousManifest('staging');
    manifest.tiktok.platform_writes_enabled = true;
    manifest.tiktok.granted_scopes.push('seller.product.write');
    manifest.tiktok.callback_origin = 'https://127.0.0.1/';
    manifest.rakuten.platform_writes_enabled = true;
    const errors = validateMarketplaceAdapterActivationManifest(
      manifest,
      'staging',
      [],
    );
    expect(errors).toContain('tiktok.platform_writes_enabled:must_be_false');
    expect(errors).toContain('tiktok.granted_scopes:exact_preparation_set_required');
    expect(errors).toContain('tiktok.callback_origin:invalid');
    expect(errors).toContain('rakuten.platform_writes_enabled:must_be_false');
    expect(errors).toContain('managed_secret.TIKTOK_SHOP_APP_SECRET:not_declared');
    expect(JSON.stringify(errors)).not.toContain('127.0.0.1');
  });

  it('reads only a repository-external manifest and redacts every manifest value', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'ygb-marketplace-preflight-'));
    try {
      const file = path.join(directory, 'production.json');
      const manifest = anonymousManifest('production');
      writeFileSync(file, JSON.stringify(manifest));
      const result = spawnSync(process.execPath, [
        path.resolve(import.meta.dirname, 'preflight-rakuten-tiktok-jp-adapters.mjs'),
        '--environment', 'production',
        '--manifest', file,
        ...tiktokShopManagedSecretNames.flatMap((name) => [
          '--declared-secret', name,
        ]),
      ], { encoding: 'utf8' });
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        status: 'LOCAL_STRUCTURE_VALID_PRODUCTION_NO_GO',
        errors: [],
        external_calls: 0,
        provider_calls: 0,
        resource_mutations: 0,
        secret_reads: 0,
        secret_writes: 0,
        deployments: 0,
      });
      expect(result.stdout).not.toContain(file);
      expect(result.stdout).not.toContain(manifest.tiktok.callback_origin);
      expect(result.stdout).not.toContain(manifest.rakuten.official_spec_bundle_sha256);

      const repositoryFile = path.resolve(
        import.meta.dirname,
        '../package.json',
      );
      const rejected = spawnSync(process.execPath, [
        path.resolve(import.meta.dirname, 'preflight-rakuten-tiktok-jp-adapters.mjs'),
        '--environment', 'production',
        '--manifest', repositoryFile,
      ], { encoding: 'utf8' });
      expect(rejected.status).not.toBe(0);
      expect(JSON.parse(rejected.stdout).errors)
        .toEqual(['config_path:repository_location_forbidden']);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('requires a manifest for activation while explicit inspection stays local NO-GO', () => {
    const script = path.resolve(
      import.meta.dirname,
      'preflight-rakuten-tiktok-jp-adapters.mjs',
    );
    const missing = spawnSync(process.execPath, [script], { encoding: 'utf8' });
    expect(missing.status).not.toBe(0);
    expect(JSON.parse(missing.stdout)).toMatchObject({
      status: 'BLOCKED',
      errors: ['manifest:required'],
      external_calls: 0,
      provider_calls: 0,
      secret_reads: 0,
    });
    const inspection = spawnSync(process.execPath, [script, '--inspect'], {
      encoding: 'utf8',
    });
    expect(inspection.status).toBe(0);
    expect(JSON.parse(inspection.stdout)).toMatchObject({
      status: 'LOCAL_IMPLEMENTATION_READY_PRODUCTION_NO_GO',
      registry_status: {
        RAKUTEN_JP: 'UNAVAILABLE',
        TIKTOK_JP: 'UNAVAILABLE',
      },
    });
  });
});

function anonymousManifest(environment) {
  return {
    schema_version: 1,
    environment,
    external_writes_allowed: false,
    owner_activation_approval_recorded: true,
    tiktok: {
      market: 'JP',
      seller_type: 'LOCAL',
      application_type: 'CUSTOM',
      app_registration_reviewed: true,
      development_shop_authorized: true,
      authorized_shop_mapping_reviewed: true,
      app_key_reference_recorded: true,
      granted_scopes: [
        'seller.authorization.info',
        'seller.order.info',
        'seller.product.basic',
      ],
      callback_origin: `https://${environment}.marketplace.example.invalid`,
      callback_domain_control_verified: true,
      clock_sync_evidence_recorded: true,
      order_search_version: '202309',
      product_search_version: '202502',
      platform_writes_enabled: false,
    },
    rakuten: {
      integration_mode: 'MERCHANT_INTERNAL',
      active_store_contract_verified: true,
      test_shop_allocated: true,
      official_spec_bundle_revision_recorded: true,
      official_spec_bundle_sha256: 'a'.repeat(64),
      order_read_scope_approved: true,
      product_read_scope_approved: true,
      platform_writes_enabled: false,
    },
  };
}
