import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const customerContracts = [
  'packages/contracts/src/buyer-formal-order-portal.ts',
  'packages/contracts/src/buyer-refund-portal.ts',
  'packages/contracts/src/buyer-portal.ts',
  'packages/contracts/src/seller-formal-order-portal.ts',
  'packages/contracts/src/seller-settlement.ts',
  'packages/contracts/src/seller-portal.ts',
];
for (const file of customerContracts) {
  const source = readFileSync(path.join(root, file), 'utf8');
  if (/gross_profit|projected_gross_profit|completed_gross_profit|attributed_cash_net/iu.test(source)) {
    throw new Error(`profit leaked into customer contract: ${file}`);
  }
}
const finance = readFileSync(
  path.join(root, 'apps/api/src/internal-finance/routes.ts'),
  'utf8',
) + readFileSync(
  path.join(root, 'apps/api/src/internal-finance/exports.ts'),
  'utf8',
);
for (const forbidden of [
  'object_key',
  'file_url',
  'payment_proof',
  'buyer_wechat',
  'password',
  'session_secret',
]) {
  if (finance.includes(forbidden)) {
    throw new Error(`sensitive finance DTO token: ${forbidden}`);
  }
}
console.log(JSON.stringify({
  status: 'PASS',
  buyer_seller_isolation: true,
}, null, 2));
