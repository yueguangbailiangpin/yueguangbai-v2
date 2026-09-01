import { apiFailure, apiSuccess } from '@ygb/contracts';
import { parseIdempotencyKey } from '@ygb/domain';
import type { Context, Hono } from 'hono';
import { requestIdFromContext } from '../http-auth/errors';
import { customerAuthOriginGuard } from '../middleware/origin-guard';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { createSellerOrganization } from './create-seller-organization';
import { CustomerMasterDataError } from './master-data-shared';

const BODY_LIMIT = 16 * 1024;

/**
 * T9-DEFECT-002 fix: the runtime staff seller-organization creation endpoint.
 * The createSellerOrganization command (marketplace validation, channel
 * sequence, identity claims, idempotency, audit, assignment) already exists;
 * this is the thin HTTP shell that was missing.
 */
export function registerCreateSellerOrganizationRoutes(app: Hono<any>): void {
  app.post(
    '/api/staff/seller-organizations',
    customerAuthOriginGuard(),
    withErrors(async (context) => {
      const actor = requireStaff(context);
      const raw = await context.req.text();
      if (new TextEncoder().encode(raw).byteLength > BODY_LIMIT) {
        throw validation();
      }
      let value: unknown;
      try {
        value = JSON.parse(raw);
      } catch {
        throw validation();
      }
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw validation();
      }
      const body = value as Record<string, unknown>;
      const keys = [
        'marketplace_code',
        'seller_channel_id',
        'organization_name',
        'owner_display_name',
        'owner_wechat_id',
      ];
      if (keys.length !== Object.keys(body).length
        || keys.some((key) => !Object.hasOwn(body, key))
        || keys.some((key) => typeof body[key] !== 'string')) {
        throw validation();
      }
      const idempotencyKey = parseIdempotencyKey(
        context.req.header('Idempotency-Key'),
      );
      if (!idempotencyKey) throw validation();

      const result = await createSellerOrganization(
        context.env.DB,
        {
          marketplaceCode: body['marketplace_code'] as never,
          sellerChannelId: body['seller_channel_id'] as string,
          organizationName: body['organization_name'] as string,
          ownerDisplayName: body['owner_display_name'] as string,
          ownerWechatId: body['owner_wechat_id'] as string,
        },
        {
          actor: {
            staffId: actor.staffId,
            displayName: actor.displayName,
            roles: [...actor.roles],
            permissions: actor.permissions,
          },
          idempotencyKey,
          requestId: requestIdFromContext(context),
        },
      );

      return context.json(apiSuccess({
        seller_organization: {
          seller_organization_id: result.seller_organization_id,
          seller_code: result.seller_code,
          status: result.status,
          owner_member_id: result.owner_member_id,
        },
        replayed: result.replayed,
      }, requestIdFromContext(context)), 201);
    }),
  );
}

function requireStaff(context: Context<any>): AssignmentStaffAuthorization {
  const actor = context.get('staffAuthorization') as
    | AssignmentStaffAuthorization
    | null
    | undefined;
  if (!actor || actor.staffStatus !== 'ACTIVE'
    || !actor.permissions.has('SELLER_MANAGE')) {
    throw new CustomerMasterDataError('FORBIDDEN', 403);
  }
  return actor;
}

function validation(): never {
  throw new CustomerMasterDataError('VALIDATION_ERROR', 400);
}

function withErrors(
  handler: (context: Context<any>) => Promise<Response>,
): (context: Context<any>) => Promise<Response> {
  return async (context) => {
    try {
      return await handler(context);
    } catch (error) {
      const normalized = error instanceof CustomerMasterDataError
        ? error
        : new CustomerMasterDataError('DEPENDENCY_UNAVAILABLE', 503);
      context.header('Cache-Control', 'no-store');
      return context.json(
        apiFailure(
          normalized.code as never,
          message(normalized.code),
          requestIdFromContext(context),
        ),
        normalized.status,
      );
    }
  };
}

function message(code: string): string {
  switch (code) {
    case 'FORBIDDEN': return '当前岗位不能创建卖家组织';
    case 'NOT_FOUND': return '客服通道不存在或已停用';
    case 'CONFLICT': return '微信号已被其他卖家占用';
    case 'VALIDATION_ERROR': return '提交信息不正确';
    case 'IDEMPOTENCY_CONFLICT': return '幂等键已用于不同请求';
    case 'REQUEST_IN_PROGRESS': return '请求正在处理中';
    default: return '卖家组织创建暂时不可用，请稍后重试';
  }
}
