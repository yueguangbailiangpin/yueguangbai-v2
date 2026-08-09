import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
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
assert(migrations.length === 43, `expected 43 migrations, found ${migrations.length}`);
assert(migrations.every((file, index) => Number(file.slice(0, 4)) === index + 1),
  'migration chain is not continuous');
assert(migrations.at(-3) === '0041_seller_principal_rate_policy.sql'
  && migrations.at(-2) === '0042_rakuten_tiktok_jp_marketplace_foundation.sql'
  && migrations.at(-1) === '0043_seller_principal_rate_integrity_hardening.sql',
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
  '连续 `0001`–`0043`',
  '`app_schema_state.schema_version=43`',
  '--expected-schema 43',
  '不得因为仓库当前末号为 `0043` 就推断线上已应用到 `0043`',
]) assert(productionRunbook.includes(marker), `production runbook missing: ${marker}`);
assert(!productionRunbook.includes('--expected-schema 35'),
  'production runbook still contains stale schema 35 command');

const evidence = read('docs/acceptance/FINAL_PRODUCTION_GO_LOCAL_PREPARATION.md');
for (const marker of [
  '`npm run release:check`',
  '`HEAD` 与 `HEAD^{tree}`',
  'LOCAL_IMPLEMENTATION_PRESENT_EXTERNAL_UNVERIFIED',
  'production-capable HTTPS/OAuth/D1/Service Binding/bounded-cleanup 边界已具备且默认关闭',
  'Production GO 阻断',
  '`NO-GO`',
]) assert(evidence.includes(marker), `evidence audit missing: ${marker}`);

const checklist = read('docs/runbooks/FINAL_PRODUCTION_GO_OWNER_CHECKLIST.md');
for (let gate = 0; gate <= 8; gate += 1) {
  assert(checklist.includes(`Gate ${gate}`), `owner checklist missing Gate ${gate}`);
}
for (const marker of [
  '`0001`–`0043` 连续',
  'release SHA 的完整 `0001`–`0043` 链',
  '线上可以是该链的连续前缀',
  'Drive 真实 read-back',
  'byte size、MIME、SHA-256',
  'D1 Manifest',
  '删除 R2',
  '回网页重新授权',
  'PRODUCTION_GO=APPROVED',
]) assert(checklist.includes(marker), `owner checklist missing: ${marker}`);
assert(!checklist.includes('0001–0039')
  && !checklist.includes('`0001`–`0038`'),
  'owner checklist contains a stale migration tail');

const staffMcpContract = read('docs/contracts/STAFF_MCP_V1.md');
assert(staffMcpContract.includes('当前仓库 schema 为 43')
  && staffMcpContract.includes('0038 的 MCP 归属保持不变'),
  'Staff MCP contract migration context is stale');

for (const [changeName, files] of [
  ['final-production-go-local-preparation', [
    '.openspec.yaml', 'proposal.md', 'design.md', 'tasks.md',
    'specs/production-go-local-preparation/spec.md',
  ]],
  ['production-readiness-backup-validation', ['proposal.md']],
  ['pre-wave13-baseline-conformance-audit', ['tasks.md']],
  ['production-cloudflare-web-r2-release-configuration', [
    'proposal.md', 'design.md', 'tasks.md',
    'specs/production-cloudflare-web-r2-release-configuration/spec.md',
  ]],
]) {
  for (const file of files) resolveChangeFile(changeName, file, root);
}

for (const file of [
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
  '"ACQUISITION_MAINTENANCE_ENABLED": "false"',
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
  && feishuFiles.includes('production-adapter.ts')
  && feishuFiles.includes('production-adapter.test.ts'),
  'Feishu local production-capable adapter evidence missing');
const feishuNoGo = read(resolveChangeFile(
  'feishu-workbench-production-adapter-activation',
  'references/local-acceptance-and-no-go.md',
  root,
));
assert(feishuNoGo.includes('LOCAL_IMPLEMENTATION_READY / PRODUCTION_NO_GO')
  && feishuNoGo.includes('No Provider API, Cloudflare, production D1/R2, domain, DNS or deployment was called.'),
  'Feishu production adapter is not paired with truthful external NO-GO evidence');
const mcpRuntime = read('apps/api/src/staff-mcp/runtime.ts');
const mcpNoGo = read('docs/acceptance/STAFF_MCP_PRODUCTION_TRANSPORT_OAUTH.md');
assert(mcpRuntime.includes('staffMcpProductionRuntime')
  && mcpRuntime.includes('STAFF_MCP_TOKEN_STATUS_SERVICE')
  && mcpRuntime.includes('D1StaffMcpApplicationService')
  && mcpNoGo.includes('LOCAL_IMPLEMENTATION_READY / PRODUCTION_NO_GO')
  && mcpNoGo.includes('OPENAI_RESOURCES_TOUCHED=no'),
  'Staff MCP local production boundary is not paired with truthful NO-GO evidence');

console.log(JSON.stringify({
  status: 'PASS',
  change: 'final-production-go-local-preparation',
  migration: '0001-0043_CONTINUOUS',
  react_router: '8.3.0_LOCKED_CURRENT_AUDIT_REQUIRED',
  production_config: 'LOCAL_IMPLEMENTATION_PRESENT_EXTERNAL_UNVERIFIED',
  external_integrations: 'OWNER_ACTION_REQUIRED_BLOCKED',
  production_go: 'NO_GO',
}, null, 2));
