import {
  apiSuccess,
  STAFF_LOGIN_STATE_TTL_MS,
  STAFF_SESSION_TTL_MS,
  type StaffAuthProviderAdapter,
  type StaffLoginStartRequest,
  type StaffLogoutAllResponse,
  type StaffLogoutResponse,
} from '@ygb/contracts';
import { hashCanonicalJson } from '@ygb/domain';
import type { Context, Hono } from 'hono';
import { configuredAlertSink } from '../app';
import {
  acquireIdempotency,
  type IdempotencyError,
} from '../foundation/idempotency';
import {
  resolveAssignmentStaffAuthorization,
  resolveStaffDataScope,
} from '../staff-assignment';
import {
  clearStaffSessionCookie,
  readStaffSessionCookie,
  writeStaffSessionCookie,
} from './cookies';
import { cleanupExpiredStaffAuthEphemeralRecords } from './cleanup';
import {
  generateStaffOpaqueToken,
  hashStaffOpaqueToken,
} from './crypto';
import {
  normalizeStaffAuthError,
  requestIdFromContext,
  StaffAuthError,
  staffAuthFailure,
} from './errors';
import { logoutAllStaffSessions } from './logout-all';
import { readCommittedLogoutAllReplay } from './logout-all-replay';
import {
  FeishuStaffAuthProvider,
  requireStaffAuthConfig,
  type StaffAuthRuntimeConfig,
  withStaffProviderTimeout,
} from './provider';
import {
  consumeStaffAuthRateLimit,
  consumeStaffLoginState,
  createInternalStaffSession,
  issueStaffLoginState,
  projectStaffSession,
  recordStaffAuthSecurityEvent,
  resolveVerifiedStaffIdentity,
  revokeStaffSession,
} from './repository';
import { resolveTrustedStaffSession } from './session';

export interface RegisterStaffAuthRoutesOptions {
  providerFactory?: (
    config: StaffAuthRuntimeConfig,
    context: Context<any>,
  ) => StaffAuthProviderAdapter;
}

export function registerStaffAuthRoutes(
  app: Hono<any>,
  options: RegisterStaffAuthRoutesOptions = {},
): void {
  app.post('/api/staff-auth/login/start', withStaffAuthErrors(
    (context) => loginStart(context, options),
  ));
  app.get('/api/staff-auth/feishu/callback', withStaffAuthErrors(
    (context) => callback(context, options),
  ));
  app.get('/api/staff-auth/session', withStaffAuthErrors(session));
  app.post('/api/staff-auth/logout', withStaffAuthErrors(logout));
  app.post('/api/staff-auth/logout-all', withStaffAuthErrors(logoutAll));
}

async function loginStart(
  context: Context<any>,
  options: RegisterStaffAuthRoutesOptions,
): Promise<Response> {
  const config = requireStaffAuthConfig(context.env);
  const origin = requireAllowedOrigin(context, config);
  const body = await readExactJsonObject<StaffLoginStartRequest>(
    context,
    new Set(['return_to']),
    true,
  );
  const returnTo = body.return_to === undefined
    ? [...config.allowedReturnTo][0]
    : cleanReturnTo(body.return_to, config);
  if (!returnTo) throw new StaffAuthError('VALIDATION_ERROR', 400);
  const now = Date.now();
  await cleanupExpiredStaffAuthEphemeralRecords(context.env.DB, now);
  const requestId = requestIdFromContext(context);
  const networkSource = networkSourceFromContext(context);
  const rate = await consumeStaffAuthRateLimit(context.env.DB, {
    action: 'LOGIN_START',
    scopeType: 'NETWORK',
    scopeValue: networkSource ?? 'unknown',
    config,
    now,
  });
  if (rate.limited) {
    await recordStaffAuthSecurityEvent(context.env.DB, {
      eventType: 'LOGIN_RATE_LIMITED',
      outcome: 'BLOCKED',
      config,
      networkSource,
      tenantKey: config.tenantKey,
      requestId,
      metadata: { action: 'LOGIN_START' },
      alertSink: configuredAlertSink(context.env),
      createdAt: now,
    });
    throw new StaffAuthError('RATE_LIMITED', 429, {
      retry_after_seconds: rate.retryAfterSeconds,
    });
  }
  const state = generateStaffOpaqueToken();
  const stateHash = await hashStaffOpaqueToken(state);
  const expiresAt = now + STAFF_LOGIN_STATE_TTL_MS;
  await issueStaffLoginState(context.env.DB, {
    stateHash,
    returnTo,
    origin,
    networkSource,
    requestId,
    config,
    now,
    expiresAt,
  });
  const provider = providerFor(context, config, options);
  const authorizationUrl = provider.createAuthorizationUrl({
    state,
    redirectUri: config.redirectUri,
    scope: config.scope,
  });
  context.header('Cache-Control', 'no-store');
  return context.json(apiSuccess({
    provider: 'FEISHU' as const,
    authorization_url: authorizationUrl,
    expires_at: expiresAt,
  }, requestId));
}

