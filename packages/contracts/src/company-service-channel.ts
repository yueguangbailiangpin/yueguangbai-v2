/**
 * Stage 7.5 batch 2: company public service channels for the buyer portal.
 * Independent of any staff login identity; seeded empty (no fabricated
 * contact data). Only the owner may modify the configuration.
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
  /** Optional QR file reference; null until a real QR object is linked. */
  qr_file_object_id: string | null;
  version: number;
  updated_at: number;
}

/** Buyer-safe projection: public fields only, never any staff identity. */
export interface BuyerServiceChannelDto {
  code: CompanyServiceChannelCode;
  display_name: string;
  wechat_id: string | null;
  qr_file_object_id: string | null;
}

export interface SetCompanyServiceChannelRequest {
  display_name: string;
  wechat_id: string | null;
  qr_file_object_id: string | null;
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
