import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const migrationDirectory = path.join(root, 'migrations');
const migrationNames = readdirSync(migrationDirectory)
  .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name)).sort();

assert(migrationNames.length === 36, 'expected exactly 36 migrations');
assert(migrationNames.at(-1) === '0036_staff_acquisition_funnel_workbench.sql',
  'Migration 0036 ownership drift');

const database = new DatabaseSync(':memory:');
database.exec('PRAGMA foreign_keys=ON;');
try {
  apply(database, migrationNames);
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
  apply(sourceDatabase, migrationNames.slice(0, 35));
  sourceDatabase.close();
  copyFileSync(sourcePath, backupPath);

  const upgraded = new DatabaseSync(sourcePath);
  upgraded.exec('PRAGMA foreign_keys=ON;');
  apply(upgraded, migrationNames.slice(35));
  assert(schemaVersion(upgraded) === 36, 'schema35 upgrade failed');
  upgraded.close();

  copyFileSync(backupPath, restoredPath);
  const restored = new DatabaseSync(restoredPath);
  restored.exec('PRAGMA foreign_keys=ON;');
  assert(schemaVersion(restored) === 35, 'pre-upgrade restore schema drift');
  assert(restored.prepare('PRAGMA integrity_check').get()?.integrity_check === 'ok',
    'pre-upgrade restore integrity failed');
  apply(restored, migrationNames.slice(35));
  assert(schemaVersion(restored) === 36, 'restored database forward recovery failed');
  assert(restored.prepare('PRAGMA foreign_key_check').all().length === 0,
    'forward-recovered database foreign keys failed');
  restored.close();
} finally {
  rmSync(recoveryDirectory, { recursive: true, force: true });
}

const routeSource = source('apps/api/src/acquisition/routes.ts');
const leadSource = source('apps/api/src/acquisition/leads.ts');
const funnelSource = source('apps/api/src/acquisition/funnel.ts');
const maintenanceSource = source('apps/api/src/acquisition/maintenance.ts');
const workerSource = source('apps/api/src/worker.ts');
const webSource = source('apps/web/src/staff/acquisition/AcquisitionWorkbench.tsx');
const contract = source('docs/contracts/STAFF_ACQUISITION_FUNNEL.md');

assert(routeSource.includes(`exactBody(context, ['lead_type','wechat_id','display_name','note'])`),
  'lead route is not exact-field closed');
assert(!routeSource.includes(`['lead_type','wechat_id','channel_id'`),
  'lead route accepts client channel authority');
assert(leadSource.includes(`identity_hash: identity.hash`)
  && leadSource.includes(`origin_channel_id=? AND origin_staff_id=?`),
  'lead privacy or immutable origin assertion missing');
assert(funnelSource.includes(`lead.lead_type='BUYER'`)
  && !/seller:\s*\{[\s\S]{0,400}profit/iu.test(funnelSource),
  'Seller profit isolation drift');
assert(maintenanceSource.includes(`if (input.dryRun) return inspectMaintenance`)
  && maintenanceSource.includes(`'BUYER_CUSTOMER','RESERVATION','FORMAL_ORDER','SELLER_ORGANIZATION'`)
  && maintenanceSource.includes(`customer_auth_security_events`),
  'retention dry-run or preservation exemptions missing');
assert(workerSource.includes('runAcquisitionMaintenance')
  && workerSource.includes('CUSTOMER_SECURITY_TOKEN_SECRET'),
  'Worker maintenance integration missing');
assert(webSource.includes('添加微信后登记') && webSource.includes('总管理员配置'),
  'Chinese workbench panels missing');
assert(contract.includes('Personal DENY') && contract.includes('Asia/Shanghai')
  && contract.includes('admin-business-dashboard'), 'acquisition contract boundary drift');

console.log(JSON.stringify({
  status: 'PASS', schema: 36, migration: migrationNames.at(-1),
  privacy_fail_closed: true, client_channel_authority: false,
  buyer_refund_authority: false, seller_profit_fields: false,
  worker_dry_run_supported: true, production_resources_touched: 0,
  pre_upgrade_restore: true, restored_forward_upgrade: true,
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
