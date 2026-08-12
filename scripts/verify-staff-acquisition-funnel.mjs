import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';

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

const staffRoute = parse('apps/web/src/staff/StaffRouteModule.tsx', ts.ScriptKind.TSX);
const coreWorkbench = parse('apps/web/src/staff/acquisition/AcquisitionCoreWorkbench.tsx', ts.ScriptKind.TSX);
const contract = parse('packages/contracts/src/acquisition.ts', ts.ScriptKind.TS);
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

assert(hasNamedImport(staffRoute, './acquisition/AcquisitionCoreWorkbench', 'AcquisitionCoreWorkbench')
  && hasJsxElement(staffRoute, 'AcquisitionCoreWorkbench'),
  'canonical Staff route composition is missing');
assert(hasNamedReExport(coreWorkbench, './AcquisitionCoreWorkbenchV4',
  'AcquisitionCoreWorkbenchV4', 'AcquisitionCoreWorkbench'),
  'canonical Core-to-V4 re-export is missing');
assert(hasInterfaceFields(contract, 'CreateAcquisitionLeadCommand', [
  'lead_type', 'marketplace_code', 'channel_id', 'prospect_id',
]) && hasInterfaceFields(contract, 'AcquisitionChannelDto', [
  'channel_id', 'channel_type', 'lead_type', 'marketplace_code', 'status',
]), 'published acquisition contract exports drifted');
assert(existsSync(path.join(root, 'apps/web/src/staff/acquisition/AcquisitionCoreWorkbenchV4.msw.test.tsx'))
  && existsSync(path.join(root, 'apps/web/e2e/staff-acquisition.spec.ts'))
  && !existsSync(path.join(root, 'apps/web/src/staff/acquisition/AcquisitionWorkbench.tsx'))
  && !existsSync(path.join(root, 'apps/web/src/staff/acquisition/AcquisitionWorkbench.msw.test.tsx')),
  'canonical evidence path or legacy alias retirement drift');

const behaviorScript = manifest.scripts?.['test:staff-acquisition'];
assert(typeof behaviorScript === 'string' && behaviorScript.length > 0,
  'test:staff-acquisition behavior gate is missing');
assert(!/verify:staff-acquisition|check:staff-acquisition/u.test(behaviorScript),
  'test:staff-acquisition must not invoke its verifier or module check recursively');
const behaviorResult = spawnSync('npm', ['run', 'test:staff-acquisition'], {
  cwd: root,
  stdio: 'inherit',
});
assert(behaviorResult.status === 0,
  `behavior test gate failed (${behaviorResult.error?.message ?? `exit ${behaviorResult.status}`})`);

console.log(JSON.stringify({
  status: 'PASS', schema: 36, migration: acquisitionMigrations.at(-1),
  structural: {
    status: 'PASS', canonical_composition: true, legacy_alias_absent: true,
    published_contract_exports: true,
  },
  behavior_tests: {
    status: 'PASS', command: 'npm run test:staff-acquisition',
    scope: 'D1/API acquisition behavior plus canonical Staff acquisition UI and API contract tests',
  },
  buyer_refund_authority: false, production_resources_touched: 0,
  pre_upgrade_restore: true,
}, null, 2));

function parse(relativePath, scriptKind) {
  const filePath = path.join(root, relativePath);
  return ts.createSourceFile(filePath, readFileSync(filePath, 'utf8'), ts.ScriptTarget.Latest, true, scriptKind);
}

function hasNamedImport(sourceFile, modulePath, importedName) {
  return sourceFile.statements.some((statement) => ts.isImportDeclaration(statement)
    && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === modulePath
    && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)
    && statement.importClause.namedBindings.elements.some((element) => element.name.text === importedName));
}

function hasNamedReExport(sourceFile, modulePath, exportedFrom, exportedAs) {
  return sourceFile.statements.some((statement) => ts.isExportDeclaration(statement)
    && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === modulePath
    && statement.exportClause && ts.isNamedExports(statement.exportClause)
    && statement.exportClause.elements.some((element) => element.propertyName?.text === exportedFrom
      && element.name.text === exportedAs));
}

function hasJsxElement(sourceFile, componentName) {
  let found = false;
  const visit = (node) => {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node))
      && ts.isIdentifier(node.tagName) && node.tagName.text === componentName) found = true;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function hasInterfaceFields(sourceFile, interfaceName, expectedFields) {
  for (const statement of sourceFile.statements) {
    if (!ts.isInterfaceDeclaration(statement) || statement.name.text !== interfaceName) continue;
    const fields = new Set(statement.members.filter(ts.isPropertySignature)
      .map((member) => member.name && ts.isIdentifier(member.name) ? member.name.text : ''));
    return expectedFields.every((field) => fields.has(field));
  }
  return false;
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