async function callback(
  context: Context<any>,
  options: RegisterStaffAuthRoutesOptions,
): Promise<Response> {
  const config = requireStaffAuthConfig(context.env);
  const query = readExactCallbackQuery(context);
  const now = Date.now();
  await cleanupExpiredStaffAuthEphemeralRecords(context.env.DB, now);
  const requestId = requestIdFromContext(context);
  const networkSource = networkSourceFromContext(context);
  const rate = await consumeStaffAuthRateLimit(context.env.DB, {
    action: 'LOGIN_CALLBACK',
    scopeType: 'NETWORK_TENANT',
    scopeValue: `${networkSource ?? 'unknown'}\u0000${config.tenantKey}`,
    config,
    now,
  });
  if (rate.limited) {
    await recordStaffAuthSecurityEvent(context.env.DB, {
      eventType: 'LOGIN_RATE_LIMITED',
      outcome: 'BLOCKED',
      config,
      networkSource,
      tenantKey: config.tenantKey,
      requestId,
      metadata: { action: 'LOGIN_CALLBACK' },
      alertSink: configuredAlertSink(context.env),
      createdAt: now,
    });
    throw new StaffAuthError('RATE_LIMITED', 429, {
      retry_after_seconds: rate.retryAfterSeconds,
    });
  }

  let loginState;
  try {
    loginState = await consumeStaffLoginState(context.env.DB, {
      stateHash: await hashStaffOpaqueToken(query.state),
      expectedTenantKey: config.tenantKey,
      now,
    });
  } catch (error) {
    const normalized = normalizeStaffAuthError(error);
    const reason = readReason(normalized.details);
    await recordStaffAuthSecurityEvent(context.env.DB, {
      eventType: reason === 'EXPIRED'
        ? 'STATE_EXPIRED'
        : reason === 'REPLAYED'
          ? 'STATE_REPLAYED'
          : 'STATE_INVALID',
      outcome: 'REJECTED',
      config,
      networkSource,
      tenantKey: config.tenantKey,
      requestId,
      metadata: { callback_purpose: 'STAFF_LOGIN' },
      alertSink: configuredAlertSink(context.env),
      createdAt: now,
    });
    throw normalized;
  }

  const provider = providerFor(context, config, options);
  let verifiedIdentity;
  try {
    verifiedIdentity = await withStaffProviderTimeout((signal) =>
      provider.exchangeAuthorizationCode({
        code: query.code,
        redirectUri: config.redirectUri,
        signal,
      }));
  } catch {
    await recordStaffAuthSecurityEvent(context.env.DB, {
      eventType: 'PROVIDER_FAILURE',
      outcome: 'FAILURE',
      config,
      networkSource,
      tenantKey: config.tenantKey,
      requestId,
      metadata: { provider: 'FEISHU' },
      alertSink: configuredAlertSink(context.env),
      createdAt: now,
    });
    throw new StaffAuthError('DEPENDENCY_UNAVAILABLE', 503);
  }

  let identity;
  try {
    identity = await resolveVerifiedStaffIdentity(context.env.DB, {
      tenantKey: verifiedIdentity.tenantKey,
      openId: verifiedIdentity.openId,
      userId: verifiedIdentity.userId,
    });
  } catch (error) {
    const normalized = normalizeStaffAuthError(error);
    const reason = readReason(normalized.details);
    await recordStaffAuthSecurityEvent(context.env.DB, {
      eventType: reason === 'IDENTITY_CONFLICT'
        ? 'IDENTITY_CONFLICT'
        : reason === 'INACTIVE_IDENTITY'
          ? 'IDENTITY_INACTIVE'
          : 'IDENTITY_UNKNOWN',
      outcome: 'REJECTED',
      config,
      networkSource,
      tenantKey: verifiedIdentity.tenantKey,
      subject: verifiedIdentity.openId,
      requestId,
      metadata: { user_id_present: verifiedIdentity.userId !== null },
      alertSink: configuredAlertSink(context.env),
      createdAt: now,
    });
    throw normalized;
  }

  const authorization = await resolveAssignmentStaffAuthorization(
    context.env.DB,
    identity.staff_id,
  );
  if (!authorization
    || authorization.authorizationVersion !== identity.authorization_version) {
    throw new StaffAuthError('UNAUTHENTICATED', 401, {
      reason: 'AUTHORIZATION_UNAVAILABLE',
    });
  }

  const existingCookie = readStaffSessionCookie(context);
  if (existingCookie.value) {
    const existing = await resolveTrustedStaffSession(
      context.env.DB,
      existingCookie.value,
      now,
    ).catch(() => null);
    if (existing) {
      await revokeStaffSession(context.env.DB, {
        session: existing.session,
        reason: 'SESSION_REPLACED',
        requestId,
        now,
      });
    }
  }
  clearStaffSessionCookie(context);
  const sessionToken = generateStaffOpaqueToken();
  await createInternalStaffSession(context.env.DB, {
    token: sessionToken,
    identity,
    requestId,
    now,
    expiresAt: now + STAFF_SESSION_TTL_MS,
  });
  writeStaffSessionCookie(context, sessionToken);
  context.header('Cache-Control', 'no-store');
  return context.redirect(loginState.return_to, 303);
}

