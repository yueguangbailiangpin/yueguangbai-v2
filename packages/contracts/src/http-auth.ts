export const CUSTOMER_AUTH_HTTP_PATHS = Object.freeze({
  login: '/api/customer-auth/login',
  changePassword: '/api/customer-auth/change-password',
  logout: '/api/customer-auth/logout',
  session: '/api/customer-auth/session',
} as const);

export type CustomerHttpAccountType = 'BUYER' | 'SELLER_MEMBER';

export interface CustomerHttpSession {
  account_id: string;
  identity_subject_id: string;
  account_type: CustomerHttpAccountType;
  session_version: number;
  password_change_required: boolean;
  issued_at: number;
  expires_at: number;
}

export interface CustomerLoginRequest {
  login_identifier: string;
  password: string;
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
