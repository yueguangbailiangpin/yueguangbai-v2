import { apiFailure, apiSuccess } from '@ygb/contracts';
import { parseIdempotencyKey } from '@ygb/domain';
import type { Context, Hono } from 'hono';
import { requestIdFromContext } from '../http-auth/errors';
import { customerAuthOriginGuard } from '../middleware/origin-guard';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { createBuyerCustomer } from './create-buyer';
import { CustomerMasterDataError } from './master-data-shared';

const BODY_LIMIT = 16 * 1024;

/**
 * Stage 6.6E: the formal staff buyer-creation endpoint. It is a thin HTTP
 * shell over the existing createBuyerCustomer command — the buyer profile,
 * B/C number allocation, initial BUYER_PRE_SALES_OWNER binding, idempotency
 * and audit all live in that single transactional business method.
 */
export function registerCreateBuyerCustomerRoutes(app: Hono<any>): void {
  app.post(
    '/api/staff/buyer-customers',
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
      const keys = ['display_name', 'wechat_id', 'buyer_channel_id', 'marketplace_code'];
      if (keys.length !== Object.keys(body).length
        || keys.some((key) => !Object.hasOwn(body, key))
        || keys.some((key) => typeof body[key] !== 'string')) {
        throw validation();
      }
      const idempotencyKey = parseIdempotencyKey(
        context.req.header('Idempotency-Key'),
      );
      if (!idempotencyKey) throw validation();

      const result = await createBuyerCustomer(
        context.env.DB,
        {
          displayName: body['display_name'] as string,
          wechatId: body['wechat_id'] as string,
          buyerChannelId: body['buyer_channel_id'] as string,
          marketplaceCode: body['marketplace_code'] as never,
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

      // Project the initial fixed pre-sales binding so the operator sees who
      // owns the new buyer immediately after creation.
      const assignment = (await context.env.DB
        .prepare(
          `SELECT assignment.id AS assignment_id, assignment.staff_id,
            staff.display_name AS staff_display_name, assignment.version
          FROM buyer_staff_assignments assignment
          JOIN staff_users staff ON staff.id=assignment.staff_id
          WHERE assignment.buyer_customer_id=?
            AND assignment.duty_code='BUYER_PRE_SALES_OWNER'
            AND assignment.status='ACTIVE'`,
        )
        .bind(result.buyer_customer_id)
        .first()) as {
          assignment_id: string;
          staff_id: string;
          staff_display_name: string;
          version: number;
        } | null;

      return context.json(apiSuccess({
        buyer_customer: {
          buyer_customer_id: result.buyer_customer_id,
          buyer_number: result.buyer_customer_no,
          access_status: result.access_status,
          activated: false,
          initial_pre_sales_owner: assignment
            ? {
              assignment_id: assignment.assignment_id,
              staff_id: assignment.staff_id,
              staff_display_name: assignment.staff_display_name,
              version: assignment.version,
            }
            : null,
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
    || !actor.permissions.has('BUYER_CREATE')) {
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
    case 'FORBIDDEN': return '当前岗位不能创建买家档案';
    case 'NOT_FOUND': return '买家来源渠道不存在';
    case 'CONFLICT': return '微信号已被其他买家占用';
    case 'VALIDATION_ERROR': return '提交信息不正确';
    case 'IDEMPOTENCY_CONFLICT': return '幂等键已用于不同请求';
    case 'REQUEST_IN_PROGRESS': return '请求正在处理中';
    default: return '买家建档暂时不可用，请稍后重试';
  }
}
