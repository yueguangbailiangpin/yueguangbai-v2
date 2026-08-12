import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const migrationDirectory = path.join(root, 'migrations');
const migrationNames = readdirSync(migrationDirectory)
  .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name)).sort();

assertContiguousMigrations(migrationNames);
assert(migrationNames.length >= 36, 'missing governed 0036 migration prefix');
const acquisitionMigrations = migrationNames.slice(0, 36);
assert(acquisitionMigrations.at(-1) === '0036_staff_acquisition_funnel_workbench.sql',
  'Migration 0036 ownership drift');

const database = new DatabaseSync(':memory:');
database.exec('PRAGMA foreign_keys=ON;');
try {
  apply(database, acquisitionMigrations);
  assert(Number(database.prepare(`SELECT schema_version FROM app_schema_state
    WHERE singleton_id=1`).get()?.schema_version) === 36, 'schema is not 36');
  assert(database.prepare('PRAGMA integrity_check').get()?.integrity_check === 'ok',
    'integrity check failed');
  assert(database.prepare('PRAGMA foreign_key_check').all().length === 0,
    'foreign key check failed');
  assert(Number(database.prepare(`SELECT COUNT(*) AS count
    FROM acquisition_role_permission_defaults WHERE role_code='buyer_refund'`).get()?.count) === 0,
  'buyer_refund gained acquisition authority');
  assert(Number(database.prepare(`SELECT COUNT(*) AS count
    FROM acquisition_role_permission_defaults`).get()?.count) === 5,
  'acquisition role defaults drift');
} finally {
  database.close();
}

const recoveryDirectory = mkdtempSync(path.join(tmpdir(), 'ygb-acquisition-recovery-'));
try {
  const sourcePath = path.join(recoveryDirectory, 'schema35.sqlite');
  const backupPath = path.join(recoveryDirectory, 'schema35.backup.sqlite');
  const restoredPath = path.join(recoveryDirectory, 'schema35.restored.sqlite');
  const sourceDatabase = new DatabaseSync(sourcePath);
  sourceDatabase.exec('PRAGMA foreign_keys=ON;');
  apply(sourceDatabase, acquisitionMigrations.slice(0, 35));
  sourceDatabase.close();
  copyFileSync(sourcePath, backupPath);

  const upgraded = new DatabaseSync(sourcePath);
  upgraded.exec('PRAGMA foreign_keys=ON;');
  apply(upgraded, acquisitionMigrations.slice(35));
  assert(schemaVersion(upgraded) === 36, 'schema35 upgrade failed');
  upgraded.close();

  copyFileSync(backupPath, restoredPath);
  const restored = new DatabaseSync(restoredPath);
  restored.exec('PRAGMA foreign_keys=ON;');
  assert(schemaVersion(restored) === 35, 'pre-upgrade restore schema drift');
  assert(restored.prepare('PRAGMA integrity_check').get()?.integrity_check === 'ok',
    'pre-upgrade restore integrity failed');
  apply(restored, acquisitionMigrations.slice(35));
  assert(schemaVersion(restored) === 36, 'restored database forward recovery failed');
  assert(restored.prepare('PRAGMA foreign_key_check').all().length === 0,
    'forward-recovered database foreign keys failed');
  restored.close();
} finally {
  rmSync(recoveryDirectory, { recursive: true, force: true });
}

const routeSource = source('apps/api/src/acquisition/routes.ts');
const leadSource = source('apps/api/src/acquisition/leads.ts');
const routeRegistry = source('apps/api/src/index.ts');
const contractSource = source('packages/contracts/src/acquisition.ts');
const contractDoc = source('docs/contracts/STAFF_ACQUISITION_FUNNEL.md');
const behaviorTests = source('apps/api/src/acquisition/acquisition.test.ts');
const maintenanceDryRunTests = source('apps/api/src/acquisition/maintenance-dry-run.test.ts');
const workerSource = source('apps/api/src/worker.ts');
const webV4Source = source('apps/web/src/staff/acquisition/AcquisitionCoreWorkbenchV4.tsx');
const browserEvidence = source('apps/web/e2e/staff-acquisition.spec.ts');
const packageManifest = source('package.json');
const decision = source('docs/decisions/V2_DECISION_REGISTER.md');
const canonicalSpec = source('openspec/specs/staff-acquisition-funnel/spec.md');

assert(routeRegistry.includes('registerAcquisitionRoutes(app);'),
  'acquisition route registration is missing');
assert(routeSource.includes("app.post('/api/staff/acquisition/leads',customerAuthOriginGuard()"),
  'lead route lacks same-origin middleware');
assert(routeSource.includes("exactBody(context,['lead_type','marketplace_code','channel_id','prospect_id','wechat_id','display_name','note'])"),
  'lead route is not exact-field closed for the current explicit-source command');
assert(contractSource.includes('export interface CreateAcquisitionLeadCommand')
  && contractSource.includes('channel_id:string;')
  && contractSource.includes('prospect_id:string|null;')
  && contractSource.includes('marketplace_code:string;'),
  'current explicit-source lead contract drift');
