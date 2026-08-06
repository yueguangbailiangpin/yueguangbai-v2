export const CUSTOMER_AUTH_HTTP_PATHS = Object.freeze({
  login: '/api/customer-auth/login',
  changePassword: '/api/customer-auth/change-password',
  logout: '/api/customer-auth/logout',
  session: '/api/customer-auth/session',
  selectPersona: '/api/customer-auth/select-persona',
  completePasswordReset: '/api/customer-auth/password-reset/complete',
} as const);

export type CustomerHttpAccountType = 'BUYER' | 'SELLER_MEMBER';
export type CustomerPersona = CustomerHttpAccountType;

export interface CustomerHttpSession {
  account_id: string;
  identity_subject_id: string;
  account_type: CustomerHttpAccountType;
  available_personas?: readonly CustomerPersona[];
  session_version: number;
  password_change_required: boolean;
  issued_at: number;
  expires_at: number;
}

export interface CustomerLoginRequest {
  login_identifier: string;
  password: string;
  persona: CustomerPersona;
}

export interface CustomerLoginResponse {
  session: CustomerHttpSession;
}

export interface CustomerChangePasswordRequest {
  current_password: string;
  new_password: string;
}

export interface CustomerChangePasswordResponse {
  session: CustomerHttpSession;
}

export interface CustomerLogoutResponse {
  logged_out: true;
  all_devices_logged_out: false;
}

export interface CustomerSessionResponse {
  session: CustomerHttpSession;
}

export interface CustomerSelectPersonaRequest {
  persona: CustomerPersona;
}

export interface CustomerSelectPersonaResponse {
  session: CustomerHttpSession;
}

export interface CustomerCompletePasswordResetRequest {
  token: string;
  new_password: string;
  password_confirmation: string;
}

export interface CustomerCompletePasswordResetResponse {
  password_reset: true;
  all_previous_sessions_revoked: true;
  next_path: '/customer/login';
}
