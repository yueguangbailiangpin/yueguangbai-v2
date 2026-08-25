import {
  apiFailure,
  apiSuccess,
  type ApiErrorCode,
} from '@ygb/contracts';
import { parseIdempotencyKey, readBoundedJson } from '@ygb/domain';
import type { Context, Hono } from 'hono';
import { requireBuyerPortalContext } from '../buyer-portal/buyer-context';
import { requestIdFromContext } from '../http-auth/errors';
import { customerSessionMiddleware } from '../middleware/customer-auth';
import { customerAuthOriginGuard } from '../middleware/origin-guard';
import type { AssignmentStaffAuthorization } from '../staff-assignment/effective-authorization';
import { cancelOrderInstruction } from './cancel';
import {
  getOrderInstructionExpiryScanCursor,
  runOrderInstructionExpiryScan,
} from './expiry-scan';
import { publishOrderInstruction } from './publish';
import {
  getBuyerOrderInstruction,
  getBuyerOrderInstructionState,
  getStaffOrderInstruction,
  listStaffOrderInstructionVersions,
} from './read-model';
import { createBuyerInstructionImageReadIntent } from './read-intent';
import { reconcileApprovedReservations } from './reconciliation';
import {
  OrderInstructionError,
  type OrderInstructionStaffActor,
} from './shared';

const WRITE_BODY_LIMIT = 32 * 1024;

export function registerOrderInstructionRoutes(app: Hono<any>): void {
  const session = customerSessionMiddleware();
  app.get(
    '/api/buyer-portal/reservations/:id/order-instruction',
    session,
    withErrors(getBuyerInstruction),
  );
  app.get(
    '/api/buyer-portal/reservations/:id/order-instruction/state',
    session,
    withErrors(getBuyerInstructionState),
  );
  app.post(
    '/api/buyer-portal/reservations/:id/order-instruction/images/:position/read-intent',
    customerAuthOriginGuard(),
    session,
    withErrors(createBuyerImageReadIntent),
  );

  app.get(
    '/api/staff/order-instructions/:id',
    withErrors(getStaffInstruction),
  );
  app.get(
    '/api/staff/order-instructions/:id/versions',
    withErrors(getStaffInstructionVersions),
  );
  app.post(
    '/api/staff/order-instructions/:id/publish',
    customerAuthOriginGuard(),
    withErrors(publishInstruction),
  );
  app.post(
    '/api/staff/order-instructions/:id/cancel',
    customerAuthOriginGuard(),
    withErrors(cancelInstruction),
  );
  app.post(
    '/api/staff/order-instructions/expiry-scan/run',
    customerAuthOriginGuard(),
    withErrors(runExpiryScan),
  );
  app.get(
    '/api/staff/order-instructions/expiry-scan/state',
    withErrors(getExpiryScanState),
  );
  app.post(
    '/api/staff/order-instructions/reconciliation/run',
    customerAuthOriginGuard(),
    withErrors(runReconciliation),
  );
}

async function getBuyerInstruction(context: Context<any>): Promise<Response> {
  const actor = await requireBuyerPortalContext(context);
  const result = await getBuyerOrderInstruction(
    context.env.DB,
    actor,
    requiredIdentifier(context.req.param('id')),
  );
  return success(context, { order_instruction: result });
}

async function getBuyerInstructionState(context: Context<any>): Promise<Response> {
  const actor = await requireBuyerPortalContext(context);
  const result = await getBuyerOrderInstructionState(
    context.env.DB,
    actor,
    requiredIdentifier(context.req.param('id')),
  );
  return success(context, { order_instruction: result });
}

async function createBuyerImageReadIntent(
  context: Context<any>,
): Promise<Response> {
  const actor = await requireBuyerPortalContext(context);
  const raw = context.req.param('position');
  if (raw !== 'main') throw new OrderInstructionError('VALIDATION_ERROR', 400);
  const position = 'main' as const;
  const result = await createBuyerInstructionImageReadIntent(
    context.env.DB,
    {
      reservationId: requiredIdentifier(context.req.param('id')),
      position,
    },
    {
      actor,
      idempotencyKey: requireIdempotencyKey(context),
      requestId: requestIdFromContext(context),
    },
  );
  return success(context, { read_intent: result }, 201);
}

