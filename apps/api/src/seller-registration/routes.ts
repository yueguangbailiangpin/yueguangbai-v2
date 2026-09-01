import { apiFailure, apiSuccess } from '@ygb/contracts';
import { normalizeWechatId, parseIdempotencyKey } from '@ygb/domain';
import type { Context, Hono } from 'hono';
import type { AppEnv } from '../app';
import { issueCustomerSession } from '../customer-auth/authenticate-customer';
import { consumeCustomerSecurityRateLimit } from '../customer-security/rate-limit';
import { writeCustomerSessionCookie } from '../http-auth/cookies';
import { CUSTOMER_SESSION_TTL_MS, requireCustomerSessionSecret } from '../http-auth/config';
import { requestIdFromContext } from '../http-auth/errors';
import { customerAuthOriginGuard } from '../middleware/origin-guard';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { readCurrentSellerInvitation } from './staff-read';
import {
  completeSellerRegistration,
  issueSellerRegistrationInvitation,
  readSellerInvitationContext,
  readSellerInvitationForStaff,
  revokeSellerRegistrationInvitation,
  SellerRegistrationError,
} from './service';

const BODY_LIMIT = 16 * 1024;

export function registerSellerRegistrationRoutes(app: Hono<AppEnv>): void {
  app.post(
    '/api/staff/customer-security/seller-invitations',
    customerAuthOriginGuard(),
    withErrors(async (context) => {
      const actor = requireSellerManagementStaff(context);
      const body = await exactBody(context, [
        'lead_id',
        'seller_organization_id',
        'wechat_id',
        'marketplace_code',
      ]);
      if (
        !(body['lead_id'] === null || typeof body['lead_id'] === 'string') ||
        !(
          body['seller_organization_id'] === null ||
          typeof body['seller_organization_id'] === 'string'
        ) ||
        typeof body['wechat_id'] !== 'string' ||
        typeof body['marketplace_code'] !== 'string'
      )
        throw validation();
      if (typeof body['seller_organization_id'] === 'string') {
        await prevalidateHistoricalSellerIdentity(
          context,
          body['seller_organization_id'],
          body['wechat_id'],
        );
      }
      const result = await issueSellerRegistrationInvitation(
        context.env.DB,
        {
          leadId: body['lead_id'],
          sellerOrganizationId: body['seller_organization_id'],
          wechatId: body['wechat_id'],
          marketplaceCode: body['marketplace_code'],
        },
        {
          actor,
          idempotencyKey: idempotencyKey(context),
          requestId: requestIdFromContext(context),
          tokenSecret: securitySecret(context),
        },
      );
      return context.json(
        apiSuccess(
          {
            invitation: {
              ...result,
              registration_path: `/seller/register?token=${encodeURIComponent(result.registration_token)}`,
              status: 'ACTIVE' as const,
            },
          },
          requestIdFromContext(context),
        ),
        201,
      );
    }),
  );

  // Specific route MUST stay before /:id. The token itself is hash-only and is
  // never recoverable; this endpoint only tells Staff whether an old invite
  // must be revoked before generating a fresh link.
  app.get(
    '/api/staff/customer-security/seller-invitations/current',
    withErrors(async (context) => {
      const actor = requireSellerManagementStaff(context);
      const url = new URL(context.req.url);
      if (
        [...url.searchParams.keys()].some(
          (key) => !['lead_id', 'seller_organization_id'].includes(key),
        )
      )
        throw validation();
      const sellerOrganizationId = url.searchParams.get('seller_organization_id');
      if (sellerOrganizationId === null) throw validation();
      const invitation = await readCurrentSellerInvitation(context.env.DB, actor, {
        sellerOrganizationId,
      });
      context.header('Cache-Control', 'no-store');
      return context.json(apiSuccess({ invitation }, requestIdFromContext(context)));
    }),
  );

  app.get(
    '/api/staff/customer-security/seller-invitations/:id',
    withErrors(async (context) => {
      const invitation = await readSellerInvitationForStaff(
        context.env.DB,
        context.req.param('id') ?? '',
        requireSellerManagementStaff(context),
      );
      return context.json(apiSuccess({ invitation }, requestIdFromContext(context)));
    }),
  );

  app.post(
    '/api/staff/customer-security/seller-invitations/:id/revoke',
    customerAuthOriginGuard(),
    withErrors(async (context) => {
      const actor = requireSellerManagementStaff(context);
      const body = await exactBody(context, ['expected_version']);
      if (!Number.isSafeInteger(body['expected_version'])) throw validation();
      const invitation = await revokeSellerRegistrationInvitation(
        context.env.DB,
        {
          invitationId: context.req.param('id') ?? '',
          expectedVersion: Number(body['expected_version']),
        },
        {
          actor,
          idempotencyKey: idempotencyKey(context),
          requestId: requestIdFromContext(context),
        },
      );
      return context.json(apiSuccess({ invitation }, requestIdFromContext(context)));
    }),
  );

  app.get(
    '/api/seller-auth/invitations/:token',
    withErrors(async (context) => {
      const token = context.req.param('token') ?? '';
      const now = Date.now();
      const limited = await publicInvitationRate(context, token, now);
      if (limited) return limited;
      context.header('Cache-Control', 'no-store');
      return context.json(
        apiSuccess(
          { invitation: await readSellerInvitationContext(context.env.DB, token, now) },
          requestIdFromContext(context),
        ),
      );
    }),
  );

  app.post(
    '/api/seller-auth/register',
    customerAuthOriginGuard(),
    withErrors(async (context) => {
      const body = await exactBody(context, [
        'invitation_token',
        'wechat_id',
        'password',
        'password_confirmation',
      ]);
      if (
        typeof body['invitation_token'] !== 'string' ||
        typeof body['wechat_id'] !== 'string' ||
        typeof body['password'] !== 'string' ||
        typeof body['password_confirmation'] !== 'string'
      )
        throw validation();
      const now = Date.now();
      const limited = await publicInvitationRate(context, body['invitation_token'], now);
      if (limited) return limited;
      const result = await completeSellerRegistration(
        context.env.DB,
        {
          token: body['invitation_token'],
          wechatId: body['wechat_id'],
          password: body['password'],
          passwordConfirmation: body['password_confirmation'],
        },
        { requestId: requestIdFromContext(context), idempotencyKey: idempotencyKey(context), now },
      );
      const secret = requireCustomerSessionSecret(context.env.CUSTOMER_SESSION_SECRET);
      const token = await issueCustomerSession(
        {
          accountId: result.account_id,
          identitySubjectId: result.identity_subject_id,
          accountType: 'SELLER_MEMBER',
          availablePersonas: ['SELLER_MEMBER'],
          sessionVersion: result.session_version,
          passwordChangeRequired: false,
        },
        secret,
        { now, ttlMs: CUSTOMER_SESSION_TTL_MS },
      );
      writeCustomerSessionCookie(context, token);
      context.header('Cache-Control', 'no-store');
      return context.json(
        apiSuccess(
          {
            session_established: true,
            must_change_password: false,
            next_path: '/seller',
            seller_organization_id: result.seller_organization_id,
            onboarding_kind: result.onboarding_kind,
          },
          requestIdFromContext(context),
        ),
        201,
      );
    }),
  );
}

