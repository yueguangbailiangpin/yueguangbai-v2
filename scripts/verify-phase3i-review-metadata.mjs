import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const migration = read('migrations/0022_review_submission_metadata.sql');
const submit = read('apps/api/src/reviews/submit-review-evidence.ts');
const shared = read('apps/api/src/reviews/review-shared.ts');
const buyer = read('apps/api/src/buyer-reviews/review-url-projection.ts');
const seller = read('apps/api/src/seller-reviews/review-url-projection.ts');
const url = read('packages/domain/src/reviews/review-url.ts');

assert(migration.includes('schema_version=21'));
assert(migration.includes('schema_version=22'));
assert(migration.includes('ADD COLUMN review_url TEXT'));
assert(migration.includes('trg_review_evidence_version_url_guard'));
assert(url.includes("parsed.protocol !== 'https:'"));
assert(url.includes('parsed.username.length > 0'));
assert(url.includes("parsed.hash = ''"));
assert(shared.includes('files.length > 3'));
assert(submit.includes('review_url: reviewUrl'));
assert(submit.includes('AND ? BETWEEN 1 AND 3'));
assert(submit.includes('dedupKey: `review-evidence:${evidenceVersionId}`'));
assert(submit.includes('actorId: source.buyer_customer_id'));
assert(!submit.includes(
  'dedupKey: `review-evidence:${reviewCaseId}:${evidenceVersionNo}`',
));
assert(!submit.includes('actorId: `buyer:${source.buyer_customer_id}`'));
assert(buyer.includes('current_evidence_version_no'));
assert(seller.includes("review.status !== 'APPROVED'"));
assert(seller.includes("review_case.status='APPROVED'"));

const migrations = readdirSync(path.join(root, 'migrations'))
  .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
  .sort();
assert(migrations.includes('0022_review_submission_metadata.sql'));

console.log('phase3i review metadata verifier passed');

function read(file) {
  return readFileSync(path.join(root, file), 'utf8');
}
function assert(condition) {
  if (!condition) throw new Error('phase3i_review_metadata_verification_failed');
}