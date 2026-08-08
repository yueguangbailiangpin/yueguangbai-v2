import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  inspectReleaseTemplate,
  readLocalReleaseConfig,
  templatePath,
} from './preflight-cloudflare-release.mjs';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const assert = (value, message) => {
  if (!value) throw new Error(message);
};

const migrations = readdirSync(path.join(root, 'migrations'))
  .filter((file) => /^\d{4}_.+\.sql$/u.test(file))
  .sort();
assert(migrations.length === 37, `expected 37 migrations, found ${migrations.length}`);
assert(migrations.at(-1) === '0037_product_reservation_order_scheduling.sql',
  'NO_SCHEMA_CHANGE violated: migration tail is not 0037');
assert(!migrations.some((file) => file.startsWith('0038_')),
  'NO_SCHEMA_CHANGE violated: migration 0038 exists');

for (const environment of ['staging', 'production']) {
  const report = inspectReleaseTemplate(environment);
  assert(report.status === 'BLOCKED_NEEDS_OPERATOR_INPUT',
    `${environment} template must remain blocked for explicit operator input`);
  assert(report.external_calls === 0 && report.deployments === 0
    && report.resource_mutations === 0,
  `${environment} preflight must remain local-only`);
  for (const field of [
    'account_id',
    'routes.0.pattern',
    'triggers.crons.0',
    'vars.APP_ORIGIN',
    'd1_databases.0.database_id',
    'r2_buckets.0.bucket_name',
  ]) assert(report.required_fields.includes(field),
    `${environment} template missing operator field: ${field}`);

  const config = readLocalReleaseConfig(templatePath(environment));
  assert(config.vars.APP_ENVIRONMENT === environment,
    `${environment} template environment mismatch`);
  assert(config.d1_databases?.[0]?.binding === 'DB',
    `${environment} template D1 binding mismatch`);
  assert(config.r2_buckets?.[0]?.binding === 'FILE_OBJECT_STORAGE_R2',
    `${environment} template R2 binding mismatch`);
  assert(config.assets?.binding === 'WEB_ASSETS'
    && config.assets?.not_found_handling === 'single-page-application'
    && config.assets?.run_worker_first === true,
  `${environment} template SPA asset contract mismatch`);
  for (const flag of [
    'SCHEDULED_OPERATIONS_ENABLED',
    'ACQUISITION_MAINTENANCE_ENABLED',
    'DRIVE_ARCHIVE_ENABLED',
    'DRIVE_ARCHIVE_COPY_ENABLED',
    'DRIVE_ARCHIVE_PROXY_READ_ENABLED',
    'DRIVE_ARCHIVE_R2_DELETE_ENABLED',
    'FEISHU_WORKBENCH_SYNC_ENABLED',
    'FEISHU_WORKBENCH_CALLBACK_ENABLED',
    'STAFF_AUTH_ENABLED',
    'STAFF_MCP_ENABLED',
    'STAFF_MCP_LOCAL_MOCK_ENABLED',
  ]) assert(config.vars?.[flag] === 'false',
    `${environment} template kill switch not frozen: ${flag}`);
  assert(Object.keys(config.vars ?? {}).every(
    (key) => !/SECRET|PASSWORD|REFRESH_TOKEN|CLIENT_SECRET/iu.test(key),
  ), `${environment} template contains a managed Secret key in vars`);
}

