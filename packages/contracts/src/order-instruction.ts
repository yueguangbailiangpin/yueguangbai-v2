import type { FixedIntegerString } from './pricing';

export const ORDER_INSTRUCTION_STATUSES = [
  'UNPUBLISHED',
  'ACTIVE',
  'EXPIRED',
  'CANCELLED',
  'COMPLETED',
] as const;
export type OrderInstructionStatus =
  typeof ORDER_INSTRUCTION_STATUSES[number];

export const ORDER_INSTRUCTION_ASSET_BATCH_STATUSES = [
  'PREPARING',
  'READY',
  'FAILED',
  'CONSUMED',
  'CANCELLED',
] as const;
export type OrderInstructionAssetBatchStatus =
  typeof ORDER_INSTRUCTION_ASSET_BATCH_STATUSES[number];

export const ORDER_INSTRUCTION_ASSET_ITEM_STATUSES = [
  'PREPARING',
  'READY',
  'FAILED',
  'ORPHANED',
  'CONSUMED',
] as const;
export type OrderInstructionAssetItemStatus =
  typeof ORDER_INSTRUCTION_ASSET_ITEM_STATUSES[number];

export const BUYER_SELF_PAY_SOURCES = [
  'PRODUCT_DEFAULT',
  'STAFF_OVERRIDE',
] as const;
export type BuyerSelfPaySource =
  typeof BUYER_SELF_PAY_SOURCES[number];

export const ORDER_INSTRUCTION_EVENT_TYPES = [
  'INSTRUCTION_CREATED',
  'ASSET_PREPARATION_STARTED',
  'ASSET_PREPARATION_READY',
  'ASSET_PREPARATION_FAILED',
  'INSTRUCTION_PUBLISHED',
  'INSTRUCTION_REPUBLISHED',
  'EVIDENCE_CHANGES_REQUESTED',
  'EVIDENCE_RESUBMITTED',
  'INSTRUCTION_EXPIRED',
  'INSTRUCTION_CANCELLED',
  'INSTRUCTION_COMPLETED',
  'INSTRUCTION_RECONCILED',
] as const;
export type OrderInstructionEventType =
  typeof ORDER_INSTRUCTION_EVENT_TYPES[number];

export type OrderInstructionColorSpecMode =
  | 'MAIN_IMAGE_VARIANT'
  | 'ANY_VARIANT';

export interface BuyerSelfPayEstimateDto {
  reference_order_amount_jpy: FixedIntegerString;
  buyer_self_pay_bps: number;
  estimated_buyer_self_pay_jpy: FixedIntegerString;
  estimated_refundable_principal_jpy: FixedIntegerString;
}

export interface BuyerInstructionImageHandleDto {
  image_id: string;
  position: number | null;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number | null;
  height: number | null;
  read_intent_path: string;
}

export interface BuyerOrderInstructionDto
extends BuyerSelfPayEstimateDto {
  status: OrderInstructionStatus;
  product_name: string;
  store_display_name: string;
  search_keywords: readonly string[];
  color_spec_mode: OrderInstructionColorSpecMode;
  staff_public_note: string | null;
  buyer_visible_notes: string | null;
  initial_deadline_at: number | null;
  resubmission_deadline_at: number | null;
  content_updated: boolean;
  main_image: BuyerInstructionImageHandleDto;
  keyword_images: readonly BuyerInstructionImageHandleDto[];
}

export interface BuyerOrderInstructionStateDto {
  status: OrderInstructionStatus;
  instruction_version: number;
  current_version_no: number;
  initial_deadline_at: number | null;
  resubmission_deadline_at: number | null;
  evidence_status:
    | 'NONE'
    | 'PENDING_VERIFICATION'
    | 'CHANGES_REQUESTED'
    | 'VERIFIED'
    | 'WITHDRAWN'
    | 'CONSUMED';
  can_submit_evidence: boolean;
  can_read_images: boolean;
  content_updated: boolean;
}

export interface BuyerInstructionReadIntentDto {
  read_intent_id: string;
  access_token: string | null;
  access_token_available: boolean;
  expires_at: number;
}

export interface StaffOrderInstructionSummaryDto {
  instruction_id: string;
  reservation_id: string;
  buyer_customer_id: string;
  marketplace_code: 'JP';
  status: OrderInstructionStatus;
  current_version_no: number;
  version: number;
  published_at: number | null;
  initial_deadline_at: number | null;
  resubmission_deadline_at: number | null;
  expired_at: number | null;
  cancelled_at: number | null;
  completed_at: number | null;
}

export interface StaffOrderInstructionVersionDto
extends BuyerSelfPayEstimateDto {
  instruction_version_id: string;
  instruction_id: string;
  version_no: number;
  reservation_id: string;
  product_id: string;
  product_version_id: string;
  product_version_no: number;
  main_image_file_entity_link_id: string;
  store_display_name_snapshot: string;
  demand_buyer_visible_notes_snapshot: string | null;
  staff_public_note: string | null;
  color_spec_mode: OrderInstructionColorSpecMode;
  content_hash: string;
  generator_version: string;
  published_by_staff_id: string;
  published_at: number;
  initial_deadline_at: number;
  created_at: number;
}

export interface KeywordImageGenerationInput {
  keywordText: string;
  position: number;
  renderProfile: string;
  idempotencyDigest: string;
}

export interface KeywordImageMetadataScanResult {
  clean: boolean;
  forbiddenChunkTypes: readonly string[];
}

export interface KeywordImageGenerationOutput {
  pngBytes: Uint8Array<ArrayBuffer>;
  mime: 'image/png';
  width: number;
  height: number;
  sha256: string;
  generatorVersion: string;
  metadataScanResult: KeywordImageMetadataScanResult;
}

export interface KeywordImageGenerator {
  generate(
    input: KeywordImageGenerationInput,
  ): Promise<KeywordImageGenerationOutput>;
}

export function isOrderInstructionStatus(
  value: unknown,
): value is OrderInstructionStatus {
  return typeof value === 'string'
    && (ORDER_INSTRUCTION_STATUSES as readonly string[]).includes(value);
}

export function isBuyerSelfPaySource(
  value: unknown,
): value is BuyerSelfPaySource {
  return typeof value === 'string'
    && (BUYER_SELF_PAY_SOURCES as readonly string[]).includes(value);
}
