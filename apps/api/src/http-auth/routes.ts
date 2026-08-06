import { apiSuccess } from '@ygb/contracts';
import type { Context, Hono } from 'hono';
import {
  authenticateCustomerPassword,
  issueCustomerSession,
  selectCustomerPersona,
} from '../customer-auth/authenticate-customer';
import { changeCustomerPassword } from '../customer-auth/change-password';
import {
  customerSessionMiddleware,
  requireCustomerSessionFromContext,
} from '../middleware/customer-auth';
import { customerAuthOriginGuard } from '../middleware/origin-guard';
import {
  clearCustomerSessionCookie,
  writeCustomerSessionCookie,
} from './cookies';
import {
  CUSTOMER_SESSION_TTL_MS,
  requireCustomerSessionSecret,
} from './config';
import {
  CustomerHttpAuthError,
  customerHttpAuthFailure,
  normalizeCustomerHttpAuthError,
  requestIdFromContext,
} from './errors';
import { consumeCustomerLoginRateLimit } from './rate-limit';
import { recordCustomerAuthSecurityEvent } from './security-events';

export function registerCustomerAuthRoutes(
  app: Hono<any>,
): void {
  app.post(
    '/api/customer-auth/login',
    customerAuthOriginGuard(),
    withCustomerHttpAuthErrors(login),
  );
  app.post(
    '/api/customer-auth/change-password',
    customerAuthOriginGuard(),
    customerSessionMiddleware({
      allowPasswordChangeRequired: true,
    }),
    withCustomerHttpAuthErrors(changePassword),
  );
  app.post(
    '/api/customer-auth/logout',
    customerAuthOriginGuard(),
    customerSessionMiddleware({
      required: false,
      allowPasswordChangeRequired: true,
    }),
    withCustomerHttpAuthErrors(logout),
  );
  app.get(
    '/api/customer-auth/session',
    customerSessionMiddleware({
      allowPasswordChangeRequired: true,
    }),
    withCustomerHttpAuthErrors(session),
  );
  app.post(
    '/api/customer-auth/select-persona',
    customerAuthOriginGuard(),
    customerSessionMiddleware({ allowPasswordChangeRequired: true }),
    withCustomerHttpAuthErrors(selectPersona),
  );
}

async function login(context: Context<any>): Promise<Response> {
  const now = Date.now();
  const requestId = requestIdFromContext(context);
  const secret = requireCustomerSessionSecret(
    context.env.CUSTOMER_SESSION_SECRET,
  );
  const body = await readLoginBody(context);
  const rateLimit = await consumeCustomerLoginRateLimit(
    context.env.DB,
    {
      loginIdentifier: body.loginIdentifier,
      networkSource:
        context.req.header('CF-Connecting-IP') ?? null,
      secret,
      now,
    },
  );

  if (rateLimit.limited) {
    await recordCustomerAuthSecurityEvent(context.env.DB, {
      eventType: 'LOGIN_RATE_LIMITED',
      outcome: 'BLOCKED',
      loginIdentifierHash: rateLimit.identifierHash,
      networkSourceHash: rateLimit.networkSourceHash,
      requestId,
      createdAt: now,
    });
    throw new CustomerHttpAuthError(
      'RATE_LIMITED',
      429,
      rateLimit.retryAfterSeconds,
    );
  }

  const authenticated = await authenticateCustomerPassword(
    context.env.DB,
    {
      loginIdentifier: body.loginIdentifier,
      password: body.password,
      ...(body.persona ? { persona: body.persona } : {}),
    },
  );
  if (!authenticated) {
    await recordCustomerAuthSecurityEvent(context.env.DB, {
      eventType: 'LOGIN_FAILED',
      outcome: 'FAILURE',
      loginIdentifierHash: rateLimit.identifierHash,
      networkSourceHash: rateLimit.networkSourceHash,
      requestId,
      createdAt: now,
    });
    throw new CustomerHttpAuthError(
      'INVALID_CREDENTIALS',
      401,
    );
  }

  const token = await issueCustomerSession(
    authenticated,
    secret,
    {
      now,
      ttlMs: CUSTOMER_SESSION_TTL_MS,
    },
  );
  await recordCustomerAuthSecurityEvent(context.env.DB, {
    eventType: 'LOGIN_SUCCEEDED',
    outcome: 'SUCCESS',
    accountId: authenticated.accountId,
    loginIdentifierHash: rateLimit.identifierHash,
    networkSourceHash: rateLimit.networkSourceHash,
    requestId,
    createdAt: now,
  });
  writeCustomerSessionCookie(context, token);
  context.header('Cache-Control', 'no-store');
  return context.json(apiSuccess({
    session: toHttpSession({
      ...authenticated,
      issuedAt: now,
      expiresAt: now + CUSTOMER_SESSION_TTL_MS,
    }),
  }, requestId));
}

