import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const routes = readFileSync(
  path.join(root, 'apps/api/src/internal-finance/routes.ts'),
  'utf8',
);
const shared = readFileSync(
  path.join(root, 'apps/api/src/internal-finance/shared.ts'),
  'utf8',
);
const policy = readFileSync(
  path.join(root, 'apps/api/src/staff/authorization-policy.ts'),
  'utf8',
);
const csv = readFileSync(
  path.join(root, 'packages/domain/src/finance/csv.ts'),
  'utf8',
);
for (const token of [
  "actor.roles.has('owner')",
  "'FINANCIAL_VIEW'",
  "'FINANCIAL_EXPORT'",
  'assertExactQueryParameters',
  'readBoundedJson',
  'Cache-Control',
  '/^[=+\\-@\\t\\r]/u',
  'protectSpreadsheetText',
]) {
  if (!(routes + shared + policy + csv).includes(token)) {
    throw new Error(`missing security token ${token}`);
  }
}
if (!policy.includes("'FINANCIAL_VIEW',\n  'FINANCIAL_CORRECT'")) {
  throw new Error('FINANCIAL_VIEW not in owner-only permission set');
}
for (const forbidden of ['staff_id', 'role', 'scope', 'global', 'team']) {
  if (new RegExp(`body\\[['\"]${forbidden}`, 'u').test(routes)) {
    throw new Error(`client authority field accepted: ${forbidden}`);
  }
}
if (/apps\/web|deploy|wrangler\s+deploy|feishu/iu.test(
  routes + shared + csv,
)) {
  throw new Error('Wave 12 finance module must not add frontend or deployment');
}
console.log(JSON.stringify({
  status: 'PASS',
  owner_only: true,
  personal_deny: true,
}, null, 2));
