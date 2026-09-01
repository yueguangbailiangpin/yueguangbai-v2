import { apiFailure, apiSuccess } from '@ygb/contracts';
import { parseIdempotencyKey } from '@ygb/domain';
import type { Context, Hono } from 'hono';
import { requestIdFromContext } from '../http-auth/errors';
import { customerAuthOriginGuard } from '../middleware/origin-guard';
import { CustomerAuthError, type CustomerAccessActor } from '../customer-auth/customer-auth-shared';
import { activateSellerOrganizationOwner } from '../customer-auth/activate-seller-owner';

/**
 * T9-DEFECT-004 fix: the runtime seller organization activation endpoint.
 * activateSellerOrganizationOwner (set ACTIVE + issue temporary password +
 * create login account + audit + idempotency) already existed; this is the
 * missing HTTP shell.
 */
export function registerActivateSellerOrganizationRoutes(app: Hono<any>): void {
  app.post(
    '/api/staff/seller-organizations/:id/activate',
    customerAuthOriginGuard(),
    withErrors(async (context) => {
      const actor = requireStaff(context);
      const organizationId = context.req.param('id');
      if (!organizationId || organizationId.length < 1 || organizationId.length > 120) {
        throw new CustomerAuthError('VALIDATION_ERROR', 400);
      }
      const idempotencyKey = parseIdempotencyKey(
        context.req.header('Idempotency-Key'),
      );
      if (!idempotencyKey) {
        throw new CustomerAuthError('VALIDATION_ERROR', 400);
      }

      const result = await activateSellerOrganizationOwner(
        context.env.DB,
        { sellerOrganizationId: organizationId },
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
          owner_member_id: result.owner_member_id,
          account_id: result.account_id,
          status: 'ACTIVE',
          password_change_required: result.password_change_required,
          temporary_password: result.temporary_password,
          temporary_password_available: result.temporary_password_available,
        },
        replayed: result.replayed,
      }, requestIdFromContext(context)), 201);
    }),
  );
}

function requireStaff(context: Context<any>): CustomerAccessActor {
  const actor = context.get('staffAuthorization') as CustomerAccessActor | null | undefined;
  if (!actor) {
    throw new CustomerAuthError('FORBIDDEN', 403);
  }
  return actor;
}

function withErrors(
  handler: (context: Context<any>) => Promise<Response>,
): (context: Context<any>) => Promise<Response> {
  return async (context) => {
    try {
      return await handler(context);
    } catch (error) {
      const normalized = error instanceof CustomerAuthError
        ? error
        : new CustomerAuthError('DEPENDENCY_UNAVAILABLE', 503);
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
    case 'FORBIDDEN': return '当前岗位不能激活卖家组织';
    case 'NOT_FOUND': return '卖家组织不存在';
    case 'CONFLICT': return '卖家组织已激活';
    case 'CUSTOMER_ALREADY_ACTIVE': return '卖家组织已激活';
    case 'VALIDATION_ERROR': return '提交信息不正确';
    case 'IDEMPOTENCY_CONFLICT': return '幂等键已用于不同请求';
    case 'REQUEST_IN_PROGRESS': return '请求正在处理中';
    default: return '卖家组织激活暂时不可用，请稍后重试';
  }
}
