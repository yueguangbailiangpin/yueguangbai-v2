import {
  apiFailure,
  apiSuccess,
  isBuyerSupportedMarketplaceCode,
} from '@ygb/contracts';
import { parseIdempotencyKey } from '@ygb/domain';
import type { Context, Hono } from 'hono';
import { requestIdFromContext } from '../http-auth/errors';
import { customerAuthOriginGuard } from '../middleware/origin-guard';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import {
  CustomerSecurityError,
  normalizeCustomerSecurityError,
} from './errors';
import { consumeCustomerSecurityRateLimit } from './rate-limit';
import {
  completePasswordReset,
  issueBuyerInvitation,
  issuePasswordReset,
  readBuyerInvitation,
  revokeBuyerInvitation,
} from './service';

const BODY_LIMIT = 16 * 1024;

export function registerStaffCustomerSecurityRoutes(app: Hono<any>): void {
  app.post('/api/staff/customer-security/buyer-invitations',
    customerAuthOriginGuard(), withErrors(async (context) => {
    const actor = requireStaff(context);
    const body = await exactBody(context, ['wechat_id', 'marketplace_code']);
    if (typeof body['wechat_id'] !== 'string'
      || !isBuyerSupportedMarketplaceCode(body['marketplace_code'])) {
      throw validation();
    }
    await enforceStaffRateLimit(context, 'INVITATION', body['wechat_id']);
    const result = await issueBuyerInvitation(context.env.DB, {
      wechatId: body['wechat_id'],
      marketplaceCode: body['marketplace_code'],
    }, staffCommand(context, actor));
    return context.json(apiSuccess({
      invitation: {
        ...result,
        registration_path: `/buyer/register?token=${encodeURIComponent(result.registration_token)}`,
        status: 'ACTIVE' as const,
      },
    }, requestIdFromContext(context)), 201);
  }));

  app.get('/api/staff/customer-security/buyer-invitations/:id', withErrors(async (context) => {
    requireStaff(context);
    return context.json(apiSuccess({
      invitation: await readBuyerInvitation(
        context.env.DB, context.req.param('id') ?? '', Date.now(),
      ),
    }, requestIdFromContext(context)));
  }));

  app.post('/api/staff/customer-security/buyer-invitations/:id/revoke',
    customerAuthOriginGuard(), withErrors(async (context) => {
    const actor = requireStaff(context);
    const body = await exactBody(context, ['expected_version']);
    if (!Number.isSafeInteger(body['expected_version'])) throw validation();
    await enforceStaffRateLimit(context, 'INVITATION',
      context.req.param('id') ?? 'missing-invitation');
    const result = await revokeBuyerInvitation(context.env.DB, {
      invitationId: context.req.param('id') ?? '',
      expectedVersion: Number(body['expected_version']),
    }, {
      actor,
      idempotencyKey: idempotencyKey(context),
      requestId: requestIdFromContext(context),
    });
    return context.json(apiSuccess({ invitation: result }, requestIdFromContext(context)));
  }));

  app.post('/api/staff/customer-security/password-resets',
    customerAuthOriginGuard(), withErrors(async (context) => {
    const actor = requireStaff(context);
    const body = await exactBody(context, [
      'wechat_id', 'manual_verification_confirmed', 'verification_note',
    ]);
    if (typeof body['wechat_id'] !== 'string'
      || body['manual_verification_confirmed'] !== true
      || typeof body['verification_note'] !== 'string') throw validation();
    await enforceStaffRateLimit(context, 'PASSWORD_RESET', body['wechat_id']);
    const result = await issuePasswordReset(context.env.DB, {
      wechatId: body['wechat_id'],
      manualVerificationConfirmed: true,
      verificationNote: body['verification_note'],
    }, staffCommand(context, actor));
    return context.json(apiSuccess({
      password_reset: {
        ...result,
        reset_path: `/customer/reset-password?token=${encodeURIComponent(result.reset_token)}`,
      },
    }, requestIdFromContext(context)), 201);
  }));
}