async function session(context: Context<any>): Promise<Response> {
  const config = requireStaffAuthConfig(context.env);
  const trusted = await requireTrustedSession(context, config);
  const dataScope = await resolveStaffDataScope(
    context.env.DB,
    trusted.authorization,
  );
  context.header('Cache-Control', 'no-store');
  return context.json(apiSuccess({
    session: projectStaffSession(
      trusted.authorization,
      dataScope,
      trusted.session,
    ),
  }, requestIdFromContext(context)));
}

async function logout(context: Context<any>): Promise<Response> {
  const config = requireStaffAuthConfig(context.env);
  requireAllowedOrigin(context, config);
  const cookie = readStaffSessionCookie(context);
  clearStaffSessionCookie(context);
  if (cookie.malformed) {
    await recordStaffAuthSecurityEvent(context.env.DB, {
      eventType: 'COOKIE_REJECTED',
      outcome: 'REJECTED',
      config,
      networkSource: networkSourceFromContext(context),
      requestId: requestIdFromContext(context),
      alertSink: configuredAlertSink(context.env),
      createdAt: Date.now(),
    });
  } else if (cookie.value) {
    const sessionRow = await resolveTrustedStaffSession(
      context.env.DB,
      cookie.value,
    ).then((value) => value.session).catch(() => null);
    if (sessionRow) {
      await revokeStaffSession(context.env.DB, {
        session: sessionRow,
        reason: 'LOGOUT',
        requestId: requestIdFromContext(context),
        now: Date.now(),
      });
    }
  }
  context.header('Cache-Control', 'no-store');
  const response: StaffLogoutResponse = {
    logged_out: true,
    all_devices_logged_out: false,
  };
  return context.json(apiSuccess(response, requestIdFromContext(context)));
}

