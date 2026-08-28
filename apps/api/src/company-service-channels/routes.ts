import type { ApiErrorCode } from '@ygb/contracts';
import { apiFailure, apiSuccess } from '@ygb/contracts';
import { parseIdempotencyKey, readBoundedJson } from '@ygb/domain';
import type { Context, Hono } from 'hono';
import { requestIdFromContext } from '../http-auth/errors';
import { customerSessionMiddleware } from '../middleware/customer-auth';
import { customerAuthOriginGuard } from '../middleware/origin-guard';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import {
  listServiceChannels,
  ServiceChannelError,
  setServiceChannel,
} from './service';

const BODY_LIMIT = 16 * 1024;

/**
 * Stage 7.5 batch 2 routes:
 * - GET /api/staff/service-channels — every active staff member (page display).
 * - PUT /api/staff/service-channels/:code — owner-only configuration.
 * - GET /api/buyer-portal/service-channels — logged-in buyers, public fields.
 */

export function registerStaffServiceChannelRoutes(app: Hono<any>): void {
  app.get('/api/staff/service-channels', withErrors(async (context) => {
    requireStaff(context);
    return success(context, {
      channels: await listServiceChannels(context.env.DB),
    });
  }));

  app.put('/api/staff/service-channels/:code', withErrors(async (context) => {
    const actor = requireStaff(context);
    const body = await bodyRecord(context);
    exactKeys(body, [
      'display_name', 'wechat_id', 'qr_file_object_id', 'expected_version', 'reason',
    ]);
    const key = parseIdempotencyKey(context.req.header('Idempotency-Key'));
    if (!key) throw new ServiceChannelError('VALIDATION_ERROR', 400);
    const result = await setServiceChannel(
      context.env.DB,
      {
        code: context.req.param('code'),
        displayName: body['display_name'],
        wechatId: body['wechat_id'],
        qrFileObjectId: body['qr_file_object_id'],
        expectedVersion: body['expected_version'],
        reason: body['reason'],
      },
      {
        actor,
        idempotencyKey: key,
        requestId: requestIdFromContext(context),
      },
    );
    return success(context, result, result.replayed ? 200 : 201);
  }));
}

export function registerBuyerServiceChannelRoutes(app: Hono<any>): void {
  app.get(
    '/api/buyer-portal/service-channels',
    customerAuthOriginGuard(),
    customerSessionMiddleware({ required: false }),
    withErrors(async (context) => {
      const buyer = context.get('customerSession') as
        | { accountType?: string }
        | null
        | undefined;
      if (!buyer || buyer.accountType !== 'BUYER') {
        throw new ServiceChannelError('FORBIDDEN', 403);
      }
    const channels = await listServiceChannels(context.env.DB);
    // Buyer-safe projection: never expose staff updater identity.
    return success(context, {
      channels: channels.map((channel) => ({
        code: channel.code,
        display_name: channel.display_name,
        wechat_id: channel.wechat_id,
        qr_file_object_id: channel.qr_file_object_id,
      })),
    });
  }));
}

function requireStaff(context: Context<any>): AssignmentStaffAuthorization {
  const actor = context.get('staffAuthorization') as
    | AssignmentStaffAuthorization
    | null
    | undefined;
  if (!actor || actor.staffStatus !== 'ACTIVE') {
    throw new ServiceChannelError('FORBIDDEN', 403);
  }
  return actor;
}

async function bodyRecord(context: Context<any>): Promise<Record<string, unknown>> {
  const value = await readBoundedJson(context.req.raw, BODY_LIMIT);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ServiceChannelError('VALIDATION_ERROR', 400);
  }
  return value as Record<string, unknown>;
}

function exactKeys(body: Record<string, unknown>, keys: readonly string[]): void {
  const allowed = new Set(keys);
  if (
    Object.keys(body).some((key) => !allowed.has(key))
    || keys.some((key) => !Object.hasOwn(body, key))
  ) {
    throw new ServiceChannelError('VALIDATION_ERROR', 400);
  }
}

function success(
  context: Context<any>,
  data: unknown,
  status: 200 | 201 = 200,
): Response {
  context.header('Cache-Control', 'no-store');
  return context.json(apiSuccess(data, requestIdFromContext(context)), status);
}

function withErrors(handler: (context: Context<any>) => Promise<Response>) {
  return async (context: Context<any>): Promise<Response> => {
    try {
      return await handler(context);
    } catch (error) {
      const normalized = error instanceof ServiceChannelError
        ? error
        : new ServiceChannelError('DEPENDENCY_UNAVAILABLE', 503);
      const message = normalized.code === 'FORBIDDEN'
        ? '无权执行该操作'
        : normalized.code === 'VALIDATION_ERROR'
          ? '请求参数不正确'
          : normalized.code === 'VERSION_CONFLICT'
            ? '配置已发生变化，请刷新后重试'
            : normalized.code === 'NOT_FOUND'
              ? '资源不存在'
              : '服务暂时不可用，请稍后重试';
      context.header('Cache-Control', 'no-store');
      return context.json(
        apiFailure(
          normalized.code as ApiErrorCode,
          message,
          requestIdFromContext(context),
        ),
        normalized.status,
      );
    }
  };
}