async function prevalidateHistoricalSellerIdentity(
  context: Context<AppEnv>,
  organizationId: string,
  wechatId: string,
): Promise<void> {
  const wechat = normalizeWechatId(wechatId);
  const owners = await context.env.DB.prepare(
    `SELECT member.identity_subject_id
    FROM seller_organization_members member
    WHERE member.organization_id=? AND member.primary_owner=1 AND member.status='ACTIVE'
    ORDER BY member.member_number,member.id LIMIT 2`,
  )
    .bind(organizationId)
    .all<{ identity_subject_id: string }>();
  if (owners.results.length > 1) throw new SellerRegistrationError('CONFLICT', 409);
  if (owners.results.length === 0) {
    const existingSeller = await context.env.DB.prepare(
      `SELECT member.id
      FROM wechat_identity_claims claim JOIN seller_organization_members member ON member.identity_subject_id=claim.identity_subject_id
      WHERE claim.normalized_wechat=? AND claim.status IN('ACTIVE','RESERVED') AND member.status='ACTIVE' LIMIT 1`,
    )
      .bind(wechat.normalized)
      .first();
    if (existingSeller) throw new SellerRegistrationError('CONFLICT', 409);
    return;
  }
  const ownerSubject = owners.results[0]!.identity_subject_id;
  const claims = await context.env.DB.prepare(
    `SELECT normalized_wechat FROM wechat_identity_claims
    WHERE identity_subject_id=? AND status IN('ACTIVE','RESERVED')`,
  )
    .bind(ownerSubject)
    .all<{ normalized_wechat: string }>();
  if (
    claims.results.length > 1 ||
    claims.results.some((row) => row.normalized_wechat !== wechat.normalized)
  )
    throw new SellerRegistrationError('CONFLICT', 409);
  if (claims.results.length === 0) {
    const existing = await context.env.DB.prepare(
      `SELECT identity_subject_id FROM wechat_identity_claims
      WHERE normalized_wechat=? AND status IN('ACTIVE','RESERVED') LIMIT 2`,
    )
      .bind(wechat.normalized)
      .all<{ identity_subject_id: string }>();
    if (
      existing.results.length > 1 ||
      (existing.results.length === 1 && existing.results[0]!.identity_subject_id !== ownerSubject)
    )
      throw new SellerRegistrationError('CONFLICT', 409);
  }
}
async function publicInvitationRate(
  context: Context<AppEnv>,
  token: string,
  now: number,
): Promise<Response | null> {
  const rate = await consumeCustomerSecurityRateLimit(context.env.DB, {
    operation: 'INVITATION',
    primaryScope: { type: 'TOKEN', value: token },
    networkSource: context.req.header('CF-Connecting-IP') ?? null,
    deviceId: context.req.header('X-Device-ID') ?? null,
    secret: securitySecret(context),
    now,
  });
  if (!rate.limited) return null;
  context.header('Cache-Control', 'no-store');
  context.header('Retry-After', String(rate.retryAfterSeconds));
  return context.json(
    apiFailure('RATE_LIMITED', '尝试次数过多，请稍后再试', requestIdFromContext(context)),
    429,
  );
}
function requireStaff(context: Context<AppEnv>): AssignmentStaffAuthorization {
  const actor = context.get('staffAuthorization') as AssignmentStaffAuthorization | undefined;
  if (!actor || actor.staffStatus !== 'ACTIVE') throw new SellerRegistrationError('FORBIDDEN', 403);
  return actor;
}
function requireSellerManagementStaff(context: Context<AppEnv>): AssignmentStaffAuthorization {
  const actor = requireStaff(context);
  if (
    (!actor.roles.has('owner') && !actor.roles.has('seller_ops')) ||
    !actor.permissions.has('SELLER_MANAGE')
  )
    throw new SellerRegistrationError('FORBIDDEN', 403);
  return actor;
}
function securitySecret(context: Context<AppEnv>): string {
  const value = String(context.env.CUSTOMER_SECURITY_TOKEN_SECRET ?? '');
  if (new TextEncoder().encode(value).byteLength < 32)
    throw new SellerRegistrationError('DEPENDENCY_UNAVAILABLE', 503);
  return value;
}
function idempotencyKey(context: Context<AppEnv>): string {
  try {
    const value = parseIdempotencyKey(context.req.header('Idempotency-Key'));
    if (!value) throw new Error('missing');
    return value;
  } catch {
    throw validation();
  }
}
async function exactBody(
  context: Context<AppEnv>,
  keys: readonly string[],
): Promise<Record<string, unknown>> {
  const type = context.req.header('Content-Type') ?? '';
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(type)) throw validation();
  const raw = await context.req.text();
  if (new TextEncoder().encode(raw).byteLength > BODY_LIMIT) throw validation();
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw validation();
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw validation();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length || keys.some((key) => !Object.hasOwn(record, key)))
    throw validation();
  return record;
}
function validation() {
  return new SellerRegistrationError('VALIDATION_ERROR', 400);
}
function withErrors(handler: (context: Context<AppEnv>) => Promise<Response>) {
  return async (context: Context<AppEnv>) => {
    try {
      return await handler(context);
    } catch (error) {
      const normalized =
        error instanceof SellerRegistrationError
          ? error
          : new SellerRegistrationError('DEPENDENCY_UNAVAILABLE', 503);
      const message =
        normalized.code === 'FORBIDDEN'
          ? '当前岗位不允许操作卖家账号'
          : normalized.code === 'NOT_FOUND'
            ? '没有找到对应卖家客户'
            : normalized.code === 'CONFLICT'
              ? '客户现有身份与登记微信不一致、客户已开通账号或邀请状态冲突，请核对后再操作'
              : normalized.code === 'VALIDATION_ERROR'
                ? '提交信息不正确'
                : '卖家账号服务暂时不可用';
      context.header('Cache-Control', 'no-store');
      return context.json(
        apiFailure(normalized.code, message, requestIdFromContext(context)),
        normalized.status,
      );
    }
  };
}