async function getStaffInstruction(context: Context<any>): Promise<Response> {
  const actor = requireStaffActor(context);
  return success(context, {
    order_instruction: await getStaffOrderInstruction(
      context.env.DB,
      actor,
      requiredIdentifier(context.req.param('id')),
    ),
  });
}

async function getStaffInstructionVersions(
  context: Context<any>,
): Promise<Response> {
  const actor = requireStaffActor(context);
  return success(context, {
    versions: await listStaffOrderInstructionVersions(
      context.env.DB,
      actor,
      requiredIdentifier(context.req.param('id')),
    ),
  });
}


async function publishInstruction(context: Context<any>): Promise<Response> {
  const actor = requireStaffActor(context);
  const body = exactBody(
    await readBoundedJson(context.req.raw, WRITE_BODY_LIMIT),
    ['expected_version'],
    ['staff_public_note'],
  );
  const result = await publishOrderInstruction(context.env.DB, {
    instructionId: requiredIdentifier(context.req.param('id')),
    expectedVersion: integer(body['expected_version']),
    staffPublicNote: optionalString(body['staff_public_note']),
  }, {
    actor,
    idempotencyKey: requireIdempotencyKey(context),
    requestId: requestIdFromContext(context),
  });
  return success(context, { publication: result }, result.unchanged ? 200 : 201);
}

async function cancelInstruction(context: Context<any>): Promise<Response> {
  const actor = requireStaffActor(context);
  const body = exactBody(
    await readBoundedJson(context.req.raw, WRITE_BODY_LIMIT),
    ['expected_version', 'reason'],
  );
  const result = await cancelOrderInstruction(context.env.DB, {
    instructionId: requiredIdentifier(context.req.param('id')),
    expectedVersion: integer(body['expected_version']),
    reason: requiredIdentifier(body['reason'], 1000),
  }, {
    actor,
    idempotencyKey: requireIdempotencyKey(context),
    requestId: requestIdFromContext(context),
  });
  return success(context, { cancellation: result });
}

async function runExpiryScan(context: Context<any>): Promise<Response> {
  const actor = requireStaffActor(context);
  const body = exactBody(
    await readBoundedJson(context.req.raw, WRITE_BODY_LIMIT),
    [],
    ['limit'],
  );
  const result = await runOrderInstructionExpiryScan(context.env.DB, {
    marketplaceCode: 'AMAZON_JP',
    ...(body['limit'] == null ? {} : { limit: integer(body['limit']) }),
  }, {
    actor,
    idempotencyKey: requireIdempotencyKey(context),
    requestId: requestIdFromContext(context),
  });
  return success(context, { scan: result });
}

async function getExpiryScanState(context: Context<any>): Promise<Response> {
  const actor = requireStaffActor(context);
  const cursor = await getOrderInstructionExpiryScanCursor(
    context.env.DB,
    actor,
    'AMAZON_JP',
  );
  return success(context, { cursor });
}


async function runReconciliation(context: Context<any>): Promise<Response> {
  const actor = requireStaffActor(context);
  if (!actor.permissions.has('ORDER_INSTRUCTION_MANAGE')) {
    throw new OrderInstructionError('FORBIDDEN', 403);
  }
  const body = exactBody(
    await readBoundedJson(context.req.raw, WRITE_BODY_LIMIT),
    [],
    ['after_reservation_id', 'limit'],
  );
  const result = await reconcileApprovedReservations(context.env.DB, {
    marketplaceCode: 'AMAZON_JP',
    ...(optionalString(body['after_reservation_id']) === null
      ? {}
      : { afterReservationId: optionalString(body['after_reservation_id'])! }),
    ...(body['limit'] == null ? {} : { limit: integer(body['limit']) }),
  }, {
    actor,
    idempotencyKey: requireIdempotencyKey(context),
    requestId: requestIdFromContext(context),
  });
  return success(context, { reconciliation: result });
}

function requireStaffActor(context: Context<any>): OrderInstructionStaffActor {
  const actor = context.get('staffAuthorization') as
    | AssignmentStaffAuthorization
    | null
    | undefined;
  if (!actor) throw new OrderInstructionError('UNAUTHENTICATED', 401);
  return actor as OrderInstructionStaffActor;
}

