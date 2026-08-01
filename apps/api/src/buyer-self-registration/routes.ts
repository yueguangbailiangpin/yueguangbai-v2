import {
  apiSuccess,
  BUYER_SELF_REGISTRATION_HTTP_PATHS,
  type BuyerSelfRegistrationRequest,
  type BuyerSelfRegistrationResponse,
} from '@ygb/contracts';
import type { Context, Hono } from 'hono';
import {
  issueCustomerSession,
} from '../customer-auth/authenticate-customer';
import { customerAuthOriginGuard } from '../middleware/origin-guard';
import { writeCustomerSessionCookie } from '../http-auth/cookies';
import {
  CUSTOMER_SESSION_TTL_MS,
  requireCustomerSessionSecret,
} from '../http-auth/config';
import {
  BuyerSelfRegistrationError,
  buyerSelfRegistrationFailure,
  normalizeBuyerSelfRegistrationError,
} from './errors';
import {
  verifyHumanBoundary,
  type HumanVerificationVerifier,
} from './human-verification';
import { consumeBuyerRegistrationRateLimit } from './rate-limit';
import { registerBuyerSelf } from './register-buyer';

const MAX_BODY_BYTES = 8 * 1024;

export interface BuyerSelfRegistrationRouteDependencies {
  humanVerification?: HumanVerificationVerifier;
}

export function registerBuyerSelfRegistrationRoutes(
  app: Hono<any>,
  dependencies: BuyerSelfRegistrationRouteDependencies = {},
): void {
  app.post(
    BUYER_SELF_REGISTRATION_HTTP_PATHS.register,
    customerAuthOriginGuard(),
    async (context) => {
      try {
        return await register(context, dependencies);
      } catch (error) {
        return buyerSelfRegistrationFailure(
          context,
          normalizeBuyerSelfRegistrationError(error),
        );
      }
    },
  );
}

async function register(
  context: Context<any>,
  dependencies: BuyerSelfRegistrationRouteDependencies,
): Promise<Response> {
  if (String(context.env.BUYER_SELF_REGISTRATION_ENABLED)
    .toLowerCase() !== 'true') {
    throw new BuyerSelfRegistrationError('FEATURE_DISABLED', 503);
  }
  const defaultBuyerChannelId = String(
    context.env.BUYER_SELF_REGISTRATION_CHANNEL_ID ?? '',
  ).trim();
  if (defaultBuyerChannelId.length < 1) {
    throw new BuyerSelfRegistrationError(
      'CONFIGURATION_INVALID',
      503,
    );
  }

  const requestId = String(
    context.get('requestId') ?? crypto.randomUUID(),
  );
  const registrationOperationKey = `self-register:${crypto.randomUUID()}`;
  const body = await readBody(context);
  const now = Date.now();
  const sessionSecret = requireCustomerSessionSecret(
    context.env.CUSTOMER_SESSION_SECRET,
  );
  const networkSource = context.req.header('CF-Connecting-IP') ?? null;
  const deviceId = context.req.header('X-Device-ID') ?? null;
  const rateLimit = await consumeBuyerRegistrationRateLimit(
    context.env.DB,
    {
      wechatId: body.wechat_id,
      networkSource,
      deviceId,
      secret: sessionSecret,
      now,
    },
  );
  if (rateLimit.limited) {
    throw new BuyerSelfRegistrationError(
      'RATE_LIMITED',
      429,
      rateLimit.retryAfterSeconds,
    );
  }

  const humanRequired = String(
    context.env.BUYER_SELF_REGISTRATION_HUMAN_VERIFICATION_REQUIRED,
  ).toLowerCase() === 'true';
  const humanOk = await verifyHumanBoundary(
    dependencies.humanVerification,
    {
      token: body.human_verification_token ?? '',
      networkSource,
      deviceId,
      requestId,
    },
    humanRequired,
  );
  if (!humanOk) {
    throw new BuyerSelfRegistrationError(
      'HUMAN_VERIFICATION_FAILED',
      409,
    );
  }

  const sessionId = crypto.randomUUID();
  const expiresAt = now + CUSTOMER_SESSION_TTL_MS;
  const result = await registerBuyerSelf(
    context.env.DB,
    {
      wechatId: body.wechat_id,
      password: body.password,
      passwordConfirmation: body.password_confirmation,
      defaultBuyerChannelId,
    },
    {
      requestId,
      idempotencyKey: registrationOperationKey,
      wechatIdHash: rateLimit.wechatIdHash,
      networkSourceHash: rateLimit.networkSourceHash,
      deviceHash: rateLimit.deviceHash,
      sessionId,
      sessionExpiresAt: expiresAt,
      now,
    },
  );
  const token = await issueCustomerSession(
    result.authenticated,
    sessionSecret,
    { now, ttlMs: CUSTOMER_SESSION_TTL_MS },
  );
  writeCustomerSessionCookie(context, token);
  context.header('Cache-Control', 'no-store');
  const response: BuyerSelfRegistrationResponse = {
    identity: {
      buyer_number: result.buyerNumber,
      wechat_id: result.wechatDisplay,
    },
    session_established: true,
    must_change_password: false,
    next_path: '/buyer',
  };
  return context.json(apiSuccess(response, requestId), 201);
}

async function readBody(
  context: Context<any>,
): Promise<BuyerSelfRegistrationRequest> {
  const contentType = context.req.header('Content-Type') ?? '';
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(contentType)) {
    throw new BuyerSelfRegistrationError('INVALID_REQUEST', 400);
  }
  const contentLength = Number(context.req.header('Content-Length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw new BuyerSelfRegistrationError('INVALID_REQUEST', 400);
  }
  const raw = await context.req.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    throw new BuyerSelfRegistrationError('INVALID_REQUEST', 400);
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new BuyerSelfRegistrationError('INVALID_REQUEST', 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BuyerSelfRegistrationError('INVALID_REQUEST', 400);
  }
  const record = body as Record<string, unknown>;
  const allowed = new Set([
    'wechat_id',
    'password',
    'password_confirmation',
    'human_verification_token',
  ]);
  if (Object.keys(record).some((key) => !allowed.has(key))
    || typeof record['wechat_id'] !== 'string'
    || typeof record['password'] !== 'string'
    || typeof record['password_confirmation'] !== 'string'
    || (record['human_verification_token'] !== undefined
      && typeof record['human_verification_token'] !== 'string')) {
    throw new BuyerSelfRegistrationError('INVALID_REQUEST', 400);
  }
  if ((record['human_verification_token'] as string | undefined)?.length
    && (record['human_verification_token'] as string).length > 2048) {
    throw new BuyerSelfRegistrationError('INVALID_REQUEST', 400);
  }
  return {
    wechat_id: record['wechat_id'],
    password: record['password'],
    password_confirmation: record['password_confirmation'],
    ...(record['human_verification_token'] === undefined
      ? {}
      : {
          human_verification_token:
            record['human_verification_token'] as string,
        }),
  };
}