async function logoutAll(context: Context<any>): Promise<Response> {
  const config = requireStaffAuthConfig(context.env);
  requireAllowedOrigin(context, config);
  await readExactJsonObject(context, new Set(), true);
  const idempotencyKey = requireIdempotencyKey(context);
  const cookie = readStaffSessionCookie(context);

  if (cookie.value && !cookie.malformed) {
    const replay = await readCommittedLogoutAllReplay(context.env.DB, {
      sessionToken: cookie.value,
      idempotencyKey,
    });
    if (replay) {
      clearStaffSessionCookie(context);
      context.header('Cache-Control', 'no-store');
      return context.json(apiSuccess(
        replay.response,
        requestIdFromContext(context),
      ));
    }
  }

  const trusted = await requireTrustedSession(context, config);
  const now = Date.now();
  const requestHash = await hashCanonicalJson({
    action: 'STAFF_LOGOUT_ALL',
    staff_id: trusted.authorization.staffId,
    issued_session_version: trusted.session.issued_session_version,
  });
  let acquired;
  try {
    acquired = await acquireIdempotency<StaffLogoutAllResponse>(
      context.env.DB,
      {
        actorType: 'STAFF',
        actorId: trusted.authorization.staffId,
        action: 'STAFF_LOGOUT_ALL',
        targetType: 'STAFF_USER',
        targetId: trusted.authorization.staffId,
        idempotencyKey,
        requestHash,
      },
      { now },
    );
  } catch (error) {
    throw normalizeIdempotencyError(error);
  }
  if (acquired.kind === 'REPLAY') {
    clearStaffSessionCookie(context);
    context.header('Cache-Control', 'no-store');
    return context.json(apiSuccess(
      acquired.response,
      requestIdFromContext(context),
    ));
  }
  const response = await logoutAllStaffSessions(context.env.DB, {
    staffId: trusted.authorization.staffId,
    currentSessionId: trusted.session.id,
    roles: [...trusted.authorization.roles],
    requestId: requestIdFromContext(context),
    claim: acquired.claim,
    now,
  });
  clearStaffSessionCookie(context);
  context.header('Cache-Control', 'no-store');
  return context.json(apiSuccess(response, requestIdFromContext(context)));
}

async function requireTrustedSession(
  context: Context<any>,
  config: StaffAuthRuntimeConfig,
) {
  const cookie = readStaffSessionCookie(context);
  if (cookie.malformed) {
    await recordStaffAuthSecurityEvent(context.env.DB, {
      eventType: 'COOKIE_REJECTED',
      outcome: 'REJECTED',
      config,
      networkSource: networkSourceFromContext(context),
      requestId: requestIdFromContext(context),
      alertSink: configuredAlertSink(context.env),
      createdAt: Date.now(),
    });
    throw new StaffAuthError('UNAUTHENTICATED', 401);
  }
  if (!cookie.value) throw new StaffAuthError('UNAUTHENTICATED', 401);
  try {
    return await resolveTrustedStaffSession(context.env.DB, cookie.value);
  } catch (error) {
    const normalized = normalizeStaffAuthError(error);
    const details = normalized.details as { session_id?: unknown } | null;
    await recordStaffAuthSecurityEvent(context.env.DB, {
      eventType: 'SESSION_REJECTED',
      outcome: 'REJECTED',
      config,
      sessionId: typeof details?.session_id === 'string'
        ? details.session_id
        : null,
      networkSource: networkSourceFromContext(context),
      requestId: requestIdFromContext(context),
      metadata: { reason: readReason(normalized.details) ?? 'INVALID' },
      alertSink: configuredAlertSink(context.env),
      createdAt: Date.now(),
    });
    throw normalized;
  }
}

function withStaffAuthErrors(
  handler: (context: Context<any>) => Promise<Response>,
) {
  return async (context: Context<any>): Promise<Response> => {
    try {
      return await handler(context);
    } catch (error) {
      return staffAuthFailure(context, normalizeStaffAuthError(error));
    }
  };
}

