import type {
  ApiErrorCode,
  ApiFailure,
  ApiSuccess,
  CustomerHttpSession,
  CustomerLogoutResponse,
  CustomerSessionResponse,
  StaffLogoutAllResponse,
  StaffLogoutResponse,
  StaffSessionSafeDto,
} from '@ygb/contracts';

export const buyerSessionFixture = Object.freeze({
  account_id: 'buyer-account-1',
  identity_subject_id: 'buyer-subject-1',
  account_type: 'BUYER',
  session_version: 1,
  password_change_required: false,
  issued_at: 1_700_000_000_000,
  expires_at: 1_700_086_400_000,
} satisfies CustomerHttpSession);

export const sellerSessionFixture = Object.freeze({
  account_id: 'seller-account-1',
  identity_subject_id: 'seller-subject-1',
  account_type: 'SELLER_MEMBER',
  session_version: 3,
  password_change_required: false,
  issued_at: 1_700_000_000_000,
  expires_at: 1_700_086_400_000,
} satisfies CustomerHttpSession);

export const staffSessionFixture = Object.freeze({
  staff_id: 'staff-1',
  display_name: '测试员工',
  role: { code: 'owner', display_name: '总管理员' },
  permissions: [],
  data_scope: {
    type: 'GLOBAL',
    marketplaceCodes: [],
    buyerCustomerIds: [],
    sellerOrganizationIds: [],
    teamIds: [],
  },
  authorization_version: 2,
  session_version: 4,
  expires_at: 1_700_043_200_000,
} satisfies StaffSessionSafeDto);

export function customerSessionEnvelopeFixture(
  session: CustomerHttpSession,
  requestId: string,
): ApiSuccess<CustomerSessionResponse> {
  return { data: { session }, meta: { request_id: requestId } };
}

export function staffSessionEnvelopeFixture(
  session: StaffSessionSafeDto,
  requestId: string,
): ApiSuccess<{ session: StaffSessionSafeDto }> {
  return { data: { session }, meta: { request_id: requestId } };
}

export function customerLogoutEnvelopeFixture(
  requestId: string,
): ApiSuccess<CustomerLogoutResponse> {
  return {
    data: { logged_out: true, all_devices_logged_out: false },
    meta: { request_id: requestId },
  };
}

export function staffLogoutEnvelopeFixture(
  requestId: string,
): ApiSuccess<StaffLogoutResponse> {
  return {
    data: { logged_out: true, all_devices_logged_out: false },
    meta: { request_id: requestId },
  };
}

export function staffLogoutAllEnvelopeFixture(
  response: StaffLogoutAllResponse,
  requestId: string,
): ApiSuccess<StaffLogoutAllResponse> {
  return { data: response, meta: { request_id: requestId } };
}

export function failureEnvelopeFixture(
  code: ApiErrorCode,
  message: string,
  details: unknown | null,
  requestId: string,
): ApiFailure {
  return {
    error: { code, message, details },
    meta: { request_id: requestId },
  };
}

export const malformedFixtures = Object.freeze({
  flatCustomerSession: Object.freeze({
    data: buyerSessionFixture,
    meta: { request_id: 'malformed-flat-customer' },
  }),
  flatStaffSession: Object.freeze({
    data: staffSessionFixture,
    meta: { request_id: 'malformed-flat-staff' },
  }),
  successWithoutMeta: Object.freeze({ data: { ok: true } }),
  failureWithoutDetails: Object.freeze({
    error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'unavailable' },
    meta: { request_id: 'malformed-failure' },
  }),
});
