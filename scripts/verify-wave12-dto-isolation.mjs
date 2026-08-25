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
const financeFiles = [
  'apps/api/src/internal-finance/routes.ts',
  'apps/api/src/internal-finance/exports.ts',
  'apps/api/src/internal-finance/order-detail.ts',
  'apps/api/src/internal-finance/read-model.ts',
];
const finance = financeFiles.map((file) => readFileSync(
  path.join(root, file),
  'utf8',
)).join('\n');
for (const forbidden of [
  'object_key',
  'file_url',
  'permanent_url',
  'payment_proof',
  'refund_proof',
  'buyer_wechat',
  'seller_member_contact',
  'password',
  'session_secret',
  'idempotency_payload',
  'internal_note',
]) {
  if (finance.includes(forbidden)) {
    throw new Error(`sensitive finance DTO token: ${forbidden}`);
  }
}
const routes = readFileSync(
  path.join(root, 'apps/api/src/internal-finance/routes.ts'),
  'utf8',
);
if (!routes.includes('buildFinanceOrderDetail(position')) {
  throw new Error('order detail must use the isolated financial projection');
}
console.log(JSON.stringify({
  status: 'PASS',
  buyer_seller_isolation: true,
  staff_detail_isolation: true,
}, null, 2));