function withErrors(
  handler: (context: Context<any>) => Promise<Response>,
) {
  return async (context: Context<any>): Promise<Response> => {
    try {
      return await handler(context);
    } catch (error) {
      const normalized = error instanceof OrderInstructionError
        ? error
        : new OrderInstructionError('DEPENDENCY_UNAVAILABLE', 503);
      return context.json(apiFailure(
        apiCode(normalized.code),
        publicMessage(normalized.code),
        requestIdFromContext(context),
      ), normalized.status);
    }
  };
}

function success(
  context: Context<any>,
  data: unknown,
  status: 200 | 201 = 200,
): Response {
  return context.json(apiSuccess(data, requestIdFromContext(context)), status);
}

function apiCode(code: OrderInstructionError['code']): ApiErrorCode {
  switch (code) {
    case 'VALIDATION_ERROR': return 'VALIDATION_ERROR';
    case 'UNAUTHENTICATED': return 'UNAUTHENTICATED';
    case 'FORBIDDEN':
    case 'FILE_ACCESS_DENIED': return 'FORBIDDEN';
    case 'NOT_FOUND': return 'NOT_FOUND';
    case 'VERSION_CONFLICT': return 'VERSION_CONFLICT';
    case 'IDEMPOTENCY_CONFLICT': return 'IDEMPOTENCY_CONFLICT';
    case 'REQUEST_IN_PROGRESS': return 'REQUEST_IN_PROGRESS';
    case 'DEPENDENCY_UNAVAILABLE': return 'DEPENDENCY_UNAVAILABLE';
    default: return 'STATE_CONFLICT';
  }
}

function publicMessage(code: OrderInstructionError['code']): string {
  switch (code) {
    case 'INSTRUCTION_EXPIRED': return '下单资料提交期限已过';
    case 'INSUFFICIENT_ORDER_WINDOW': return '剩余下单时间不足六小时';
    case 'MAIN_IMAGE_REQUIRED': return '产品主图尚未准备完成';
    case 'KEYWORDS_REQUIRED': return '下单关键词尚未配置';
    case 'ORDER_NUMBER_ALREADY_CLAIMED': return 'Amazon 订单号已被占用';
    case 'ORDER_NUMBER_CONFLICT_REQUIRES_REVIEW': return '历史订单号冲突需人工处理';
    case 'FORBIDDEN':
    case 'FILE_ACCESS_DENIED': return '无权执行该操作';
    case 'NOT_FOUND': return '资源不存在';
    case 'VERSION_CONFLICT': return '数据已发生变化，请刷新后重试';
    case 'VALIDATION_ERROR': return '请求参数不正确';
    default: return '服务暂时不可用，请稍后重试';
  }
}

function requireIdempotencyKey(context: Context<any>): string {
  try {
    const key = parseIdempotencyKey(
      context.req.header('Idempotency-Key'),
    );
    if (key === null) {
      throw new OrderInstructionError('VALIDATION_ERROR', 400);
    }
    return key;
  } catch {
    throw new OrderInstructionError('VALIDATION_ERROR', 400);
  }
}

function exactBody(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OrderInstructionError('VALIDATION_ERROR', 400);
  }
  const body = value as Record<string, unknown>;
  const allowedKeys = new Set([...requiredKeys, ...optionalKeys]);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))
    || requiredKeys.some((key) => !Object.prototype.hasOwnProperty.call(body, key))) {
    throw new OrderInstructionError('VALIDATION_ERROR', 400);
  }
  return body;
}

function requiredIdentifier(value: unknown, maximum = 200): string {
  if (typeof value !== 'string') {
    throw new OrderInstructionError('VALIDATION_ERROR', 400);
  }
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length < 1 || normalized.length > maximum
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new OrderInstructionError('VALIDATION_ERROR', 400);
  }
  return normalized;
}

function optionalString(value: unknown): string | null {
  if (value == null) return null;
  return requiredIdentifier(value, 2000);
}

function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new OrderInstructionError('VALIDATION_ERROR', 400);
  }
  return value;
}

