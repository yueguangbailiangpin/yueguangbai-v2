import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const sellerSettlement = read('apps/api/src/seller-settlements/read-model.ts');
const sellerReview = read('apps/api/src/seller-reviews/review-url-projection.ts');
const buyerReview = read('apps/api/src/buyer-reviews/review-url-projection.ts');
const sellerContracts = read('packages/contracts/src/seller-settlement.ts');

for (const forbidden of [
  'buyer_self_pay',
  'buyer_refundable_principal',
  'buyer_refund',
  'profit',
  'object_key',
  'permanent_url',
  'recorded_by_staff_id',
  'reversed_by_staff_id',
]) assert(!sellerSettlement.toLowerCase().includes(forbidden));
assert(sellerReview.includes("review.status !== 'APPROVED'"));
assert(sellerReview.includes('review_url: null'));
assert(sellerReview.includes("review_case.status='APPROVED'"));
assert(buyerReview.includes('review_case.buyer_customer_id=?'));
assert(!buyerReview.includes('version_no=?'));
assert(!sellerContracts.includes('proof_file_object_id'));
assert(!sellerContracts.includes('staff_id'));

console.log('wave11 buyer seller dto isolation scan passed');
function read(file) { return readFileSync(path.join(root, file), 'utf8'); }
function assert(value) {
  if (!value) throw new Error('wave11_dto_isolation_scan_failed');
}