async function changePassword(context: Context<any>): Promise<Response> {
  const sessionContext = requireCustomerSessionFromContext(context);
  const body = await readPasswordChangeBody(context);
  const idempotencyKey = context.req.header('Idempotency-Key');
  if (!idempotencyKey
    || idempotencyKey.length < 8
    || idempotencyKey.length > 128
    || /[\u0000-\u001f\u007f]/u.test(idempotencyKey)) {
    throw new CustomerHttpAuthError(
      'VALIDATION_ERROR',
      400,
    );
  }

  const now = Date.now();
  const requestId = requestIdFromContext(context);
  const result = await changeCustomerPassword(
    context.env.DB,
    {
      accountId: sessionContext.accountId,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
    },
    {
      idempotencyKey,
      requestId,
      now,
    },
  );
  const authenticated = {
    accountId: sessionContext.accountId,
    identitySubjectId: sessionContext.identitySubjectId,
    accountType: sessionContext.accountType,
    availablePersonas: sessionContext.availablePersonas,
    sessionVersion: result.session_version,
    passwordChangeRequired: false,
  } as const;
  const secret = requireCustomerSessionSecret(
    context.env.CUSTOMER_SESSION_SECRET,
  );
  const token = await issueCustomerSession(
    authenticated,
    secret,
    {
      now,
      ttlMs: CUSTOMER_SESSION_TTL_MS,
    },
  );
  await recordCustomerAuthSecurityEvent(context.env.DB, {
    eventType: 'PASSWORD_CHANGED',
    outcome: 'SUCCESS',
    accountId: authenticated.accountId,
    requestId,
    createdAt: now,
  });
  writeCustomerSessionCookie(context, token);
  context.header('Cache-Control', 'no-store');
  return context.json(apiSuccess({
    session: toHttpSession({
      ...authenticated,
      issuedAt: now,
      expiresAt: now + CUSTOMER_SESSION_TTL_MS,
    }),
  }, requestId));
}

async function selectPersona(context: Context<any>): Promise<Response> {
  const current = requireCustomerSessionFromContext(context);
  const body = await readPersonaBody(context);
  const authenticated = await selectCustomerPersona(
    context.env.DB,
    current,
    body.persona,
  );
  if (!authenticated) throw new CustomerHttpAuthError('FORBIDDEN', 403);
  const now = Date.now();
  const secret = requireCustomerSessionSecret(context.env.CUSTOMER_SESSION_SECRET);
  const token = await issueCustomerSession(authenticated, secret, {
    now,
    ttlMs: CUSTOMER_SESSION_TTL_MS,
  });
  writeCustomerSessionCookie(context, token);
  context.header('Cache-Control', 'no-store');
  return context.json(apiSuccess({
    session: toHttpSession({
      ...authenticated,
      issuedAt: now,
      expiresAt: now + CUSTOMER_SESSION_TTL_MS,
    }),
  }, requestIdFromContext(context)));
}

async function logout(context: Context<any>): Promise<Response> {
  const requestId = requestIdFromContext(context);
  const current = context.get('customerSession') as
    | { accountId: string }
    | null
    | undefined;
  clearCustomerSessionCookie(context);
  if (current) {
    await recordCustomerAuthSecurityEvent(context.env.DB, {
      eventType: 'LOGOUT',
      outcome: 'SUCCESS',
      accountId: current.accountId,
      requestId,
      createdAt: Date.now(),
    });
  }
  context.header('Cache-Control', 'no-store');
  return context.json(apiSuccess({
    logged_out: true as const,
    all_devices_logged_out: false as const,
  }, requestId));
}

