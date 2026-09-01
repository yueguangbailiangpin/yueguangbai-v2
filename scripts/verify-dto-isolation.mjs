// Stage 4 canonical verifier (D-054 §7 equivalence migration).
// Successor of verify:wave11-dto-isolation + verify:wave12:dto. Merged into one DTO isolation verifier.
// Assertions are carried over verbatim unless the stage 4 contract rebuild
// changed the asserted surface; changes are marked inline.

import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
function assert(value, label) { if (!value) throw new Error(`dto_isolation_failed: ${label ?? ''}`); }

// --- wave11 seller settlement / review isolation (carried verbatim) ---
const sellerSettlement = read('apps/api/src/seller-settlements/read-model.ts');
const sellerReview = read('apps/api/src/seller-reviews/review-url-projection.ts');
const buyerReview = read('apps/api/src/buyer-reviews/review-url-projection.ts');
const sellerContracts = read('packages/contracts/src/seller-settlement.ts');
for (const forbidden of [
  'buyer_self_pay', 'buyer_refundable_principal', 'buyer_refund', 'profit',
  'object_key', 'permanent_url', 'recorded_by_staff_id', 'reversed_by_staff_id',
]) assert(!sellerSettlement.toLowerCase().includes(forbidden), `seller settlement leaks ${forbidden}`);
assert(sellerReview.includes("review_url: review.status === 'APPROVED' ? row.review_url : null"), 'seller review url gate');
assert(buyerReview.includes('review_case.buyer_customer_id=?'), 'buyer review ownership');
assert(!buyerReview.includes('version_no=?'), 'buyer review version leak');
assert(!sellerContracts.includes('proof_file_object_id'), 'seller contract file object id');
assert(!sellerContracts.includes('staff_id'), 'seller contract staff id');

// --- wave12 financial DTO isolation (carried verbatim) ---
const financeOrders = read('apps/api/src/internal-finance/read-model.ts');
const financeRoutes = read('apps/api/src/internal-finance/routes.ts');
const financeContracts = read('packages/contracts/src/internal-finance.ts');
const financeExports = read('apps/api/src/internal-finance/exports.ts');
for (const file of [
  'apps/api/src/internal-finance/read-model.ts',
  'apps/api/src/internal-finance/routes.ts',
  'packages/contracts/src/internal-finance.ts',
  'apps/api/src/internal-finance/exports.ts',
]) {
  const text = read(file);
  for (const forbidden of [
    'buyer_wechat', 'buyer_display_name', 'seller_wechat',
    'object_key', 'permanent_url', 'file_object_id', 'upload_intent_id',
  ]) assert(!text.toLowerCase().includes(forbidden), `${file} leaks ${forbidden}`);
}
assert(financeContracts.includes('projected_gross_profit'), 'finance contract projected profit');

console.log(JSON.stringify({ status: 'PASS', verifier: 'dto-isolation', wave11_surface: 'seller-settlement/review', wave12_surface: 'internal-finance' }, null, 2));
