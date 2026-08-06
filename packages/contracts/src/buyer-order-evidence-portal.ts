import type { DemandTaskType } from './demand';
import type {
  FileObjectStatus,
  SupportedFileMime,
} from './file-storage';
import type { OrderEvidenceStatus } from './order-evidence';

export const BUYER_ORDER_EVIDENCE_ACTIONS = [
  'SUBMIT',
  'RESUBMIT',
  'WITHDRAW',
] as const;

export type BuyerOrderEvidenceAction =
  typeof BUYER_ORDER_EVIDENCE_ACTIONS[number];

export const BUYER_ORDER_EVIDENCE_FILE_ACTIONS = [
  'CREATE_READ_INTENT',
] as const;

export type BuyerOrderEvidenceFileAction =
  typeof BUYER_ORDER_EVIDENCE_FILE_ACTIONS[number];

export interface BuyerOrderEvidenceReservationDto {
  reservation_id: string;
  demand_id: string;
  marketplace_code: 'JP';
  product_name: string;
  store_display_name: string;
  review_type: DemandTaskType;
  order_deadline: number;
}

export interface BuyerOrderEvidenceEligibleReservationDto
extends BuyerOrderEvidenceReservationDto {
  current_order_evidence_status: OrderEvidenceStatus | null;
  current_order_evidence_version: number | null;
  allowed_actions: readonly BuyerOrderEvidenceAction[];
}

interface BuyerOrderEvidenceFileBaseDto {
  file_object_id: string;
  client_file_name: string;
  mime: SupportedFileMime;
  byte_size: number;
  status: FileObjectStatus;
  visibility: 'INTERNAL_ONLY' | 'BUYER_VISIBLE';
  verified_at: number | null;
}

export interface BuyerOrderEvidenceReadableFileDto
extends BuyerOrderEvidenceFileBaseDto {
  file_entity_link_id: string;
  version: number;
  allowed_actions: readonly ['CREATE_READ_INTENT'];
}

export interface BuyerOrderEvidenceMetadataFileDto
extends BuyerOrderEvidenceFileBaseDto {
  file_entity_link_id: null;
  version: null;
  allowed_actions: readonly [];
}

export type BuyerOrderEvidenceFileDto =
  | BuyerOrderEvidenceReadableFileDto
  | BuyerOrderEvidenceMetadataFileDto;

export interface BuyerOrderEvidenceDto {
  submission_id: string;
  reservation: BuyerOrderEvidenceReservationDto;
  marketplace: 'JP';
  amazon_order_number_display: string;
  amazon_order_date: string | null;
  final_paid_jpy: number;
  buyer_self_pay_bps: number;
  buyer_self_pay_jpy: number;
  buyer_refundable_principal_jpy: number;
  price_mismatch: boolean;
  price_difference_jpy: number;
  status: OrderEvidenceStatus;
  version: number;
  evidence_version_no: number;
  submitted_at: number;
  updated_at: number;
  verified_at: number | null;
  public_change_reason: string | null;
  files: readonly BuyerOrderEvidenceFileDto[];
  allowed_actions: readonly BuyerOrderEvidenceAction[];
}

export interface BuyerOrderEvidencePageDto<T> {
  items: readonly T[];
  next_cursor: string | null;
}

export interface SubmitBuyerOrderEvidenceRequest {
  reservation_id: string;
  expected_version: 0;
  amazon_order_number: string;
  amazon_order_date: string;
  final_paid_jpy: number;
  file_object_ids: readonly string[];
  buyer_note?: string | null;
}

export interface ResubmitBuyerOrderEvidenceRequest {
  expected_version: number;
  amazon_order_number: string;
  amazon_order_date: string;
  final_paid_jpy: number;
  file_object_ids: readonly string[];
  buyer_note?: string | null;
}

export interface WithdrawBuyerOrderEvidenceRequest {
  expected_version: number;
}

export interface BuyerOrderEvidenceMutationDto {
  order_evidence: BuyerOrderEvidenceDto;
  replayed: boolean;
}

export interface CreateBuyerOrderEvidenceFileReadIntentRequest {
  expected_file_version: number;
}

export interface BuyerOrderEvidenceFileReadIntentDto {
  read_intent_id: string;
  file_object_id: string;
  access_token: string | null;
  access_token_available: boolean;
  expires_at: number;
  replayed: boolean;
}
