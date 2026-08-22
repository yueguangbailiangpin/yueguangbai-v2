import type { buyerApi } from '../api/client';

export type BuyerTask = Readonly<{
  id: string;
  title: string;
  detail: string;
  href: string;
  kind: 'urgent' | 'action' | 'system';
}>;

type ReservationItem = Awaited<ReturnType<typeof buyerApi.reservations>>['data']['items'][number];
type EligibleEvidenceItem = Awaited<ReturnType<typeof buyerApi.evidenceEligible>>['data']['items'][number];
type EvidenceItem = Awaited<ReturnType<typeof buyerApi.evidenceList>>['data']['items'][number];
type EligibleReviewItem = Awaited<ReturnType<typeof buyerApi.reviewEligible>>['data']['items'][number];
type ReviewItem = Awaited<ReturnType<typeof buyerApi.reviews>>['data']['items'][number];
type RefundItem = Awaited<ReturnType<typeof buyerApi.refunds>>['data']['items'][number];

export type BuyerTaskSources = Readonly<{
  reservations: readonly (Pick<ReservationItem, 'reservation_id' | 'status'> & {
    demand: Pick<ReservationItem['demand'], 'product_name'>;
  })[];
  eligibleEvidence: readonly Pick<EligibleEvidenceItem, 'reservation_id' | 'product_name' | 'review_type' | 'allowed_actions'>[];
  evidence: readonly (Pick<EvidenceItem, 'submission_id' | 'status' | 'public_change_reason'> & {
    reservation: Pick<EvidenceItem['reservation'], 'product_name'>;
  })[];
  eligibleReviews: readonly (Pick<EligibleReviewItem, 'allowed_actions'> & {
    order: Pick<EligibleReviewItem['order'], 'formal_order_id' | 'product_name' | 'review_type'>;
  })[];
  reviews: readonly (Pick<ReviewItem, 'review_case_id' | 'status' | 'public_change_reason'> & {
    order: Pick<ReviewItem['order'], 'product_name'>;
  })[];
  refunds: readonly (Pick<RefundItem, 'refund_obligation_id' | 'status'> & {
    order: Pick<RefundItem['order'], 'product_name'>;
  })[];
}>;

export type BuyerTaskGroups = Readonly<{
  urgent: readonly BuyerTask[];
  action: readonly BuyerTask[];
  system: readonly BuyerTask[];
  actionableCount: number;
}>;

export function classifyBuyerTasks(sources: BuyerTaskSources, reviewTypeLabel: (value: string) => string): BuyerTaskGroups {
  const urgent: BuyerTask[] = [
    ...sources.evidence.filter((item) => item.status === 'CHANGES_REQUESTED').map((item) => ({
      id: `evidence-change-${item.submission_id}`,
      title: '修改订单资料',
      detail: `${item.reservation.product_name}${item.public_change_reason ? ` · ${item.public_change_reason}` : ''}`,
      href: `/buyer/order-materials/${encodeURIComponent(item.submission_id)}`,
      kind: 'urgent' as const,
    })),
    ...sources.reviews.filter((item) => item.status === 'CHANGES_REQUESTED').map((item) => ({
      id: `review-change-${item.review_case_id}`,
      title: '修改评论资料',
      detail: `${item.order.product_name}${item.public_change_reason ? ` · ${item.public_change_reason}` : ''}`,
      href: `/buyer/reviews/${encodeURIComponent(item.review_case_id)}`,
      kind: 'urgent' as const,
    })),
  ];

  const action: BuyerTask[] = [
    ...sources.eligibleEvidence.filter((item) => item.allowed_actions.includes('SUBMIT')).map((item) => ({
      id: `instruction-${item.reservation_id}`,
      title: '查看下单指引',
      detail: `${item.product_name} · ${reviewTypeLabel(item.review_type)}`,
      href: `/buyer/reservations/${encodeURIComponent(item.reservation_id)}/instruction`,
      kind: 'action' as const,
    })),
    ...sources.eligibleReviews.filter((item) => item.allowed_actions.includes('SUBMIT')).map((item) => ({
      id: `review-submit-${item.order.formal_order_id}`,
      title: '提交评论资料',
      detail: `${item.order.product_name} · ${reviewTypeLabel(item.order.review_type)}`,
      href: `/buyer/reviews/new?formal_order_id=${encodeURIComponent(item.order.formal_order_id)}`,
      kind: 'action' as const,
    })),
  ];

  const system: BuyerTask[] = [
    ...sources.reservations.filter((item) => item.status === 'PENDING_REVIEW').map((item) => ({
      id: `reservation-pending-${item.reservation_id}`,
      title: '预约审核中', detail: item.demand.product_name,
      href: `/buyer/reservations/${encodeURIComponent(item.reservation_id)}`,
      kind: 'system' as const,
    })),
    ...sources.evidence.filter((item) => item.status === 'PENDING_VERIFICATION').map((item) => ({
      id: `evidence-pending-${item.submission_id}`,
      title: '订单资料审核中', detail: item.reservation.product_name,
      href: `/buyer/order-materials/${encodeURIComponent(item.submission_id)}`,
      kind: 'system' as const,
    })),
    ...sources.reviews.filter((item) => item.status === 'PENDING_REVIEW').map((item) => ({
      id: `review-pending-${item.review_case_id}`,
      title: '评论审核中', detail: item.order.product_name,
      href: `/buyer/reviews/${encodeURIComponent(item.review_case_id)}`,
      kind: 'system' as const,
    })),
    ...sources.refunds.filter((item) => item.status === 'DUE' || item.status === 'PARTIALLY_PAID').map((item) => ({
      id: `refund-pending-${item.refund_obligation_id}`,
      title: '返款处理中', detail: item.order.product_name,
      href: `/buyer/refunds/${encodeURIComponent(item.refund_obligation_id)}`,
      kind: 'system' as const,
    })),
  ];

  return { urgent, action, system, actionableCount: urgent.length + action.length };
}
