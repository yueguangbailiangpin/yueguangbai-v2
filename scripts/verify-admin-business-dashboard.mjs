import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { resolveChangeFile } from './verifier-utils.mjs';

const root = process.cwd();
const migrations = readdirSync('migrations').filter((name) => /^\d{4}_.+\.sql$/u.test(name)).sort();
assertContiguousMigrations(migrations);
if (migrations.length < 37
  || migrations[35] !== '0036_staff_acquisition_funnel_workbench.sql'
  || migrations[36] !== '0037_product_reservation_order_scheduling.sql') {
  throw new Error('current governed migration chain is missing M14 acquisition or M16 scheduling ownership');
}
const dashboardProposal = readFileSync(
  resolveChangeFile('admin-business-dashboard', 'proposal.md', root), 'utf8',
);
const schedulingProposal = readFileSync(
  resolveChangeFile('staff-product-reservation-order-scheduling', 'proposal.md', root), 'utf8',
);
const schedulingMigration = readFileSync('migrations/0037_product_reservation_order_scheduling.sql', 'utf8');
if (!dashboardProposal.includes('预计不需要 Migration')
  || !schedulingProposal.includes('需要 Migration')
  || !schedulingMigration.includes('demand_order_schedule_versions')) {
  throw new Error('dashboard NO_SCHEMA_CHANGE or M16 migration ownership drift');
}

const sql = [
  'SELECT schema_version FROM app_schema_state WHERE singleton_id=1',
  `EXPLAIN QUERY PLAN SELECT id,activated_at FROM buyer_customers
    WHERE activated_at>=0 AND activated_at<9999999999999 AND activated_at<=9999999999999`,
  `EXPLAIN QUERY PLAN SELECT id,submitted_at FROM product_reservations
    WHERE submitted_at>=0 AND submitted_at<9999999999999 AND submitted_at<=9999999999999`,
  `EXPLAIN QUERY PLAN SELECT id,confirmed_business_date FROM formal_orders
    WHERE confirmed_business_date BETWEEN '2026-01-01' AND '2026-12-31'
      AND confirmed_at<=9999999999999`,
  `EXPLAIN QUERY PLAN SELECT formal_order_id,business_closed_at FROM order_archive_closures
    WHERE status='CLOSED' AND business_closed_at>=0
      AND business_closed_at<9999999999999 AND business_closed_at<=9999999999999`,
  `EXPLAIN QUERY PLAN SELECT channel_id,lead_type,SUM(person_count)
    FROM acquisition_daily_consultations
    WHERE business_date BETWEEN '2026-01-01' AND '2026-12-31'
    GROUP BY channel_id,lead_type`,
  `EXPLAIN QUERY PLAN SELECT lead.id,link.target_id
    FROM acquisition_leads lead JOIN acquisition_lead_links link
      ON link.lead_id=lead.id AND link.link_type='FORMAL_ORDER'
    WHERE lead.status='ACTIVE' AND lead.lead_type='BUYER'`,
  `EXPLAIN QUERY PLAN SELECT formal_order_id,confirmed_business_date,
      review_approved_business_date,projected_gross_profit_cny_fen,
      completed_gross_profit_cny_fen,finance_status
    FROM internal_order_finance_positions
    WHERE (confirmed_business_date BETWEEN '2026-01-01' AND '2026-12-31'
      AND confirmed_at<=9999999999999)
      OR (review_approved_business_date BETWEEN '2026-01-01' AND '2026-12-31'
      AND review_approved_at<=9999999999999)`,
].join(';');
const output = execFileSync('node_modules/.bin/wrangler', [
  'd1', 'execute', 'yueguangbai-v2-local', '--local', '--json',
  '--config', 'apps/api/wrangler.local.jsonc', '--command', sql,
], { encoding: 'utf8' });
const result = JSON.parse(output);
const currentSchemaVersion = Number(migrations.at(-1)?.slice(0, 4));
if (result[0]?.results?.[0]?.schema_version !== currentSchemaVersion) {
  throw new Error(`Expected local D1 schema ${currentSchemaVersion}: ${output}`);
}
const details = result.slice(1).flatMap((entry) => entry.results.map((row) => String(row.detail)));
for (const required of [
  'idx_order_archive_closures_due', 'idx_acquisition_consultations_date',
  'idx_acquisition_lead_links_target', 'MATERIALIZE snapshot_facts',
  'uq_review_approval_events_once', 'idx_seller_allocation_reversals_allocation',
  'idx_buyer_refund_payment_entries_obligation',
]) {
  if (!details.some((detail) => detail.includes(required))) {
    throw new Error(`Local D1 query plan did not use ${required}: ${details.join(' | ')}`);
  }
}

const backend = {
  routes: parse('apps/api/src/admin-business-dashboard/routes.ts', ts.ScriptKind.TS),
  readModel: parse('apps/api/src/admin-business-dashboard/read-model.ts', ts.ScriptKind.TS),
  contracts: parse('packages/contracts/src/admin-business-dashboard.ts', ts.ScriptKind.TS),
};
assert(hasExport(backend.routes, 'registerAdminBusinessDashboardRoutes')
  && hasExport(backend.readModel, 'readAdminBusinessDashboardTrend')
  && hasExport(backend.readModel, 'readAdminBusinessDashboardDrillDown')
  && hasExport(backend.contracts, 'ADMIN_BUSINESS_DASHBOARD_PATHS'),
'retained Admin backend route/read-model/contract capability drift');

