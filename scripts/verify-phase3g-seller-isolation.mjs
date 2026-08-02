import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];
const read = (path) => readFileSync(join(root, path), 'utf8');
function walk(directory) {
  return readdirSync(join(root, directory)).flatMap((name) => {
    const path = join(directory, name);
    return statSync(join(root, path)).isDirectory() ? walk(path) : [path];
  });
}

const sellerDirectories = [
  'apps/api/src/seller-portal',
  'apps/api/src/seller-formal-orders',
  'apps/api/src/seller-reviews',
];
const sellerFiles = sellerDirectories.flatMap(walk)
  .filter((path) => /\.(?:ts|tsx)$/u.test(path) && !path.endsWith('.test.ts'));
const sellerSource = sellerFiles.map(read).join('\n');
for (const forbidden of [
  /buyer_self_pay/iu,
  /buyer_refundable_principal/iu,
  /buyer_self_pay_contribution/iu,
  /buyer_self_pay_accepted/iu,
]) {
  if (forbidden.test(sellerSource)) failures.push(`seller_source:${forbidden}`);
}

const sellerTests = [
  'apps/api/src/seller-portal/seller-portal.test.ts',
  'apps/api/src/seller-formal-orders/seller-formal-orders.test.ts',
  'apps/api/src/seller-reviews/seller-reviews.test.ts',
].map(read).join('\n');
for (const runtimeMarker of [
  'buyer_self_pay',
  'buyer_refundable_principal',
]) {
  if (!sellerTests.includes(runtimeMarker)) {
    failures.push(`missing_runtime_isolation_assertion:${runtimeMarker}`);
  }
}

const staffCatalog = read('apps/api/src/staff-catalog-routes.ts');
if (!/staffAuthorization/u.test(staffCatalog)
  || !/DEPENDENCY_UNAVAILABLE/u.test(staffCatalog)) {
  failures.push('staff_catalog_must_fail_closed_without_authorization');
}

if (failures.length > 0) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({
  ok: true,
  seller_source_files: sellerFiles.length,
  runtime_isolation_markers: 2,
}, null, 2));
