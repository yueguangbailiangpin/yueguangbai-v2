import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const files = [
  'packages/contracts/src/buyer-portal.ts',
  'packages/contracts/src/buyer-order-evidence-portal.ts',
  'packages/contracts/src/buyer-formal-order-portal.ts',
  'packages/contracts/src/buyer-review-portal.ts',
  'packages/contracts/src/buyer-refund-portal.ts',
  'packages/contracts/src/order-instruction.ts',
  'apps/api/src/buyer-portal/read-model.ts',
  'apps/api/src/buyer-order-evidence-portal/read-model.ts',
  'apps/api/src/buyer-formal-orders/read-model.ts',
  'apps/api/src/buyer-reviews/read-model.ts',
  'apps/api/src/buyer-refund-status/read-model.ts',
  'apps/api/src/demand-batches/list-public-demand-batches.ts',
];
const failures = [];
for (const file of files) {
  const text = readFileSync(join(root, file), 'utf8');
  for (const field of [
    'asin:', 'asin_display:', 'asin_normalized:', 'product_url:',
    'search_keywords:', 'search_keywords_json:', 'keyword_text:',
    'seller_organization_id:', 'object_key:',
  ]) {
    if (text.includes(field)) failures.push(`${file}:${field}`);
  }
}
if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, files: files.length }, null, 2));
