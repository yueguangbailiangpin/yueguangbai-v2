import type { CanonicalMarketplaceCode } from './customer';

export const CUSTOMER_SECURITY_HTTP_PATHS = Object.freeze({
  issueBuyerInvitation: '/api/staff/customer-security/buyer-invitations',
  readBuyerInvitation: '/api/staff/customer-security/buyer-invitations/:id',
  revokeBuyerInvitation: '/api/staff/customer-security/buyer-invitations/:id/revoke',
  issuePasswordReset: '/api/staff/customer-security/password-resets',
} as const);

export interface StaffIssueBuyerInvitationRequest {
  wechat_id: string;
  marketplace_code: CanonicalMarketplaceCode;
}

export interface StaffBuyerInvitationResult {
  invitation_id: string;
  registration_token: string;
  registration_path: string;
  wechat_id: string;
  marketplace_code: CanonicalMarketplaceCode;
  status: 'ACTIVE';
  version: number;
  expires_at: number;
  replayed: boolean;
}

export interface StaffBuyerInvitationView {
  invitation_id: string;
  wechat_id: string;
  marketplace_code: CanonicalMarketplaceCode;
  issued_by_staff_id: string;
  status: 'ACTIVE' | 'CONSUMED' | 'REVOKED' | 'EXPIRED';
  version: number;
  issued_at: number;
  expires_at: number;
  consumed_at: number | null;
  revoked_at: number | null;
}

export interface StaffRevokeSecurityTokenRequest {
  expected_version: number;
}

export interface StaffIssuePasswordResetRequest {
  wechat_id: string;
  manual_verification_confirmed: true;
  verification_note: string;
}

export interface StaffPasswordResetResult {
  reset_id: string;
  reset_token: string;
  reset_path: string;
  expires_at: number;
  replayed: boolean;
}
