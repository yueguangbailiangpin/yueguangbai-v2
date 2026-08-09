import type { BuyerSupportedMarketplaceCode } from './customer';

export const BUYER_SELF_REGISTRATION_HTTP_PATHS = Object.freeze({
  register: '/api/buyer-auth/register',
  invitationContext: '/api/buyer-auth/invitations/:token',
});

export interface BuyerSelfRegistrationRequest {
  wechat_id: string;
  invitation_token: string;
  marketplace_code: BuyerSupportedMarketplaceCode;
  password: string;
  password_confirmation: string;
  human_verification_token?: string;
}

export interface BuyerSelfRegistrationIdentity {
  buyer_number: string | null;
  wechat_id: string;
}

export interface BuyerInvitationContextResponse {
  invitation_valid: true;
  marketplace_code: BuyerSupportedMarketplaceCode;
  marketplace_name: string;
  wechat_hint: string;
  expires_at: number;
}

export interface BuyerSelfRegistrationResponse {
  identity: BuyerSelfRegistrationIdentity;
  session_established: true;
  must_change_password: false;
  next_path: '/buyer';
}

export const BUYER_SELF_REGISTRATION_SOURCES = [
  'SELF_REGISTRATION_NEW',
  'SELF_REGISTRATION_CLAIM',
] as const;

export type BuyerSelfRegistrationSource =
  typeof BUYER_SELF_REGISTRATION_SOURCES[number];
