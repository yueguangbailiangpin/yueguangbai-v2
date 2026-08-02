import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];
function exists(path) {
  try { return statSync(join(root, path)).isFile(); } catch { return false; }
}
function read(path) { return readFileSync(join(root, path), 'utf8'); }
function walk(directory) {
  const absolute = join(root, directory);
  return readdirSync(absolute).flatMap((name) => {
    if (name === 'node_modules' || name === '.git') return [];
    const relative = join(directory, name);
    return statSync(join(root, relative)).isDirectory() ? walk(relative) : [relative];
  });
}
function requireText(name, text, pattern) {
  if (!pattern.test(text)) failures.push(name);
}
function forbidText(name, text, pattern) {
  if (pattern.test(text)) failures.push(name);
}

const requiredFiles = [
  'migrations/0021_order_instructions.sql',
  'packages/contracts/src/order-instruction.ts',
  'packages/domain/src/order-instructions/self-pay.ts',
  'apps/api/src/order-instructions/routes.ts',
  'apps/api/src/order-instructions/keyword-image-generator.ts',
  'apps/api/src/order-instructions/asset-preparation.ts',
  'apps/api/src/order-instructions/publish.ts',
  'apps/api/src/order-instructions/read-intent.ts',
  'apps/api/src/order-instructions/expiry.ts',
  'apps/api/src/order-instructions/reconciliation.ts',
  'apps/api/src/order-instructions/formal-order-integration.ts',
];
for (const file of requiredFiles) if (!exists(file)) failures.push(`missing:${file}`);

const instructionFiles = walk('apps/api/src/order-instructions')
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));
const instructionSource = instructionFiles.map(read).join('\n');
forbidText('new_module_task_claim', instructionSource, /['"]TASK_CLAIM['"]/u);
forbidText('new_module_public_queue', instructionSource, /['"](?:PUBLIC|CLAIMABLE|UNASSIGNED)['"]/u);
forbidText('buyer_object_key_dto', read('packages/contracts/src/order-instruction.ts'), /\bobject_key\s*:/u);
forbidText('buyer_keyword_plaintext_dto', read('packages/contracts/src/order-instruction.ts'), /\b(?:keyword_text|search_keywords(?:_json)?)\s*:/u);
forbidText('buyer_svg_output', instructionSource, /image\/svg\+xml|<svg/u);
requireText('generator_fail_closed', instructionSource, /DEPENDENCY_UNAVAILABLE/u);
requireText('service_binding_generator', read('apps/api/src/order-instructions/keyword-image-generator.ts'), /ServiceBinding/u);
requireText('hmac_keyword_digest', read('apps/api/src/order-instructions/asset-preparation.ts'), /HMAC|hmac/iu);
requireText('six_hour_exact', read('apps/api/src/order-instructions/shared.ts'), /6 \* 60 \* 60 \* 1000/u);
requireText('two_hour_exact', read('apps/api/src/order-instructions/shared.ts'), /2 \* 60 \* 60 \* 1000/u);
requireText('deadline_boundary', read('apps/api/src/order-instructions/evidence-integration.ts'), /now >= deadline/u);
requireText('current_version_read', read('apps/api/src/order-instructions/read-intent.ts'), /current_version_no/u);
requireText('formal_claim_insert', read('apps/api/src/order-instructions/formal-order-integration.ts'), /INSERT INTO formal_order_number_claims/u);
requireText('buyer_refundable_finance', read('apps/api/src/order-instructions/formal-order-integration.ts'), /buyerRefundablePrincipalJpy/u);

const sellerRoots = [
  'apps/api/src/seller-portal',
  'apps/api/src/seller-formal-orders',
  'apps/api/src/seller-reviews',
].filter((directory) => {
  try { return statSync(join(root, directory)).isDirectory(); } catch { return false; }
});
const sellerSource = sellerRoots.flatMap(walk)
  .filter((name) => /\.(?:ts|tsx)$/u.test(name) && !name.endsWith('.test.ts'))
  .map(read).join('\n');
forbidText('seller_self_pay_leak', sellerSource, /buyer_self_pay|buyer_refundable_principal|self_pay_contribution/u);

const buyerContractPaths = [
  'packages/contracts/src/buyer-portal.ts',
  'packages/contracts/src/buyer-order-evidence-portal.ts',
  'packages/contracts/src/buyer-formal-order-portal.ts',
  'packages/contracts/src/buyer-review-portal.ts',
  'packages/contracts/src/buyer-refund-portal.ts',
  'packages/contracts/src/order-instruction.ts',
].filter(exists);
const buyerContracts = buyerContractPaths.map(read).join('\n');
for (const field of [
  'asin', 'asin_display', 'asin_normalized', 'product_url',
  'search_keywords', 'search_keywords_json', 'keyword_text',
  'seller_organization_id', 'object_key',
]) {
  forbidText(`buyer_contract_field:${field}`, buyerContracts, new RegExp(`\\b${field}\\s*:`, 'u'));
}

const fontFiles = ['apps', 'packages', 'scripts', 'migrations']
  .flatMap(walk).filter((name) => /\.(?:ttf|otf|woff2?)$/iu.test(name));
if (fontFiles.length > 0) failures.push(`bundled_fonts:${fontFiles.join(',')}`);
const migrations = readdirSync(join(root, 'migrations'));
if (migrations.some((name) => /^002[2-9]_/.test(name))) failures.push('migration_above_0021');

if (failures.length > 0) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checked_files: instructionFiles.length }, null, 2));