async function session(context: Context<any>): Promise<Response> {
  const current = requireCustomerSessionFromContext(context);
  const requestId = requestIdFromContext(context);
  context.header('Cache-Control', 'no-store');
  return context.json(apiSuccess({
    session: toHttpSession(current),
  }, requestId));
}

function withCustomerHttpAuthErrors(
  handler: (context: Context<any>) => Promise<Response>,
) {
  return async (context: Context<any>): Promise<Response> => {
    try {
      return await handler(context);
    } catch (error) {
      return customerHttpAuthFailure(
        context,
        normalizeCustomerHttpAuthError(error),
      );
    }
  };
}

async function readLoginBody(
  context: Context<any>,
): Promise<{
  loginIdentifier: string;
  password: string;
  persona: 'BUYER' | 'SELLER_MEMBER' | null;
}> {
  let body: unknown;
  try {
    body = await context.req.json();
  } catch {
    return { loginIdentifier: '', password: '', persona: null };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { loginIdentifier: '', password: '', persona: null };
  }
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => ![
    'login_identifier', 'password', 'persona',
  ].includes(key))) {
    return { loginIdentifier: '', password: '', persona: null };
  }
  const persona = record['persona'];
  return {
    loginIdentifier:
      typeof record?.['login_identifier'] === 'string'
        ? record['login_identifier'].slice(0, 500)
        : '',
    password:
      typeof record?.['password'] === 'string'
        ? record['password'].slice(0, 500)
        : '',
    persona: persona === 'BUYER' || persona === 'SELLER_MEMBER'
      ? persona
      : null,
  };
}

async function readPersonaBody(context: Context<any>): Promise<{
  persona: 'BUYER' | 'SELLER_MEMBER';
}> {
  let body: unknown;
  try { body = await context.req.json(); } catch { body = null; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new CustomerHttpAuthError('VALIDATION_ERROR', 400);
  }
  const record = body as Record<string, unknown>;
  if (Object.keys(record).length !== 1
    || (record['persona'] !== 'BUYER'
      && record['persona'] !== 'SELLER_MEMBER')) {
    throw new CustomerHttpAuthError('VALIDATION_ERROR', 400);
  }
  return { persona: record['persona'] };
}

async function readPasswordChangeBody(
  context: Context<any>,
): Promise<{
  currentPassword: string;
  newPassword: string;
}> {
  let body: unknown;
  try {
    body = await context.req.json();
  } catch {
    throw new CustomerHttpAuthError(
      'VALIDATION_ERROR',
      400,
    );
  }
  const record = body as Record<string, unknown>;
  if (typeof record?.['current_password'] !== 'string'
    || typeof record?.['new_password'] !== 'string') {
    throw new CustomerHttpAuthError(
      'VALIDATION_ERROR',
      400,
    );
  }
  return {
    currentPassword: record['current_password'],
    newPassword: record['new_password'],
  };
}

function toHttpSession(input: {
  accountId: string;
  identitySubjectId: string;
  accountType: 'BUYER' | 'SELLER_MEMBER';
  availablePersonas?: readonly ('BUYER' | 'SELLER_MEMBER')[];
  sessionVersion: number;
  passwordChangeRequired: boolean;
  issuedAt: number;
  expiresAt: number;
}): HttpSessionData {
  return {
    account_id: input.accountId,
    identity_subject_id: input.identitySubjectId,
    account_type: input.accountType,
    available_personas: input.availablePersonas ?? [input.accountType],
    session_version: input.sessionVersion,
    password_change_required: input.passwordChangeRequired,
    issued_at: input.issuedAt,
    expires_at: input.expiresAt,
  };
}

interface HttpSessionData {
  account_id: string;
  identity_subject_id: string;
  account_type: 'BUYER' | 'SELLER_MEMBER';
  available_personas: readonly ('BUYER' | 'SELLER_MEMBER')[];
  session_version: number;
  password_change_required: boolean;
  issued_at: number;
  expires_at: number;
}
