import type {
  SellerReviewPortalDto,
  SellerReviewPortalPage,
  SqlDatabase,
} from '@ygb/contracts';
import type { SellerPortalActor } from '../seller-portal/actor';
import { SellerReviewPortalError } from './errors';

interface UrlRow { review_url: string | null }

export async function attachSellerReviewUrl(
  database: SqlDatabase,
  actor: SellerPortalActor,
  review: SellerReviewPortalDto,
): Promise<SellerReviewPortalDto> {
  if (review.status !== 'APPROVED') {
    return Object.freeze({ ...review, review_url: null });
  }
  const scope = actor.allActiveStores
    ? { sql: '', values: [] as readonly string[] }
    : actor.storeIds.length === 0
      ? { sql: 'AND 1=0', values: [] as readonly string[] }
      : {
          sql: `AND formal_order.store_id IN (${actor.storeIds.map(() => '?').join(', ')})`,
          values: actor.storeIds,
        };
  const row = await database.prepare(`
    SELECT evidence.review_url
    FROM review_cases review_case
    JOIN formal_orders formal_order
      ON formal_order.id=review_case.formal_order_id
      AND formal_order.seller_organization_id=review_case.seller_organization_id
    JOIN review_evidence_versions evidence
      ON evidence.review_case_id=review_case.id
      AND evidence.formal_order_id=formal_order.id
      AND evidence.version_no=review_case.current_evidence_version_no
    WHERE review_case.id=?
      AND review_case.status='APPROVED'
      AND review_case.seller_organization_id=?
      ${scope.sql}
    LIMIT 1
  `).bind(
    review.review_case_id,
    actor.sellerOrganizationId,
    ...scope.values,
  ).first<UrlRow>();
  if (!row) {
    throw new SellerReviewPortalError('SELLER_REVIEW_NOT_FOUND', 404);
  }
  return Object.freeze({ ...review, review_url: row.review_url });
}

export async function attachSellerReviewPageUrls(
  database: SqlDatabase,
  actor: SellerPortalActor,
  page: SellerReviewPortalPage,
): Promise<SellerReviewPortalPage> {
  return Object.freeze({
    ...page,
    items: Object.freeze(await Promise.all(
      page.items.map((item) => attachSellerReviewUrl(database, actor, item)),
    )),
  });
}