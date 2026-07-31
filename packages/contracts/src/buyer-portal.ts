import type { DemandTaskType } from './demand';
import type { ReservationStatus } from './reservation';

export interface BuyerPortalMeDto {
  buyer: {
    customer_number: string | null;
    display_name: string;
    marketplace_code: 'JP';
    identity_review_status: 'CLEAR' | 'REVIEW_REQUIRED';
  };
  session: {
    expires_at: number;
  };
}

export interface BuyerPortalDemandDto {
  demand_id: string;
  marketplace_code: 'JP';
  asin: string;
  product_name: string;
  search_keywords: readonly string[];
  product_url: string | null;
  buyer_visible_notes: string | null;
  store_display_name: string;
  task_type: DemandTaskType;
  target_quantity: number;
  remaining_quantity: number;
  open_at: number;
  reservation_deadline: number;
  order_deadline: number;
}

export interface BuyerPortalReservationDemandDto {
  demand_id: string;
  marketplace_code: 'JP';
  asin: string;
  product_name: string;
  search_keywords: readonly string[];
  product_url: string | null;
  buyer_visible_notes: string | null;
  store_display_name: string;
  task_type: DemandTaskType;
  reservation_deadline: number;
  order_deadline: number;
}

export interface BuyerPortalReservationDto {
  reservation_id: string;
  status: ReservationStatus;
  version: number;
  submitted_at: number;
  updated_at: number;
  hold_expires_at: number;
  order_deadline_snapshot: number;
  decided_at: number | null;
  cancelled_at: number | null;
  expired_at: number | null;
  can_cancel: boolean;
  demand: BuyerPortalReservationDemandDto;
}

export interface BuyerPortalPageDto<T> {
  items: readonly T[];
  next_cursor: string | null;
}

export interface BuyerPortalReservationMutationDto {
  reservation: BuyerPortalReservationDto;
  replayed: boolean;
}
