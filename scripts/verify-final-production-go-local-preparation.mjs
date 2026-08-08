import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const assert = (value, message) => {
  if (!value) throw new Error(message);
};

const migrations = readdirSync(path.join(root, 'migrations'))
  .filter((file) => /^\d{4}_.+\.sql$/u.test(file))
  .sort();
assert(migrations.length === 37, `expected 37 migrations, found ${migrations.length}`);
assert(migrations.every((file, index) => Number(file.slice(0, 4)) === index + 1),
  'migration chain is not continuous');
assert(migrations.at(-1) === '0037_product_reservation_order_scheduling.sql',
  'unexpected migration tail');

const webPackage = JSON.parse(read('apps/web/package.json'));
const lock = JSON.parse(read('package-lock.json'));
const lockedRouter = lock.packages?.['apps/web/node_modules/react-router'];
assert(webPackage.dependencies?.['react-router'] === '8.3.0',
  'react-router must remain pinned to 8.3.0');
assert(webPackage.dependencies?.['react-router-dom'] === undefined,
  'react-router-dom must remain absent');
assert(lockedRouter?.version === '8.3.0'
  && lockedRouter?.integrity === 'sha512-qyPMvW83jGIct3yiieisxdk9M745anqhpIMKN5m1t6yBMfgVPpt77aHOqs5fUlEJRMCGffg9BaQLH9oPVOL7xQ==',
  'lockfile does not resolve the audited react-router artifact');

const productionRunbook = read('docs/runbooks/PRODUCTION_READINESS_BACKUP_RESTORE.md');
for (const marker of [
  '连续 `0001`–`0037`',
  '`app_schema_state.schema_version=37`',
  '--expected-schema 37',
  '不得因为仓库当前末号为 `0037` 就推断线上已应用到 `0037`',
]) assert(productionRunbook.includes(marker), `production runbook missing: ${marker}`);
assert(!productionRunbook.includes('--expected-schema 35'),
  'production runbook still contains stale schema 35 command');

const evidence = read('docs/acceptance/FINAL_PRODUCTION_GO_LOCAL_PREPARATION.md');
for (const marker of [
  'b74a029876301a4f8bbb6ebd305ead13a6f2cd59',
  '8c4fdaa382fd1e2c56d76aa23bb6b960c4f6f72c',
  'LOCAL_IMPLEMENTATION_PRESENT_EXTERNAL_UNVERIFIED',
  'productionActivationSupported=false',
  'Production GO 阻断',
  '`NO-GO`',
]) assert(evidence.includes(marker), `evidence audit missing: ${marker}`);

const checklist = read('docs/runbooks/FINAL_PRODUCTION_GO_OWNER_CHECKLIST.md');
for (let gate = 0; gate <= 8; gate += 1) {
  assert(checklist.includes(`Gate ${gate}`), `owner checklist missing Gate ${gate}`);
}
for (const marker of [
  'Drive 真实 read-back',
  'byte size、MIME、SHA-256',
  'D1 Manifest',
  '删除 R2',
  '回网页重新授权',
  'PRODUCTION_GO=APPROVED',
]) assert(checklist.includes(marker), `owner checklist missing: ${marker}`);

for (const file of [
  'openspec/changes/archive/2026-08-09-final-production-go-local-preparation/.openspec.yaml',
  'openspec/changes/archive/2026-08-09-final-production-go-local-preparation/proposal.md',
  'openspec/changes/archive/2026-08-09-final-production-go-local-preparation/design.md',
  'openspec/changes/archive/2026-08-09-final-production-go-local-preparation/tasks.md',
  'openspec/changes/archive/2026-08-09-final-production-go-local-preparation/specs/production-go-local-preparation/spec.md',
  'openspec/changes/archive/2026-08-07-production-readiness-backup-validation/proposal.md',
  'openspec/changes/pre-wave13-baseline-conformance-audit/tasks.md',
  'openspec/changes/archive/2026-08-09-production-cloudflare-web-r2-release-configuration/proposal.md',
  'openspec/changes/archive/2026-08-09-production-cloudflare-web-r2-release-configuration/design.md',
  'openspec/changes/archive/2026-08-09-production-cloudflare-web-r2-release-configuration/tasks.md',
  'openspec/changes/archive/2026-08-09-production-cloudflare-web-r2-release-configuration/specs/production-cloudflare-web-r2-release-configuration/spec.md',
  'apps/api/wrangler.staging.template.jsonc',
  'apps/api/wrangler.production.template.jsonc',
  'apps/api/src/files/r2-object-storage.ts',
  'apps/api/src/cloudflare-runtime.ts',
  'scripts/preflight-cloudflare-release.mjs',
  'scripts/verify-production-cloudflare-web-r2-release-configuration.mjs',
  'docs/contracts/PRODUCTION_CLOUDFLARE_WEB_R2_RELEASE.md',
  'docs/runbooks/PRODUCTION_CLOUDFLARE_WEB_R2_RELEASE.md',
]) assert(existsSync(path.join(root, file)), `required governance evidence missing: ${file}`);

const exampleConfig = read('wrangler.example.jsonc');
const localConfig = read('apps/api/wrangler.local.jsonc');
assert(exampleConfig.includes('REPLACE_BEFORE_USE')
  && exampleConfig.includes('"binding": "FILE_OBJECT_STORAGE_R2"')
  && exampleConfig.includes('"binding": "WEB_ASSETS"'),
  'example Cloudflare placeholder evidence changed');
for (const marker of [
  '"SCHEDULED_OPERATIONS_ENABLED": "false"',
  '"DRIVE_ARCHIVE_ENABLED": "false"',
  '"DRIVE_ARCHIVE_R2_DELETE_ENABLED": "false"',
]) assert(localConfig.includes(marker), `local fail-closed config missing: ${marker}`);

const workflowFiles = readdirSync(path.join(root, '.github/workflows'))
  .filter((file) => /\.ya?ml$/u.test(file));
assert(workflowFiles.length === 0, 'CI workflow now exists; refresh release-control audit');
assert(!existsSync(path.join(root, 'wrangler.production.jsonc')),
  'rendered production config exists; refresh deployment audit');
assert(!existsSync(path.join(root, 'apps/api/wrangler.production.jsonc')),
  'rendered API production config exists; refresh deployment audit');
assert(!existsSync(path.join(root, 'apps/api/wrangler.staging.jsonc')),
  'rendered API staging config exists; refresh deployment audit');

const feishuFiles = readdirSync(path.join(root, 'apps/api/src/feishu-workbench'));
assert(feishuFiles.includes('mock-adapter.ts')
  && !feishuFiles.some((file) => /production.*adapter|adapter.*production/iu.test(file)),
  'Feishu production-adapter status changed; refresh external blocker');
const mcpRuntime = read('apps/api/src/staff-mcp/runtime.ts');
assert(mcpRuntime.includes('productionActivationSupported: false'),
  'Staff MCP production activation status changed; refresh audit');

console.log(JSON.stringify({
  status: 'PASS',
  change: 'final-production-go-local-preparation',
  migration: '0001-0037_CONTINUOUS',
  react_router: '8.3.0_LOCKED_CURRENT_AUDIT_REQUIRED',
  production_config: 'LOCAL_IMPLEMENTATION_PRESENT_EXTERNAL_UNVERIFIED',
  external_integrations: 'OWNER_ACTION_REQUIRED_BLOCKED',
  production_go: 'NO_GO',
}, null, 2));
