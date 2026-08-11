import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');

const BASELINE_MIGRATION_COUNT = 65;
const BASELINE_MIGRATION_TAIL =
  '0065_retire_feishu_artifacts.sql';
const FOUNDATION_MIGRATION_SHA256 =
  '7769d12450a73d5e19953e23bf04db4fedf5bb265497ffc7b1751e43776e0a46';

export function verifyRakutenTikTokAdapterPreparation(overrides = {}) {
  const errors = [];
  const read = (relative) => overrides.sources?.[relative] ?? source(relative);
  const migration = read('migrations/0042_rakuten_tiktok_jp_marketplace_foundation.sql');
  const scheduledContract = read('packages/contracts/src/scheduled-operations.ts');
  const providerContract = read('packages/contracts/src/marketplace-provider.ts');
  const tiktok = read('apps/api/src/marketplace-adapters/tiktok-read-adapter.ts');
  const tiktokSignature = read('apps/api/src/marketplace-adapters/tiktok-signature.ts');
  const rakuten = read('apps/api/src/marketplace-adapters/unavailable-adapter.ts');
  const proposal = read('openspec/changes/rakuten-tiktok-jp-real-adapter-preparation/proposal.md');
  const migrationFiles = overrides.migrationFiles ?? readdirSync(
    path.join(root, 'migrations'),
  ).filter((name) => name.endsWith('.sql')).sort();
  const runtimeApiFiles = recursiveFiles('apps/api/src').filter(
    (relative) => relative.endsWith('.ts')
      && !relative.endsWith('.test.ts')
      && !relative.startsWith('apps/api/src/marketplace-adapters/'),
  );

  requireMatch(
    migration,
    /\(\s*'RAKUTEN_JP',\s*'RAKUTEN',\s*'JP',\s*'JPY',\s*'ACTIVE',\s*'UNAVAILABLE',\s*'乐天日本站'/u,
    'registry.rakuten_unavailable',
    errors,
  );
  requireMatch(
    migration,
    /\(\s*'TIKTOK_JP',\s*'TIKTOK',\s*'JP',\s*'JPY',\s*'ACTIVE',\s*'UNAVAILABLE',\s*'TikTok 日本站'/u,
    'registry.tiktok_unavailable',
    errors,
  );
  if (digestSources([migrationPath()], read) !== FOUNDATION_MIGRATION_SHA256) {
    errors.push('migration.no_schema_change_violated');
  }
  for (const relative of runtimeApiFiles) {
    forbidMatch(
      read(relative),
      /marketplace-adapters/u,
      'runtime.production_adapter_imported',
      errors,
    );
    forbidMatch(
      read(relative),
      /\.\s*(?:get|post|put|patch|delete|use|route)\s*\(\s*['"`][^'"`\r\n]*(?:tiktok|rakuten)/iu,
      'runtime.provider_route_registered',
      errors,
    );
  }
  forbidMatch(scheduledContract, /RAKUTEN|TIKTOK/u, 'scheduler.marketplace_job_registered', errors);
  requireMatch(providerContract, /listOrdersPage/u, 'contract.order_read_missing', errors);
  requireMatch(providerContract, /listProductsPage/u, 'contract.product_read_missing', errors);
  forbidMatch(providerContract, /\b(?:create|update|delete|upsert|mutate)(?:Order|Product)/u, 'contract.platform_write_method', errors);
  requireMatch(tiktokSignature, /https:\/\/open-api\.tiktokglobalshop\.com/u, 'tiktok.official_origin_missing', errors);
  requireMatch(tiktok, /\/order\/202309\/orders\/search/u, 'tiktok.order_version_missing', errors);
  requireMatch(tiktok, /\/product\/202502\/products\/search/u, 'tiktok.product_version_missing', errors);
  forbidMatch(tiktok, /seller\.product\.write/u, 'tiktok.write_scope_present', errors);
  forbidMatch(rakuten, /\bfetch\s*\(/u, 'rakuten.network_call_present', errors);
  requireMatch(rakuten, /UNAVAILABLE/u, 'rakuten.unavailable_missing', errors);
  requireMatch(proposal, /`NO_SCHEMA_CHANGE`/u, 'openspec.no_schema_change_missing', errors);
  requireMatch(proposal, /不增加 Worker route/u, 'openspec.route_boundary_missing', errors);

  for (const template of [
    'apps/api/wrangler.staging.template.jsonc',
    'apps/api/wrangler.production.template.jsonc',
  ]) {
    forbidMatch(
      read(template),
      /TIKTOK_SHOP|RAKUTEN_RMS/u,
      `template.${path.basename(template)}:provider_binding_present`,
      errors,
    );
  }
  return Object.freeze([...new Set(errors)].sort());
}

function recursiveFiles(relativeDirectory) {
  return readdirSync(path.join(root, relativeDirectory), {
    withFileTypes: true,
  }).flatMap((entry) => {
    const relative = path.posix.join(relativeDirectory, entry.name);
    return entry.isDirectory() ? recursiveFiles(relative) : [relative];
  }).sort();
}

function digestSources(relativeFiles, read) {
  const hash = createHash('sha256');
  for (const relative of relativeFiles) {
    hash.update(relative);
    hash.update('\0');
    hash.update(read(relative));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function migrationPath() {
  return 'migrations/0042_rakuten_tiktok_jp_marketplace_foundation.sql';
}

function source(relative) {
  return readFileSync(path.join(root, relative), 'utf8');
}

function requireMatch(value, pattern, code, errors) {
  if (!pattern.test(value)) errors.push(code);
}

function forbidMatch(value, pattern, code, errors) {
  if (pattern.test(value)) errors.push(code);
}

function main() {
  const errors = verifyRakutenTikTokAdapterPreparation();
  process.stdout.write(`${JSON.stringify({
    status: errors.length === 0 ? 'PASS' : 'FAIL',
    migration_decision: 'NO_SCHEMA_CHANGE',
    registry_adapters: 'UNAVAILABLE',
    production_routes_registered: 0,
    scheduled_jobs_registered: 0,
    platform_write_methods: 0,
    migration_count: BASELINE_MIGRATION_COUNT,
    migration_tail: BASELINE_MIGRATION_TAIL,
    external_calls: 0,
    provider_calls: 0,
    resource_mutations: 0,
    secret_reads: 0,
    secret_writes: 0,
    deployments: 0,
    errors,
  })}\n`);
  if (errors.length > 0) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
