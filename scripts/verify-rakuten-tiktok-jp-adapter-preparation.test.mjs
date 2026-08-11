import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { verifyRakutenTikTokAdapterPreparation } from './verify-rakuten-tiktok-jp-adapter-preparation.mjs';

const root = path.resolve(import.meta.dirname, '..');
const migrationPath =
  'migrations/0042_rakuten_tiktok_jp_marketplace_foundation.sql';

describe('Rakuten/TikTok adapter static verifier', () => {
  it('passes the unchanged baseline', () => {
    expect(verifyRakutenTikTokAdapterPreparation()).toEqual([]);
  });

  it('detects either registry row becoming available', () => {
    const migration = read(migrationPath);
    for (const marketplace of ['RAKUTEN_JP', 'TIKTOK_JP']) {
      const rowPrefix = marketplace === 'RAKUTEN_JP'
        ? "'RAKUTEN_JP', 'RAKUTEN', 'JP', 'JPY', 'ACTIVE', "
        : "'TIKTOK_JP', 'TIKTOK', 'JP', 'JPY', 'ACTIVE', ";
      const mutated = migration.replace(
        `${rowPrefix}'UNAVAILABLE'`,
        `${rowPrefix}'AVAILABLE'`,
      );
      expect(mutated).not.toBe(migration);
      expect(verifyRakutenTikTokAdapterPreparation({
        sources: { [migrationPath]: mutated },
      })).toContain(`registry.${marketplace === 'RAKUTEN_JP'
        ? 'rakuten' : 'tiktok'}_unavailable`);
    }
  });

  it('allows later unrelated migrations without weakening the frozen 0042 bytes', () => {
    const migrationFiles = readdirSync(path.join(root, 'migrations'))
      .filter((name) => name.endsWith('.sql'))
      .sort();
    expect(verifyRakutenTikTokAdapterPreparation({
      migrationFiles: [...migrationFiles, '0044_forbidden_adapter_state.sql'],
    })).toEqual([]);
  });

  it('detects schema edits appended to an existing baseline migration', () => {
    const migration = read(migrationPath);
    expect(verifyRakutenTikTokAdapterPreparation({
      sources: {
        [migrationPath]: `${migration}\nALTER TABLE marketplace_registry ADD COLUMN forbidden TEXT;\n`,
      },
    })).toContain('migration.no_schema_change_violated');
  });

  it('detects a production adapter import or Rakuten network call', () => {
    const appPath = 'apps/api/src/app.ts';
    const rakutenPath =
      'apps/api/src/marketplace-adapters/unavailable-adapter.ts';
    expect(verifyRakutenTikTokAdapterPreparation({
      sources: {
        [appPath]: `${read(appPath)}\nimport './marketplace-adapters';\n`,
        [rakutenPath]: `${read(rakutenPath)}\nfetch('https://example.invalid');\n`,
      },
    })).toEqual(expect.arrayContaining([
      'runtime.production_adapter_imported',
      'rakuten.network_call_present',
    ]));
  });

  it('detects a production API route even without an adapter import string', () => {
    const appPath = 'apps/api/src/app.ts';
    const app = read(appPath);
    const mutated = app.replace(
      "  app.notFound((context) => context.json(apiFailure('NOT_FOUND','请求的资源不存在',context.get('requestId')),404));",
      "  app.get('/api/tiktok-shop/orders', (context) => context.json({ ok: true }));\n  app.notFound((context) => context.json(apiFailure('NOT_FOUND','请求的资源不存在',context.get('requestId')),404));",
    );
    expect(mutated).not.toBe(app);
    expect(verifyRakutenTikTokAdapterPreparation({
      sources: {
        [appPath]: mutated,
      },
    })).toEqual(expect.arrayContaining([
      'runtime.provider_route_registered',
    ]));
  });

  it('allows unrelated composition-root and template changes', () => {
    const appPath = 'apps/api/src/app.ts';
    const productionTemplate = 'apps/api/wrangler.production.template.jsonc';
    const stagingTemplate = 'apps/api/wrangler.staging.template.jsonc';
    expect(verifyRakutenTikTokAdapterPreparation({
      sources: {
        [appPath]: `${read(appPath)}\n// unrelated approved integration change\n`,
        [productionTemplate]: `${read(productionTemplate)}\n// unrelated approved integration change\n`,
        [stagingTemplate]: `${read(stagingTemplate)}\n// unrelated approved integration change\n`,
      },
    })).toEqual([]);
  });

  it('detects provider bindings without byte-locking templates', () => {
    for (const template of [
      'apps/api/wrangler.production.template.jsonc',
      'apps/api/wrangler.staging.template.jsonc',
    ]) {
      expect(verifyRakutenTikTokAdapterPreparation({
        sources: {
          [template]: `${read(template)}\n// TIKTOK_SHOP_APP_SECRET\n`,
        },
      })).toContain(`template.${path.basename(template)}:provider_binding_present`);
    }
  });
});

function read(relative) {
  return readFileSync(path.join(root, relative), 'utf8');
}
