import type { MarketplaceCode } from './customer';
import type {
  FixedIntegerString,
  PricingReviewType,
} from './pricing';
import type {
  BuyerRefundPaymentChannel,
  BuyerRefundStatus,
} from './buyer-refund';

export const BUYER_REFUND_PORTAL_DEFAULT_PAGE_SIZE = 20 as const;
export const BUYER_REFUND_PORTAL_MAX_PAGE_SIZE = 100 as const;

export type BuyerRefundPortalActivityType =
  | 'PAYMENT_RECORDED'
  | 'PAYMENT_REVERSED';

export interface BuyerRefundPortalOrderSummaryDto {
  formal_order_id: string;
  marketplace: MarketplaceCode;
  amazon_order_number: string;
  product_name: string;
  review_type: PricingReviewType;
  status: 'CONFIRMED';
}

export interface BuyerRefundPortalBalanceDto {
  due_amount_cny_fen: FixedIntegerString;
  net_paid_cny_fen: FixedIntegerString;
  remaining_amount_cny_fen: FixedIntegerString;
  overpaid_amount_cny_fen: FixedIntegerString;
  status: BuyerRefundStatus;
}

export interface BuyerRefundPortalSummaryDto
extends BuyerRefundPortalBalanceDto {
  refund_obligation_id: string;
  order: BuyerRefundPortalOrderSummaryDto;
  allowed_actions: readonly [];
}

export interface BuyerRefundPortalActivityDto {
  activity_id: string;
  activity_type: BuyerRefundPortalActivityType;
  amount_cny_fen: FixedIntegerString;
  occurred_at: number;
  payment_channel: BuyerRefundPaymentChannel;
  balance_after: BuyerRefundPortalBalanceDto;
}

export interface BuyerRefundPortalDetailDto
extends BuyerRefundPortalSummaryDto {
  activities: readonly BuyerRefundPortalActivityDto[];
}

export interface BuyerRefundPortalPageDto {
  items: readonly BuyerRefundPortalSummaryDto[];
  next_cursor: string | null;
}