function providerFor(
  context: Context<any>,
  config: StaffAuthRuntimeConfig,
  options: RegisterStaffAuthRoutesOptions,
): StaffAuthProviderAdapter {
  return options.providerFactory
    ? options.providerFactory(config, context)
    : new FeishuStaffAuthProvider(config);
}

function requireAllowedOrigin(
  context: Context<any>,
  config: StaffAuthRuntimeConfig,
): string {
  const origin = context.req.header('Origin');
  const fetchSite = context.req.header('Sec-Fetch-Site');
  if (!origin
    || origin.includes(',')
    || !config.allowedOrigins.has(origin)
    || fetchSite === 'cross-site') {
    throw new StaffAuthError('FORBIDDEN', 403);
  }
  return origin;
}

function cleanReturnTo(
  value: unknown,
  config: StaffAuthRuntimeConfig,
): string {
  if (typeof value !== 'string' || !config.allowedReturnTo.has(value)) {
    throw new StaffAuthError('VALIDATION_ERROR', 400);
  }
  return value;
}

function readExactCallbackQuery(
  context: Context<any>,
): { code: string; state: string } {
  const parameters = new URL(context.req.url).searchParams;
  for (const key of parameters.keys()) {
    if (key !== 'code' && key !== 'state') {
      throw new StaffAuthError('VALIDATION_ERROR', 400);
    }
  }
  const codes = parameters.getAll('code');
  const states = parameters.getAll('state');
  if (codes.length !== 1 || states.length !== 1) {
    throw new StaffAuthError('VALIDATION_ERROR', 400);
  }
  const code = codes[0]?.trim() ?? '';
  const state = states[0]?.trim() ?? '';
  if (code.length < 1 || code.length > 4096
    || state.length !== 43
    || /[\u0000-\u001f\u007f]/u.test(code)) {
    throw new StaffAuthError('VALIDATION_ERROR', 400);
  }
  return { code, state };
}

async function readExactJsonObject<T extends object>(
  context: Context<any>,
  allowedKeys: ReadonlySet<string>,
  allowEmptyBody: boolean,
): Promise<T> {
  const length = context.req.header('Content-Length');
  if (length && (!/^\d+$/u.test(length) || Number(length) > 8192)) {
    throw new StaffAuthError('VALIDATION_ERROR', 400);
  }
  const text = await context.req.text();
  if (!text.trim()) {
    if (allowEmptyBody) return {} as T;
    throw new StaffAuthError('VALIDATION_ERROR', 400);
  }
  if (new TextEncoder().encode(text).byteLength > 8192) {
    throw new StaffAuthError('VALIDATION_ERROR', 400);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new StaffAuthError('VALIDATION_ERROR', 400);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new StaffAuthError('VALIDATION_ERROR', 400);
  }
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new StaffAuthError('VALIDATION_ERROR', 400, {
        unknown_field: key,
      });
    }
  }
  return value as T;
}

function requireIdempotencyKey(context: Context<any>): string {
  const key = context.req.header('Idempotency-Key')?.trim() ?? '';
  if (key.length < 8 || key.length > 128
    || /[\u0000-\u001f\u007f]/u.test(key)) {
    throw new StaffAuthError('VALIDATION_ERROR', 400);
  }
  return key;
}

function networkSourceFromContext(context: Context<any>): string | null {
  const value = context.req.header('CF-Connecting-IP')?.trim() ?? '';
  return value.length >= 1 && value.length <= 200 ? value : null;
}

function readReason(details: unknown): string | null {
  if (!details || typeof details !== 'object') return null;
  const reason = (details as Record<string, unknown>)['reason'];
  return typeof reason === 'string' ? reason : null;
}

function normalizeIdempotencyError(error: unknown): StaffAuthError {
  const candidate = error as Partial<IdempotencyError>;
  if (candidate && typeof candidate.code === 'string'
    && (candidate.status === 400
      || candidate.status === 409
      || candidate.status === 503)) {
    return new StaffAuthError(candidate.code, candidate.status);
  }
  return new StaffAuthError('DEPENDENCY_UNAVAILABLE', 503);
}