for (const file of [
  'apps/api/src/files/r2-object-storage.ts',
  'apps/api/src/cloudflare-runtime.ts',
  'apps/api/src/cloudflare-runtime.test.ts',
  'apps/api/src/files/r2-object-storage.test.ts',
  'scripts/preflight-cloudflare-release.mjs',
  'scripts/preflight-cloudflare-release.test.mjs',
  'scripts/verify-web-static-build.mjs',
  'docs/contracts/PRODUCTION_CLOUDFLARE_WEB_R2_RELEASE.md',
  'docs/runbooks/PRODUCTION_CLOUDFLARE_WEB_R2_RELEASE.md',
  'openspec/changes/archive/2026-08-09-production-cloudflare-web-r2-release-configuration/proposal.md',
  'openspec/changes/archive/2026-08-09-production-cloudflare-web-r2-release-configuration/design.md',
  'openspec/changes/archive/2026-08-09-production-cloudflare-web-r2-release-configuration/tasks.md',
  'openspec/changes/archive/2026-08-09-production-cloudflare-web-r2-release-configuration/specs/production-cloudflare-web-r2-release-configuration/spec.md',
]) assert(existsSync(path.join(root, file)), `required local evidence missing: ${file}`);

const adapter = read('apps/api/src/files/r2-object-storage.ts');
for (const marker of [
  'implements ObjectStorageAdapter',
  'putObject(',
  'headObject(',
  'readPrefix(',
  'readObject(',
  'deleteObject(',
  "const CHECKSUM_METADATA = 'ygb-sha256'",
]) assert(adapter.includes(marker), `R2 adapter contract missing: ${marker}`);
for (const marker of [
  "new ObjectStoragePutFailure('r2_put_ambiguous', true",
  "'r2_put_receipt_invalid', true",
]) assert(adapter.includes(marker), `R2 ambiguous PUT contract missing: ${marker}`);
for (const forbidden of ['listObjects', 'publicUrl', 'signedUrl']) {
  assert(!adapter.includes(forbidden), `R2 adapter exposes forbidden authority: ${forbidden}`);
}

const runtime = read('apps/api/src/cloudflare-runtime.ts');
for (const marker of [
  'FILE_OBJECT_STORAGE_R2',
  'FILE_OBJECT_STORAGE: storage',
  'isAllowedSameOriginApiRequest',
  'Content-Security-Policy',
  'Strict-Transport-Security',
]) assert(runtime.includes(marker), `release runtime contract missing: ${marker}`);
assert(!runtime.includes('unsafe-inline'), 'release CSP must not allow unsafe-inline');

const storagePort = read('packages/contracts/src/file-storage.ts');
for (const marker of [
  'class ObjectStoragePutFailure',
  'objectMayExist',
  'objectStoragePutMayHaveStored',
]) assert(storagePort.includes(marker), `storage PUT failure port missing: ${marker}`);
const upload = read('apps/api/src/files/upload-file-object.ts');
assert(upload.includes('stored = objectStoragePutMayHaveStored(error)'),
  'upload compensation does not consume ambiguous PUT semantics');

const preflight = read('scripts/preflight-cloudflare-release.mjs');
for (const marker of [
  'path.isAbsolute(file)',
  'realpathSync.native(lexical)',
  'config_path:repository_location_forbidden',
]) assert(preflight.includes(marker), `Git-external config gate missing: ${marker}`);
const webVerifier = read('scripts/verify-web-static-build.mjs');
assert(webVerifier.includes('jsx_inline_style_forbidden'),
  'Web inline-style verifier missing');
assert(!/\bstyle\s*=/u.test(read('apps/web/src/ui/primitives.tsx')),
  'Web primitives still contain JSX inline style');
assert(!existsSync(path.join(root, 'apps/api/wrangler.staging.jsonc')),
  'rendered staging config must remain outside Git/worktree');
assert(!existsSync(path.join(root, 'apps/api/wrangler.production.jsonc')),
  'rendered production config must remain outside Git/worktree');
assert(!existsSync(path.join(root, 'wrangler.production.jsonc')),
  'root production config must remain absent');

console.log(JSON.stringify({
  status: 'PASS',
  change: 'production-cloudflare-web-r2-release-configuration',
  schema_change: 'NO_SCHEMA_CHANGE',
  migration: '0001-0037_CONTINUOUS',
  release_templates: 'BLOCKED_NEEDS_OPERATOR_INPUT',
  local_implementation: 'PRESENT',
  external_acceptance: 'UNVERIFIED',
  production_go: 'NO_GO',
}, null, 2));
