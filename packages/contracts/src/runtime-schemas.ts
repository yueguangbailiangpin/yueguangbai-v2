import { z } from 'zod';
import type { BuyerServiceChannelDto } from './company-service-channel';
import { COMPANY_SERVICE_CHANNEL_CODES } from './company-service-channel';
import type { SafeFileReferenceDto } from './file-http';
import { FILE_PURPOSES, FILE_VISIBILITIES } from './file-storage';
import type {
  SellerPortalSettlementBatchDetailDto,
  SellerPortalSettlementBatchDto,
  SellerPortalSettlementBatchMemberDto,
  SellerPortalSettlementBatchPageDto,
} from './seller-settlement-batch';

/**
 * Stage 7.5R-2: single authoritative runtime contracts for the customer
 * portals. The backend return DTO interfaces above stay the type-level
 * contract; these strict Zod schemas are the runtime contract that the
 * backend request-level tests and the production frontend pages both parse
 * real responses with. `satisfies z.ZodType<Dto>` pins every schema to its
 * DTO: an extra or missing field fails at runtime and the type check fails
 * at compile time when either side drifts. Passthrough parsing is
 * deliberately absent — unknown fields must be rejected, never tolerated.
 */

const fixedIntegerString = z.string().regex(/^(?:0|[1-9][0-9]*)$/u);
const epochMillis = z.number().int().nonnegative();

/**
 * Runtime contract for the controlled file reference (never a bare object
 * key). The object id charset matches the file read controller guard that
 * already protects every real portal file read: opaque server-generated
 * ids only — no separators, whitespace or control characters.
 */
export const safeFileReferenceSchema = z.object({
  file_object_id: z.string().min(1).max(120)
    .regex(/^[A-Za-z0-9._~-]+$/u),
  file_version: z.number().int().positive(),
  purpose: z.enum(FILE_PURPOSES),
  visibility: z.enum(FILE_VISIBILITIES),
}).strict() satisfies z.ZodType<SafeFileReferenceDto>;

// ---------------------------------------------------------------------------
// Buyer portal: public service channels (Stage 7.5 batch 2 + 7.5R QR chain)
// ---------------------------------------------------------------------------

export const buyerServiceChannelSchema = z.object({
  code: z.enum(COMPANY_SERVICE_CHANNEL_CODES),
  display_name: z.string().min(1).max(200),
  wechat_id: z.string().max(200).nullable(),
  qr_file: safeFileReferenceSchema.nullable(),
}).strict() satisfies z.ZodType<BuyerServiceChannelDto>;

export const buyerServiceChannelsResponseSchema = z.object({
  channels: z.array(buyerServiceChannelSchema),
}).strict();

// ---------------------------------------------------------------------------
// Seller portal: read-only settlement batches (Stage 7.5 batch 3 + 7.5R)
// ---------------------------------------------------------------------------

export const sellerPortalSettlementBatchSchema = z.object({
  batch_id: z.string().min(1).max(200),
  status: z.enum(['CONFIRMED', 'PARTIALLY_PAID', 'PAID']),
  frozen_total_cny_fen: fixedIntegerString,
  frozen_payable_count: z.number().int().nonnegative(),
  paid_amount_cny_fen: fixedIntegerString,
  outstanding_amount_cny_fen: fixedIntegerString,
  confirmed_at: epochMillis,
}).strict() satisfies z.ZodType<SellerPortalSettlementBatchDto>;

export const sellerPortalSettlementBatchMemberSchema = z.object({
  amazon_order_number: z.string().min(1).max(200),
  payable_type: z.enum(['SELLER_PRINCIPAL', 'SELLER_SERVICE_FEE']),
  frozen_amount_cny_fen: fixedIntegerString,
  paid_amount_cny_fen: fixedIntegerString,
  outstanding_amount_cny_fen: fixedIntegerString,
}).strict() satisfies z.ZodType<SellerPortalSettlementBatchMemberDto>;

export const sellerPortalSettlementBatchDetailSchema =
  sellerPortalSettlementBatchSchema.extend({
    members: z.array(sellerPortalSettlementBatchMemberSchema),
    members_next_cursor: z.string().min(1).nullable(),
  }).strict() satisfies z.ZodType<SellerPortalSettlementBatchDetailDto>;

/** The detail endpoint wraps the batch: `{ data: { batch: ... } }`. */
export const sellerPortalSettlementBatchDetailResponseSchema = z.object({
  batch: sellerPortalSettlementBatchDetailSchema,
}).strict();

export const sellerPortalSettlementBatchPageSchema = z.object({
  batches: z.array(sellerPortalSettlementBatchSchema),
  next_cursor: z.string().min(1).nullable(),
}).strict() satisfies z.ZodType<SellerPortalSettlementBatchPageDto>;