const staffRoute = parse('apps/web/src/staff/StaffRouteModule.tsx', ts.ScriptKind.TSX);
const adminRoute = parse('apps/web/src/staff/StaffAdminRouteModule.tsx', ts.ScriptKind.TSX);
const frozen = parse('apps/web/src/staff/admin-dashboard/FrozenAdminBusinessDashboard.tsx', ts.ScriptKind.TSX);
assert(hasDynamicImportBinding(staffRoute, 'loadStaffAdminRoutes', './StaffAdminRouteModule')
  && hasRouteChunkLoad(staffRoute, 'loadStaffAdminRoutes'),
'canonical Staff route no longer loads the Admin route module');
assert(hasNamedReExport(adminRoute, './admin-dashboard/FrozenAdminBusinessDashboard',
  'FrozenAdminBusinessDashboard', 'default'),
'Admin route module no longer defaults to FrozenAdminBusinessDashboard');
assert(hasExport(frozen, 'FrozenAdminBusinessDashboard')
  && hasPropertyAccess(frozen, 'staffApi', 'adminDashboardSummary'),
'Frozen Admin frontend no longer consumes its canonical summary client');
for (const relative of [
  'apps/web/src/staff/admin-dashboard/FrozenAdminBusinessDashboard.msw.test.tsx',
  'apps/web/e2e/admin-business-dashboard.spec.ts',
]) assert(existsSync(path.join(root, relative)), `missing canonical frontend evidence: ${relative}`);
for (const relative of [
  'apps/web/src/staff/admin-dashboard/AdminBusinessDashboard.tsx',
  'apps/web/src/staff/admin-dashboard/AdminBusinessDashboard.msw.test.tsx',
]) assert(!existsSync(path.join(root, relative)), `retired legacy frontend remains: ${relative}`);

console.log(JSON.stringify({
  status: 'PASS',
  backend_schema_query_plan: {
    status: 'PASS', schema: currentSchemaVersion,
    retained_capabilities: ['routes', 'trend read model', 'drilldown read model', 'shared contracts'],
    query_plan: 'bounded core scans plus existing acquisition, closure, and canonical finance indexes/views',
  },
  canonical_frontend_structure: {
    status: 'PASS',
    route: 'StaffRouteModule -> StaffAdminRouteModule -> FrozenAdminBusinessDashboard',
    behavior_evidence_paths: [
      'apps/web/src/staff/admin-dashboard/FrozenAdminBusinessDashboard.msw.test.tsx',
      'apps/web/e2e/admin-business-dashboard.spec.ts',
    ],
    legacy_frontend_absent: true,
  },
  note: 'The local D1 query plan proves backend capability only; canonical frontend behavior is exercised by the separate Admin Vitest and browser gates.',
  production_resources_touched: 0,
}, null, 2));

function parse(relative, scriptKind) {
  const filePath = path.join(root, relative);
  return ts.createSourceFile(filePath, readFileSync(filePath, 'utf8'), ts.ScriptTarget.Latest, true, scriptKind);
}

function hasExport(source, name) {
  return source.statements.some((statement) => {
    if (!statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) return false;
    return ('name' in statement && statement.name && ts.isIdentifier(statement.name) && statement.name.text === name)
      || (ts.isVariableStatement(statement) && statement.declarationList.declarations.some((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name));
  });
}

function hasDynamicImportBinding(source, binding, modulePath) {
  return source.statements.some((statement) => ts.isVariableStatement(statement)
    && statement.declarationList.declarations.some((declaration) => ts.isIdentifier(declaration.name)
      && declaration.name.text === binding && dynamicImportPath(declaration.initializer) === modulePath));
}

function dynamicImportPath(initializer) {
  const expression = initializer && ts.isArrowFunction(initializer) ? initializer.body : initializer;
  return expression && ts.isCallExpression(expression) && expression.expression.kind === ts.SyntaxKind.ImportKeyword
    && ts.isStringLiteral(expression.arguments[0]) ? expression.arguments[0].text : null;
}

function hasRouteChunkLoad(source, binding) {
  let found = false;
  const visit = (node) => {
    if (ts.isJsxSelfClosingElement(node) && ts.isIdentifier(node.tagName) && node.tagName.text === 'RouteChunkBoundary') {
      const load = node.attributes.properties.find((property) => ts.isJsxAttribute(property) && property.name.text === 'load');
      if (load && ts.isJsxExpression(load.initializer) && load.initializer.expression
        && ts.isIdentifier(load.initializer.expression) && load.initializer.expression.text === binding) found = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function hasNamedReExport(source, modulePath, exportedFrom, exportedAs) {
  return source.statements.some((statement) => ts.isExportDeclaration(statement)
    && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === modulePath
    && statement.exportClause && ts.isNamedExports(statement.exportClause)
    && statement.exportClause.elements.some((element) => element.propertyName?.text === exportedFrom
      && element.name.text === exportedAs));
}

function hasPropertyAccess(source, objectName, propertyName) {
  let found = false;
  const visit = (node) => {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)
      && node.expression.text === objectName && node.name.text === propertyName) found = true;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function assertContiguousMigrations(names) {
  for (const [index, name] of names.entries()) {
    if (Number(name.slice(0, 4)) !== index + 1) throw new Error(`Migration chain is not continuous at ${name}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
