import type {
  BuyerReviewDetailDto,
  BuyerReviewPageDto,
  BuyerReviewSummaryDto,
  SqlDatabase,
} from '@ygb/contracts';
import type { BuyerPortalContext } from '../buyer-portal/buyer-context';
import { BuyerReviewPortalError } from './errors';

interface CurrentEvidenceRow {
  review_case_id: string;
  review_url: string | null;
  submitted_at: number;
}

export async function attachBuyerReviewUrl<T extends BuyerReviewSummaryDto>(
  database: SqlDatabase,
  buyer: BuyerPortalContext,
  review: T,
): Promise<T> {
  const row = await database.prepare(`
    SELECT
      review_case.id AS review_case_id,
      evidence.review_url,
      evidence.created_at AS submitted_at
    FROM review_cases review_case
    JOIN review_evidence_versions evidence
      ON evidence.review_case_id=review_case.id
      AND evidence.formal_order_id=review_case.formal_order_id
      AND evidence.version_no=review_case.current_evidence_version_no
      AND evidence.submitted_by_buyer_id=review_case.buyer_customer_id
    WHERE review_case.id=? AND review_case.buyer_customer_id=?
    LIMIT 1
  `).bind(
    review.review_case_id,
    buyer.buyerCustomerId,
  ).first<CurrentEvidenceRow>();
  if (!row) throw new BuyerReviewPortalError('NOT_FOUND', 404);
  return Object.freeze({
    ...review,
    review_url: row.review_url,
    submitted_at: Number(row.submitted_at),
  });
}

export async function attachBuyerReviewPageUrls(
  database: SqlDatabase,
  buyer: BuyerPortalContext,
  page: BuyerReviewPageDto<BuyerReviewSummaryDto>,
): Promise<BuyerReviewPageDto<BuyerReviewSummaryDto>> {
  return Object.freeze({
    ...page,
    items: Object.freeze(await Promise.all(
      page.items.map((item) => attachBuyerReviewUrl(database, buyer, item)),
    )),
  });
}

export async function attachBuyerReviewDetailUrl(
  database: SqlDatabase,
  buyer: BuyerPortalContext,
  review: BuyerReviewDetailDto,
): Promise<BuyerReviewDetailDto> {
  return attachBuyerReviewUrl(database, buyer, review);
}