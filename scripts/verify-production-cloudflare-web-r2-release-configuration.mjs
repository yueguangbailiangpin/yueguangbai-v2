import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  inspectReleaseTemplate,
  readLocalReleaseConfig,
  templatePath,
} from './preflight-cloudflare-release.mjs';
import {
  invariant as assert,
  readRepositoryFile,
  repositoryRoot as root,
  resolveChangeFile,
} from './verifier-utils.mjs';

const read = (file) => readRepositoryFile(file, root);

const migrations = readdirSync(path.join(root, 'migrations'))
  .filter((file) => /^\d{4}_.+\.sql$/u.test(file))
  .sort();
assert(migrations.length === 29, `expected 29 migrations, found ${migrations.length}`);
assert(migrations[0] === '0001_foundation.sql'
  && migrations[18] === '0019_read_model_views.sql'
  && migrations[23] === '0024_cold_archive_bundle_model.sql'
  && migrations[24] === '0025_historical_order_import.sql'
  && migrations[25] === '0026_stage65_archive_import_closeout.sql'
  && migrations[26] === '0027_stage66_single_source_convergence.sql'
  && migrations[27] === '0028_stage66b_fixed_assignment_and_files.sql'
  && migrations[28] === '0029_stage66c_retire_acquisition_outbox.sql',
  'current continuous migration ownership drift');

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
    'vars.APP_ORIGIN',
    'vars.STAFF_ACCESS_TEAM_DOMAIN',
    'vars.STAFF_ACCESS_AUD',
    'd1_databases.0.database_id',
    'r2_buckets.0.bucket_name',
  ]) assert(report.required_fields.includes(field),
    `${environment} template missing operator field: ${field}`);
  if (environment === 'production') {
    assert(report.required_fields.includes('triggers.crons.0'),
      'production template must require an explicit Cron');
  } else {
    assert(!report.required_fields.includes('triggers.crons.0'),
      'staging template must not require a production Cron');
  }

  const config = readLocalReleaseConfig(templatePath(environment));
  assert(config.vars.APP_ENVIRONMENT === environment,
    `${environment} template environment mismatch`);
  assert(Array.isArray(config.compatibility_flags)
    && config.compatibility_flags.length === 1
    && config.compatibility_flags[0] === 'global_fetch_strictly_public',
  `${environment} template Access JWKS public fetch routing drift`);
  assert(config.d1_databases?.[0]?.binding === 'DB',
    `${environment} template D1 binding mismatch`);
  assert(config.r2_buckets?.[0]?.binding === 'FILE_OBJECT_STORAGE_R2',
    `${environment} template R2 binding mismatch`);
  assert(config.assets?.binding === 'WEB_ASSETS'
    && config.assets?.not_found_handling === 'single-page-application'
    && config.assets?.run_worker_first === true,
  `${environment} template SPA asset contract mismatch`);
  const expectedScheduled = environment === 'production' ? 'true' : 'false';
  for (const flag of ['SCHEDULED_OPERATIONS_ENABLED']) {
    assert(config.vars?.[flag] === expectedScheduled,
      `${environment} template scheduled default drift: ${flag}`);
  }
  for (const flag of [
    'DRIVE_ARCHIVE_ENABLED',
    'DRIVE_ARCHIVE_COPY_ENABLED',
    'DRIVE_ARCHIVE_PROXY_READ_ENABLED',
    'DRIVE_ARCHIVE_R2_DELETE_ENABLED',
  ]) assert(config.vars?.[flag] === 'false',
    `${environment} template kill switch not frozen: ${flag}`);
  assert(Object.keys(config.vars ?? {}).every(
    (key) => !/SECRET|PASSWORD|REFRESH_TOKEN|CLIENT_SECRET/iu.test(key),
  ), `${environment} template contains a managed Secret key in vars`);
  assert(Object.keys(config.vars ?? {}).every(
    (key) => !/^(?:FEISHU_|STAFF_AUTH_FEISHU)|^(?:STAFF_AUTH_PROVIDER|STAFF_AUTH_ENABLED|STAFF_AUTH_HASH_SECRET)$/u.test(key),
  ), `${environment} template contains retired Feishu Staff configuration`);
  assert(Object.keys(config.vars ?? {}).every((key) => !key.startsWith('STAFF_MCP_')),
    `${environment} core template contains optional Staff MCP configuration`);
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
]) assert(existsSync(path.join(root, file)), `required local evidence missing: ${file}`);
for (const file of [
  'proposal.md',
  'design.md',
  'tasks.md',
  'specs/production-cloudflare-web-r2-release-configuration/spec.md',
]) resolveChangeFile('production-cloudflare-web-r2-release-configuration', file, root);

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
  'OPERATIONAL_ALERT_MODE',
  'isAllowedSameOriginApiRequest',
  'Content-Security-Policy',
  'Strict-Transport-Security',
]) assert(runtime.includes(marker), `release runtime contract missing: ${marker}`);
const alertRuntime=read('apps/api/src/operational-readiness/alert-runtime.ts');
for(const marker of ['operationalAlertDescriptorFromRuntime','parseExactGitCommitSha','hashCanonicalJson','OPERATIONAL_ALERT_SINK_CONFIG_FINGERPRINT'])assert(alertRuntime.includes(marker),`operational alert runtime contract missing: ${marker}`);
assert(read('apps/api/src/operational-readiness/alert-sink-contract.ts').includes('verifyOperationalAlertChallenge'),'operational alert RPC contract missing');
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
  'operationalAlertDescriptorFromService',
  'operationalAlertFingerprint',
  'parseExactGitCommitSha',
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
  schema_change: 'FORWARD_SCHEMA_72_LOCAL_ONLY',
  migration: '0001-0072_CONTINUOUS',
  release_templates: 'BLOCKED_NEEDS_OPERATOR_INPUT',
  local_implementation: 'PRESENT',
  external_acceptance: 'UNVERIFIED',
  production_go: 'NO_GO',
}, null, 2));
