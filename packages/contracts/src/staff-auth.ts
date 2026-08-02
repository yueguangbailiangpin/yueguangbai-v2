import type {
  StaffDataScope,
} from './staff-assignment';
import type {
  StaffPermissionCode,
  StaffRoleCode,
} from './staff';

export const STAFF_AUTH_PROVIDER = 'FEISHU' as const;
export type StaffAuthProvider = typeof STAFF_AUTH_PROVIDER;

export const STAFF_LOGIN_STATE_TTL_MS = 10 * 60 * 1000;
export const STAFF_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const STAFF_SESSION_MAX_AGE_SECONDS = 43_200;
export const STAFF_SESSION_COOKIE_NAME = '__Host-ygb_staff_session';
export const STAFF_SESSION_COOKIE_PATH = '/';
export const STAFF_SESSION_TOKEN_BYTES = 32;

export const STAFF_AUTH_PATHS = Object.freeze({
  loginStart: '/api/staff-auth/login/start',
  feishuCallback: '/api/staff-auth/feishu/callback',
  session: '/api/staff-auth/session',
  logout: '/api/staff-auth/logout',
  logoutAll: '/api/staff-auth/logout-all',
} as const);

export interface StaffAuthProviderBindings {
  STAFF_AUTH_PROVIDER?: StaffAuthProvider;
  STAFF_AUTH_FEISHU_AUTHORIZATION_ENDPOINT?: string;
  STAFF_AUTH_FEISHU_TOKEN_ENDPOINT?: string;
  STAFF_AUTH_FEISHU_IDENTITY_ENDPOINT?: string;
  STAFF_AUTH_FEISHU_APP_ID?: string;
  STAFF_AUTH_FEISHU_APP_SECRET?: string;
  STAFF_AUTH_FEISHU_SCOPE?: string;
  STAFF_AUTH_FEISHU_TENANT_KEY?: string;
  STAFF_AUTH_FEISHU_REDIRECT_URI?: string;
  STAFF_AUTH_ALLOWED_ORIGINS?: string;
  STAFF_AUTH_ALLOWED_RETURN_TO?: string;
  STAFF_AUTH_HASH_SECRET?: string;
}

export interface StaffLoginStartRequest {
  return_to?: string;
}

export interface StaffLoginStartResponse {
  provider: StaffAuthProvider;
  authorization_url: string;
  expires_at: number;
}

export interface StaffFeishuCallbackQuery {
  code: string;
  state: string;
}

export interface VerifiedStaffProviderIdentity {
  provider: StaffAuthProvider;
  tenantKey: string;
  openId: string;
  userId: string | null;
}

export interface StaffAuthProviderAdapter {
  createAuthorizationUrl(input: {
    state: string;
    redirectUri: string;
    scope: string;
  }): string;
  exchangeAuthorizationCode(input: {
    code: string;
    redirectUri: string;
    signal: AbortSignal;
  }): Promise<VerifiedStaffProviderIdentity>;
}

export interface StaffSessionSafeDto {
  staff_id: string;
  display_name: string;
  roles: readonly StaffRoleCode[];
  permissions: readonly StaffPermissionCode[];
  data_scope: StaffDataScope;
  authorization_version: number;
  session_version: number;
  expires_at: number;
}

export interface StaffLogoutResponse {
  logged_out: true;
  all_devices_logged_out: false;
}

export interface StaffLogoutAllResponse {
  logged_out: true;
  all_devices_logged_out: true;
  session_version: number;
}

export const STAFF_AUTH_PUBLIC_ERROR_CODES = [
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'VALIDATION_ERROR',
  'STATE_CONFLICT',
  'VERSION_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'REQUEST_IN_PROGRESS',
  'DEPENDENCY_UNAVAILABLE',
  'RATE_LIMITED',
] as const;
export type StaffAuthPublicErrorCode =
  typeof STAFF_AUTH_PUBLIC_ERROR_CODES[number];