export function registerPublicCustomerSecurityRoutes(app: Hono<any>): void {
  app.post('/api/customer-auth/password-reset/complete',
    customerAuthOriginGuard(),
    withErrors(async (context) => {
      const body = await exactBody(context, [
        'token', 'new_password', 'password_confirmation',
      ]);
      if (typeof body['token'] !== 'string'
        || typeof body['new_password'] !== 'string'
        || typeof body['password_confirmation'] !== 'string') throw validation();
      const tokenSecret = securitySecret(context);
      const now = Date.now();
      const rate = await consumeCustomerSecurityRateLimit(context.env.DB, {
        operation: 'PASSWORD_RESET', token: body['token'],
        networkSource: context.req.header('CF-Connecting-IP') ?? null,
        deviceId: context.req.header('X-Device-ID') ?? null,
        secret: tokenSecret, now,
      });
      if (rate.limited) {
        throw new CustomerSecurityError('RATE_LIMITED', 429, rate.retryAfterSeconds);
      }
      const result = await completePasswordReset(context.env.DB, {
        token: body['token'], newPassword: body['new_password'],
        passwordConfirmation: body['password_confirmation'],
      }, {
        requestId: requestIdFromContext(context),
        idempotencyKey: idempotencyKey(context), now,
      });
      return context.json(apiSuccess({
        password_reset: result.password_reset,
        all_previous_sessions_revoked: result.all_previous_sessions_revoked,
        next_path: result.next_path,
      }, requestIdFromContext(context)));
    }),
  );
}

function staffCommand(context: Context<any>, actor: AssignmentStaffAuthorization) {
  return {
    actor,
    idempotencyKey: idempotencyKey(context),
    requestId: requestIdFromContext(context),
    tokenSecret: securitySecret(context),
  };
}

function securitySecret(context: Context<any>): string {
  const value = String(context.env.CUSTOMER_SECURITY_TOKEN_SECRET ?? '');
  if (new TextEncoder().encode(value).byteLength < 32) {
    throw new CustomerSecurityError('DEPENDENCY_UNAVAILABLE', 503);
  }
  return value;
}

async function enforceStaffRateLimit(
  context: Context<any>,
  operation: 'INVITATION' | 'PASSWORD_RESET',
  identity: string,
): Promise<void> {
  const rate = await consumeCustomerSecurityRateLimit(context.env.DB, {
    operation, token: identity, primaryScopeType: 'WECHAT_ID',
    networkSource: context.req.header('CF-Connecting-IP') ?? null,
    deviceId: context.req.header('X-Device-ID') ?? null,
    secret: securitySecret(context), now: Date.now(),
  });
  if (rate.limited) {
    throw new CustomerSecurityError('RATE_LIMITED', 429,
      rate.retryAfterSeconds);
  }
}

function requireStaff(context: Context<any>): AssignmentStaffAuthorization {
  const actor = context.get('staffAuthorization') as
    | AssignmentStaffAuthorization | null | undefined;
  if (!actor || actor.staffStatus !== 'ACTIVE') {
    throw new CustomerSecurityError('UNAUTHENTICATED', 401);
  }
  return actor;
}

async function exactBody(
  context: Context<any>,
  keys: readonly string[],
): Promise<Record<string, unknown>> {
  const contentType = context.req.header('Content-Type') ?? '';
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(contentType)) {
    throw validation();
  }
  const raw = await context.req.text();
  if (new TextEncoder().encode(raw).byteLength > BODY_LIMIT) throw validation();
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw validation(); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw validation();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length
    || keys.some((key) => !Object.hasOwn(record, key))) throw validation();
  return record;
}

function idempotencyKey(context: Context<any>): string {
  try {
    const value = parseIdempotencyKey(context.req.header('Idempotency-Key'));
    if (!value) throw new Error('missing');
    return value;
  }
  catch { throw validation(); }
}

function validation() {
  return new CustomerSecurityError('VALIDATION_ERROR', 400);
}

function withErrors(handler: (context: Context<any>) => Promise<Response>) {
  return async (context: Context<any>): Promise<Response> => {
    try { return await handler(context); }
    catch (error) {
      const normalized = normalizeCustomerSecurityError(error);
      context.header('Cache-Control', 'no-store');
      if (normalized.retryAfterSeconds !== null) {
        context.header('Retry-After', String(normalized.retryAfterSeconds));
      }
      const publicBoundary = !context.req.path.startsWith('/api/staff/');
      const message = normalized.code === 'RATE_LIMITED'
        ? '操作过于频繁，请稍后重试'
        : publicBoundary
          ? '该链接无效或已失效，请联系工作人员'
          : normalized.code === 'NOT_FOUND'
            ? '未找到对应记录'
            : '操作未完成，请检查后重试';
      return context.json(apiFailure(
        normalized.code, message, requestIdFromContext(context),
      ), normalized.status);
    }
  };
}
