import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const files = [
  'migrations/0025_internal_finance_reporting.sql',
  'packages/domain/src/finance/calculations.ts',
  'apps/api/src/internal-finance/read-model.ts',
].map((file) => readFileSync(path.join(root, file), 'utf8')).join('\n');
for (const token of [
  'seller_expected_principal_cny_fen + service_fee_cny_fen',
  '- buyer_expected_principal_cny_fen',
  'seller_principal_due_cny_fen + seller_service_fee_due_cny_fen',
  '- buyer_refund_due_cny_fen',
  'seller_attributed_cash_cny_fen-buyer_refund_net_paid_cny_fen',
  'databaseIntegerToBigInt',
  'BigInt',
]) {
  if (!files.includes(token)) {
    throw new Error(`missing exact formula token: ${token}`);
  }
}
if (/parseFloat|\.toFixed\s*\(|Number\s*\(\s*(?:sum|total|amount)/u.test(files)) {
  throw new Error('unsafe financial floating-point conversion found');
}
console.log(JSON.stringify({
  status: 'PASS',
  exact_bigint_formulas: true,
}, null, 2));
