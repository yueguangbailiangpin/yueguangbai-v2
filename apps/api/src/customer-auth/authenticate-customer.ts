import type { CustomerPersona, SqlDatabase } from '@ygb/contracts';
import {
  createCustomerSessionPayload,
  CUSTOMER_PASSWORD_DEFAULT_ITERATIONS,
  normalizeWechatId,
  signCustomerSession,
  verifyCustomerPassword,
  verifyCustomerSession,
  type PasswordCredential,
} from '@ygb/domain';

const DUMMY_CREDENTIAL: PasswordCredential = {
  algorithm: 'PBKDF2_SHA256',
  iterations: CUSTOMER_PASSWORD_DEFAULT_ITERATIONS,
  saltBase64Url: 'AAAAAAAAAAAAAAAAAAAAAA',
  hashBase64Url: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
};

interface AuthenticationRow {
  account_id: string;
  identity_subject_id: string;
  account_status: string;
  session_version: number;
  password_change_required: number;
  algorithm: 'PBKDF2_SHA256';
  iterations: number;
  salt_base64url: string;
  hash_base64url: string;
}

export interface AuthenticatedCustomer {
  accountId: string;
  identitySubjectId: string;
  accountType: CustomerPersona;
  availablePersonas?: readonly CustomerPersona[];
  sessionVersion: number;
  passwordChangeRequired: boolean;
}

export interface CustomerSessionContext extends AuthenticatedCustomer {
  availablePersonas: readonly CustomerPersona[];
  issuedAt: number;
  expiresAt: number;
}

export async function authenticateCustomerPassword(
  database: SqlDatabase,
  input: {
    loginIdentifier: string;
    password: string;
    persona?: CustomerPersona;
  },
): Promise<AuthenticatedCustomer | null> {
  const identifier = normalizeIdentifier(input.loginIdentifier);
  const row = identifier
    ? await database.prepare(`
        SELECT
          account.id AS account_id,
          account.identity_subject_id,
          account.status AS account_status,
          account.session_version,
          account.password_change_required,
          credential.algorithm,
          credential.iterations,
          credential.salt_base64url,
          credential.hash_base64url
        FROM customer_login_accounts account
        JOIN customer_password_credentials credential
          ON credential.account_id=account.id
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
  const validPassword = await verifyCustomerPassword(input.password, credential);
  if (!row || !validPassword || row.account_status !== 'ACTIVE') return null;

  const availablePersonas = await loadActivePersonas(database, row.account_id);
  const accountType = input.persona ?? availablePersonas[0];
  if (!accountType || !availablePersonas.includes(accountType)) return null;

  return {
    accountId: row.account_id,
    identitySubjectId: row.identity_subject_id,
    accountType,
    availablePersonas,
    sessionVersion: Number(row.session_version),
    passwordChangeRequired: Number(row.password_change_required) === 1,
  };
}

export async function issueCustomerSession(
  authenticated: AuthenticatedCustomer,
  secret: string,
  options: { now?: number; ttlMs?: number } = {},
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
  const payload = await verifyCustomerSession(token, secret, now);
  if (!payload) return null;

  const row = await database.prepare(`
    SELECT id AS account_id, identity_subject_id,
      status AS account_status, session_version, password_change_required
    FROM customer_login_accounts
    WHERE id=? AND identity_subject_id=?
  `).bind(
    payload.account_id,
    payload.identity_subject_id,
  ).first<AuthenticationRow>();
  if (!row || row.account_status !== 'ACTIVE'
    || Number(row.session_version) !== payload.session_version) return null;

  const availablePersonas = await loadActivePersonas(database, row.account_id);
  if (!availablePersonas.includes(payload.account_type)) return null;

  return {
    accountId: row.account_id,
    identitySubjectId: row.identity_subject_id,
    accountType: payload.account_type,
    availablePersonas,
    sessionVersion: Number(row.session_version),
    passwordChangeRequired: Number(row.password_change_required) === 1,
    issuedAt: payload.issued_at,
    expiresAt: payload.expires_at,
  };
}

export async function selectCustomerPersona(
  database: SqlDatabase,
  current: CustomerSessionContext,
  persona: CustomerPersona,
): Promise<AuthenticatedCustomer | null> {
  const availablePersonas = await loadActivePersonas(database, current.accountId);
  if (!availablePersonas.includes(persona)) return null;
  return {
    accountId: current.accountId,
    identitySubjectId: current.identitySubjectId,
    accountType: persona,
    availablePersonas,
    sessionVersion: current.sessionVersion,
    passwordChangeRequired: current.passwordChangeRequired,
  };
}

async function loadActivePersonas(
  database: SqlDatabase,
  accountId: string,
): Promise<CustomerPersona[]> {
  const rows = await database.prepare(`
    SELECT persona.persona_type
    FROM customer_account_personas persona
    LEFT JOIN buyer_customers buyer
      ON buyer.id=persona.buyer_customer_id
    LEFT JOIN seller_organization_members member
      ON member.id=persona.seller_member_id
    LEFT JOIN seller_organizations organization
      ON organization.id=member.organization_id
    WHERE persona.account_id=?
      AND (
        (persona.persona_type='BUYER' AND buyer.access_status='ACTIVE')
        OR
        (persona.persona_type='SELLER_MEMBER' AND member.status='ACTIVE'
          AND organization.status='ACTIVE')
      )
    ORDER BY CASE persona.persona_type WHEN 'BUYER' THEN 1 ELSE 2 END
  `).bind(accountId).all<{ persona_type: CustomerPersona }>();
  return rows.results.map((row) => row.persona_type);
}

function normalizeIdentifier(value: string): string | null {
  try {
    return normalizeWechatId(value).normalized;
  } catch {
    return null;
  }
}
