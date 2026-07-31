import type {
  SqlDatabase,
} from '@ygb/contracts';
import {
  createCustomerSessionPayload,
  normalizeWechatId,
  signCustomerSession,
  verifyCustomerPassword,
  verifyCustomerSession,
  type CustomerSessionPayload,
  type PasswordCredential,
} from '@ygb/domain';

const DUMMY_CREDENTIAL: PasswordCredential = {
  algorithm: 'PBKDF2_SHA256',
  iterations: 10_000,
  saltBase64Url: 'AAAAAAAAAAAAAAAAAAAAAA',
  hashBase64Url: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
};

interface AuthenticationRow {
  account_id: string;
  identity_subject_id: string;
  account_type: 'BUYER' | 'SELLER_MEMBER';
  account_status: string;
  session_version: number;
  password_change_required: number;
  algorithm: 'PBKDF2_SHA256';
  iterations: number;
  salt_base64url: string;
  hash_base64url: string;
  buyer_status: string | null;
  seller_member_status: string | null;
  seller_organization_status: string | null;
}

export interface AuthenticatedCustomer {
  accountId: string;
  identitySubjectId: string;
  accountType: 'BUYER' | 'SELLER_MEMBER';
  sessionVersion: number;
  passwordChangeRequired: boolean;
}

export interface CustomerSessionContext
  extends AuthenticatedCustomer {
  issuedAt: number;
  expiresAt: number;
}

export async function authenticateCustomerPassword(
  database: SqlDatabase,
  input: {
    loginIdentifier: string;
    password: string;
  },
): Promise<AuthenticatedCustomer | null> {
  const identifier = normalizeIdentifier(input.loginIdentifier);
  const row = identifier
    ? await database.prepare(`
        SELECT
          account.id AS account_id,
          account.identity_subject_id,
          account.account_type,
          account.status AS account_status,
          account.session_version,
          account.password_change_required,
          credential.algorithm,
          credential.iterations,
          credential.salt_base64url,
          credential.hash_base64url,
          buyer.access_status AS buyer_status,
          member.status AS seller_member_status,
          organization.status AS seller_organization_status
        FROM customer_login_accounts account
        JOIN customer_password_credentials credential
          ON credential.account_id=account.id
        LEFT JOIN buyer_customers buyer
          ON buyer.identity_subject_id=account.identity_subject_id
          AND account.account_type='BUYER'
        LEFT JOIN seller_organization_members member
          ON member.identity_subject_id=account.identity_subject_id
          AND account.account_type='SELLER_MEMBER'
        LEFT JOIN seller_organizations organization
          ON organization.id=member.organization_id
        WHERE account.login_identifier_normalized=?
      `).bind(identifier).first<AuthenticationRow>()
    : null;

  const credential: PasswordCredential = row
    ? {
        algorithm: row.algorithm,
        iterations: Number(row.iterations),
        saltBase64Url: row.salt_base64url,
        hashBase64Url: row.hash_base64url,
      }
    : DUMMY_CREDENTIAL;

  const validPassword = await verifyCustomerPassword(
    input.password,
    credential,
  );
  if (!row || !validPassword || !isRowActive(row)) return null;

  return {
    accountId: row.account_id,
    identitySubjectId: row.identity_subject_id,
    accountType: row.account_type,
    sessionVersion: Number(row.session_version),
    passwordChangeRequired:
      Number(row.password_change_required) === 1,
  };
}

export async function issueCustomerSession(
  authenticated: AuthenticatedCustomer,
  secret: string,
  options: {
    now?: number | undefined;
    ttlMs?: number | undefined;
  } = {},
): Promise<string> {
  return signCustomerSession(
    createCustomerSessionPayload({
      accountId: authenticated.accountId,
      identitySubjectId: authenticated.identitySubjectId,
      accountType: authenticated.accountType,
      sessionVersion: authenticated.sessionVersion,
      now: options.now,
      ttlMs: options.ttlMs,
    }),
    secret,
  );
}

export async function resolveCustomerSession(
  database: SqlDatabase,
  token: string,
  secret: string,
  now = Date.now(),
): Promise<CustomerSessionContext | null> {
  const payload = await verifyCustomerSession(
    token,
    secret,
    now,
  );
  if (!payload) return null;

  const row = await database.prepare(`
    SELECT
      account.id AS account_id,
      account.identity_subject_id,
      account.account_type,
      account.status AS account_status,
      account.session_version,
      account.password_change_required,
      buyer.access_status AS buyer_status,
      member.status AS seller_member_status,
      organization.status AS seller_organization_status
    FROM customer_login_accounts account
    LEFT JOIN buyer_customers buyer
      ON buyer.identity_subject_id=account.identity_subject_id
      AND account.account_type='BUYER'
    LEFT JOIN seller_organization_members member
      ON member.identity_subject_id=account.identity_subject_id
      AND account.account_type='SELLER_MEMBER'
    LEFT JOIN seller_organizations organization
      ON organization.id=member.organization_id
    WHERE account.id=?
      AND account.identity_subject_id=?
      AND account.account_type=?
  `).bind(
    payload.account_id,
    payload.identity_subject_id,
    payload.account_type,
  ).first<AuthenticationRow>();

  if (!row
    || !isRowActive(row)
    || Number(row.session_version) !== payload.session_version) {
    return null;
  }

  return {
    accountId: row.account_id,
    identitySubjectId: row.identity_subject_id,
    accountType: row.account_type,
    sessionVersion: Number(row.session_version),
    passwordChangeRequired:
      Number(row.password_change_required) === 1,
    issuedAt: payload.issued_at,
    expiresAt: payload.expires_at,
  };
}

function normalizeIdentifier(value: string): string | null {
  try {
    return normalizeWechatId(value).normalized;
  } catch {
    return null;
  }
}

function isRowActive(row: AuthenticationRow): boolean {
  if (row.account_status !== 'ACTIVE') return false;
  if (row.account_type === 'BUYER') {
    return row.buyer_status === 'ACTIVE';
  }
  return row.seller_member_status === 'ACTIVE'
    && row.seller_organization_status === 'ACTIVE';
}
