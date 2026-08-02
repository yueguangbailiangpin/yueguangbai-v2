import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const migration = readFileSync(
  path.join(root, 'migrations/0026_financial_export_audit.sql'),
  'utf8',
);
const source = readFileSync(
  path.join(root, 'apps/api/src/internal-finance/exports.ts'),
  'utf8',
);
const routes = readFileSync(
  path.join(root, 'apps/api/src/internal-finance/routes.ts'),
  'utf8',
);
const csv = readFileSync(
  path.join(root, 'packages/domain/src/finance/csv.ts'),
  'utf8',
);
for (const token of [
  'financial_export_events',
  'trg_financial_export_events_no_update',
  'trg_financial_export_events_no_delete',
  'output_sha256',
  'filter_hash',
  'FINANCIAL_EXPORT_GENERATED',
  'serializeFinancialCsv',
  '\\uFEFF',
  '\\r\\n',
  'FINANCIAL_CSV_MAX_ROWS = 50_000',
  '25 * 1024 * 1024',
  'iterateFinancePositions',
  'iterateFinanceExceptions',
  'collectBounded',
  'maxGroups: FINANCIAL_CSV_MAX_ROWS',
  "date_basis !== 'CASH'",
  'database.batch(statements)',
  'DEPENDENCY_UNAVAILABLE',
  '/api/staff/finance/exports/csv',
]) {
  if (!(migration + source + routes + csv).includes(token)) {
    throw new Error(`missing ${token}`);
  }
}
if (/\b(?:R2|object_key|permanent_url|download_url)\b/iu.test(
  source + migration,
)) {
  throw new Error('financial export must not persist to object storage');
}
if (/client.*(?:column|sql|filename)|body\[['"](?:columns|sql|filename|sort)['"]\]/iu.test(
  source + routes,
)) {
  throw new Error('client-controlled CSV shape is forbidden');
}
if (/return\s+new\s+Response\([^)]*bytes/iu.test(source)) {
  throw new Error('CSV must be returned by the route only after audited DB batch');
}
const outboxPayload = source.slice(
  source.indexOf('payload: {'),
  source.indexOf('createdAt: now,', source.indexOf('payload: {')),
);
for (const forbidden of ['bytes', 'csv', 'order_detail', 'filter_json']) {
  if (outboxPayload.includes(forbidden)) {
    throw new Error(`outbox payload contains ${forbidden}`);
  }
}
console.log(JSON.stringify({
  status: 'PASS',
  phase: '3M',
  source_preflight: true,
  audit_before_response: true,
}, null, 2));
