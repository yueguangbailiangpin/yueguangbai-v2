import {
  apiFailure,
  apiSuccess,
  isApiErrorCode,
  isMarketplaceCode,
} from '@ygb/contracts';
import { parseIdempotencyKey, readBoundedJson } from '@ygb/domain';
import type { Context, Hono } from 'hono';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import {
  BuyerMarketplaceCorrectionError,
  correctBuyerMarketplace,
} from './correct-buyer-marketplace';

const BODY_LIMIT = 16 * 1024;

export function registerMarketplaceFoundationRoutes(app: Hono<any>): void {
  app.post(
    '/api/staff/buyers/:id/marketplace-correction',
    withErrors(correctBuyer),
  );
}

async function correctBuyer(context: Context<any>): Promise<Response> {
  const authorization = context.get('staffAuthorization') as
    | AssignmentStaffAuthorization
    | undefined;
  if (!authorization) {
    throw new BuyerMarketplaceCorrectionError('FORBIDDEN', 403);
  }
  const body = await readBoundedJson(context.req.raw, BODY_LIMIT);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BuyerMarketplaceCorrectionError('VALIDATION_ERROR', 400);
  }
  const value = body as Record<string, unknown>;
  if (Object.keys(value).some((key) => ![
    'marketplace_code', 'expected_version', 'reason',
  ].includes(key))) {
    throw new BuyerMarketplaceCorrectionError('VALIDATION_ERROR', 400);
  }
  if (!isMarketplaceCode(value['marketplace_code'])
    || typeof value['expected_version'] !== 'number'
    || typeof value['reason'] !== 'string') {
    throw new BuyerMarketplaceCorrectionError('VALIDATION_ERROR', 400);
  }
  const key = context.req.header('Idempotency-Key');
  if (!key) throw new BuyerMarketplaceCorrectionError('VALIDATION_ERROR', 400);
  let idempotencyKey: string;
  try {
    const parsed = parseIdempotencyKey(key);
    if (!parsed) throw new Error('invalid_idempotency_key');
    idempotencyKey = parsed;
  } catch {
    throw new BuyerMarketplaceCorrectionError('VALIDATION_ERROR', 400);
  }
  const buyerCustomerId = context.req.param('id');
  if (!buyerCustomerId) {
    throw new BuyerMarketplaceCorrectionError('VALIDATION_ERROR', 400);
  }
  const result = await correctBuyerMarketplace(context.env.DB, {
    buyerCustomerId,
    marketplaceCode: value['marketplace_code'],
    expectedVersion: value['expected_version'],
    reason: value['reason'],
  }, {
    actor: {
      staffId: authorization.staffId,
      roles: [...authorization.roles],
      permissions: authorization.permissions,
    },
    idempotencyKey,
    requestId: context.get('requestId'),
  });
  return context.json(apiSuccess({
    buyer_marketplace: result,
  }, context.get('requestId')));
}

function withErrors(
  handler: (context: Context<any>) => Promise<Response>,
): (context: Context<any>) => Promise<Response> {
  return async (context) => {
    try {
      return await handler(context);
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      const status = (error as { status?: unknown }).status;
      const safeCode = isApiErrorCode(code) ? code : 'DEPENDENCY_UNAVAILABLE';
      const safeStatus = typeof status === 'number'
        && [400, 403, 404, 409, 503].includes(status)
        ? status as 400 | 403 | 404 | 409 | 503
        : 503;
      return context.json(apiFailure(
        safeCode,
        message(safeCode),
        context.get('requestId'),
      ), safeStatus);
    }
  };
}

function message(code: string): string {
  switch (code) {
    case 'FORBIDDEN': return '无权执行买家站点纠正';
    case 'NOT_FOUND': return '买家不存在';
    case 'VERSION_CONFLICT': return '买家资料已更新，请刷新后重试';
    case 'STATE_CONFLICT': return '买家已有正式业务事实，不能更改站点';
    case 'IDEMPOTENCY_CONFLICT': return '幂等键已用于不同请求';
    case 'REQUEST_IN_PROGRESS': return '请求正在处理中';
    case 'VALIDATION_ERROR': return '请求参数不正确';
    default: return '服务暂时不可用，请稍后重试';
  }
}