assert(contractDoc.includes('直接 Lead 可以提交或确认显式 `channel_id` 作为来源声明')
  && contractDoc.includes('该字段不授予权限')
  && contractDoc.includes('渠道存在且 ACTIVE、Buyer/Seller audience')
  && contractDoc.includes('当前 Marketplace scope')
  && contractDoc.includes('与 Prospect 的原始渠道精确一致')
  && contractDoc.includes('追加式、版本化、审计的受控更正历史')
  && contractDoc.includes('Personal DENY')
  && contractDoc.includes('Asia/Shanghai')
  && contractDoc.includes('admin-business-dashboard')
  && contractDoc.includes('正式订单和内部利润只通过 BUYER 线索的初始来源归因')
  && !contractDoc.includes('创建线索的请求不包含 `channel_id`'),
  'staff acquisition contract source authority or retained boundary drift');
assert(leadSource.includes('requireLeadDuty(command.actor,input.leadType)')
  && leadSource.includes('await requireStaffMarket(database,command.actor,marketplaceCode)')
  && leadSource.includes("channel.status!=='ACTIVE'")
  && leadSource.includes("channel.lead_type===input.leadType||channel.lead_type==='BOTH'")
  && leadSource.includes('prospect.origin_channel_id!==channelId'),
  'lead source authority guards drift');
assert(behaviorTests.includes('fails closed for disabled, wrong-audience, wrong-market and out-of-scope declared channels')
  && behaviorTests.includes('inherits a Prospect exact origin and rejects a mismatched declared channel')
  && behaviorTests.includes('accepts an explicit legal direct source')
  && behaviorTests.includes('attributes a shared order profit once to Buyer origin and never to Seller funnel'),
  'required explicit-source behavior evidence is missing');
assert(packageManifest.includes('"dry-run:staff-acquisition": "vitest run apps/api/src/acquisition/maintenance-dry-run.test.ts"')
  && packageManifest.includes('npm run dry-run:staff-acquisition')
  && maintenanceDryRunTests.includes('reports only counts and leaves leads, leases, runs and audit facts unchanged'),
  'maintenance dry-run evidence ownership drift');
const maintenanceGate = workerSource.indexOf("bindings.ACQUISITION_MAINTENANCE_ENABLED === 'true'");
const maintenanceCall = workerSource.indexOf('await runAcquisitionMaintenance', maintenanceGate);
const maintenanceSecret = workerSource.indexOf('CUSTOMER_SECURITY_TOKEN_SECRET', maintenanceCall);
assert(maintenanceGate >= 0 && maintenanceCall > maintenanceGate && maintenanceSecret > maintenanceCall,
  'Worker maintenance flag/secret fail-closed wiring drift');
assert(packageManifest.includes('"test:staff-acquisition:browser"')
  && packageManifest.includes('apps/web/e2e/staff-acquisition.spec.ts')
  && webV4Source.includes('export function AcquisitionCoreWorkbenchV4')
  && webV4Source.includes('真实平台和开发方法只对总管理员、获客岗位开放')
  && browserEvidence.includes("name: '客户开发中心'")
  && browserEvidence.includes("'真实来源渠道'"),
  'current V4 browser/UI evidence ownership drift');
assert(decision.includes('### D-035 获客来源显式受控声明')
  && decision.includes('D-026 的历史正文永久保留'),
  'D-035 or D-026 preservation evidence is missing');
assert(canonicalSpec.includes('Explicit controlled source declaration')
  && canonicalSpec.includes('Prospect-to-Lead inherits the exact origin channel')
  && canonicalSpec.includes('Original source is immutable and correction is controlled'),
  'canonical OpenSpec source-authority requirements are missing');

console.log(JSON.stringify({
  status: 'PASS', schema: 36, migration: acquisitionMigrations.at(-1),
  explicit_source_command: true, route_registered: true, exact_field_closed: true,
  source_authority_guards: true, behavior_evidence: true, contract_doc_aligned: true,
  seller_profit_isolation: true, maintenance_dry_run_gate: true,
  worker_maintenance_fail_closed: true, v4_browser_evidence: true, decision_and_canonical_spec: true,
  buyer_refund_authority: false, production_resources_touched: 0,
  pre_upgrade_restore: true,
}, null, 2));

function source(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function apply(database, names) {
  for (const name of names) {
    database.exec('BEGIN IMMEDIATE;');
    try {
      database.exec(readFileSync(path.join(migrationDirectory, name), 'utf8'));
      database.exec('COMMIT;');
    } catch (error) {
      try { database.exec('ROLLBACK;'); } catch { /* already rolled back */ }
      throw error;
    }
  }
}

function schemaVersion(database) {
  return Number(database.prepare(`SELECT schema_version FROM app_schema_state
    WHERE singleton_id=1`).get()?.schema_version);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertContiguousMigrations(names) {
  for (const [index, name] of names.entries()) {
    assert(Number(name.slice(0, 4)) === index + 1,
      `migration chain is not continuous at ${name}`);
  }
}
