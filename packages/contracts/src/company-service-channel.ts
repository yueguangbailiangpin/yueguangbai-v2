import type { SafeFileReferenceDto } from './file-http';

/**
 * Stage 7.5 batch 2 + 7.5R: company public service channels for the buyer
 * portal. Independent of any staff login identity; seeded empty (no
 * fabricated contact data). Only the owner may modify the configuration.
 *
 * 7.5R: the QR travels through the controlled file chain — the owner uploads
 * it via the purpose-bound staff upload route and attaches it to the channel
 * entity; the buyer DTO exposes only a SafeFileReference (never a bare
 * internal object id) that resolves through the buyer read-intent route.
 */

export const COMPANY_SERVICE_CHANNEL_CODES = [
  'BUYER_PRE_SALES',
  'BUYER_AFTER_SALES',
] as const;
export type CompanyServiceChannelCode = typeof COMPANY_SERVICE_CHANNEL_CODES[number];

export interface CompanyServiceChannelDto {
  code: CompanyServiceChannelCode;
  display_name: string;
  /** Empty (null) until the owner configures a real public WeChat id. */
  wechat_id: string | null;
  /** Controlled QR reference; null until an owner attaches a verified file. */
  qr_file: SafeFileReferenceDto | null;
  version: number;
  updated_at: number;
}

/** Buyer-safe projection: public fields only, never any staff identity. */
export interface BuyerServiceChannelDto {
  code: CompanyServiceChannelCode;
  display_name: string;
  wechat_id: string | null;
  qr_file: SafeFileReferenceDto | null;
}

export interface SetCompanyServiceChannelRequest {
  display_name: string;
  wechat_id: string | null;
  expected_version: number;
  reason: string;
}

/** Attach (or clear, with a null file id) the channel QR file. */
export interface AttachServiceChannelQrRequest {
  file_object_id: string | null;
  expected_file_version: number;
  expected_version: number;
  reason: string;
}

export interface CompanyServiceChannelMutationDto {
  channel: CompanyServiceChannelDto;
  replayed: boolean;
}

export function isCompanyServiceChannelCode(
  value: unknown,
): value is CompanyServiceChannelCode {
  return typeof value === 'string'
    && (COMPANY_SERVICE_CHANNEL_CODES as readonly string[]).includes(value);
}
