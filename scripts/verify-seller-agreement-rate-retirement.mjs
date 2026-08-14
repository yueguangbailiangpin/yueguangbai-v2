import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { repositoryRoot as root } from './verifier-utils.mjs';

const runtimeRoots = [
  'apps/api/src',
  'apps/api/test-support',
  'apps/web/src',
  'packages/contracts/src',
];
const runtimeFiles = runtimeRoots.flatMap((directory) =>
  walk(path.join(root, directory)))
  .filter((file) => !/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(file));
const forbidden = [
  'seller_agreement',
  'SELLER_AGREEMENT',
  'seller_rate_version_id',
  'seller_rate_version_no',
  'seller_rate_effective_from',
  'seller_rate_confirmed_at',
  'seller_rate_value',
  'seller_rate_scale',
  'seller_cny_per_jpy_e8',
  'SELLER_PRINCIPAL_RATE_ENFORCEMENT_ENABLED',
];
for (const file of runtimeFiles) {
  const source = readFileSync(file, 'utf8');
  for (const marker of forbidden) {
    if (source.includes(marker)) {
      throw new Error(`legacy Seller Agreement Rate marker: ${relative(file)}:${marker}`);
    }
  }
}

for (const removed of [
  'apps/api/src/formal-orders/confirm-formal-order.ts',
  'apps/api/src/marketplaces/lock-money-snapshot.ts',
  'apps/api/src/pricing/seller-agreement-rates.ts',
  'scripts/preflight-seller-principal-rate-activation.mjs',
]) {
  if (existsSync(path.join(root, removed))) {
    throw new Error(`retired runtime module remains: ${removed}`);
  }
}

for (const config of [
  'apps/api/wrangler.local.jsonc',
  'apps/api/wrangler.staging.template.jsonc',
  'apps/api/wrangler.production.template.jsonc',
]) {
  const source = readFileSync(path.join(root, config), 'utf8');
  if (source.includes('SELLER_PRINCIPAL_RATE_ENFORCEMENT_ENABLED')) {
    throw new Error(`retired compatibility flag remains: ${config}`);
  }
}

const authority = readFileSync(path.join(
  root,
  'apps/api/src/order-evidence/approve-order-evidence.ts',
), 'utf8');
for (const marker of [
  'resolveSellerPrincipalRateSnapshot',
  'INSERT INTO formal_order_financial_snapshots',
  'insertSellerPrincipalRateSnapshotStatement(',
  'INSERT INTO formal_order_marketplace_money_snapshots',
]) {
  if (!authority.includes(marker)) {
    throw new Error(`canonical formal-order authority missing: ${marker}`);
  }
}
const principalPolicy = readFileSync(path.join(
  root,
  'apps/api/src/pricing/seller-principal-rate-policy.ts',
), 'utf8');
if (!principalPolicy.includes('INSERT INTO seller_principal_rate_snapshots')) {
  throw new Error('principal snapshot statement is missing');
}

console.log(JSON.stringify({
  status: 'PASS',
  runtime_files_scanned: runtimeFiles.length,
  legacy_runtime_markers: 0,
  compatibility_flags: 0,
  canonical_authority: 'order-evidence/approve-order-evidence.ts',
}, null, 2));

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

function relative(file) {
  return path.relative(root, file);
}
