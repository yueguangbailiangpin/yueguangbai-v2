export const CUSTOMER_SESSION_COOKIE_NAME =
  '__Host-ygb_customer_session';
export const CUSTOMER_SESSION_COOKIE_PATH = '/';
export const CUSTOMER_SESSION_TTL_MS =
  7 * 24 * 60 * 60 * 1000;
export const CUSTOMER_SESSION_MAX_AGE_SECONDS =
  CUSTOMER_SESSION_TTL_MS / 1000;

const MIN_SECRET_BYTES = 32;

export interface CustomerAuthRuntimeBindings {
  CUSTOMER_SESSION_SECRET: string;
}

export function requireCustomerSessionSecret(
  value: unknown,
): string {
  if (typeof value !== 'string'
    || new TextEncoder().encode(value).byteLength < MIN_SECRET_BYTES) {
    throw new CustomerHttpAuthConfigurationError();
  }
  return value;
}

export class CustomerHttpAuthConfigurationError extends Error {
  constructor() {
    super('customer_http_auth_configuration_invalid');
    this.name = 'CustomerHttpAuthConfigurationError';
  }
}
