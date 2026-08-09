import {
  SELLER_ORDER_CHAT_SCREENSHOT_HTTP_PATHS,
  apiFailure,
  apiSuccess,
  type SellerOrderChatScreenshotReadIntentRequest,
  type SellerOrderChatScreenshotReadIntentResponseDto,
  type StaffAttachSellerOrderChatScreenshotRequest,
  type StaffAttachSellerOrderChatScreenshotResponseDto,
} from '@ygb/contracts';
import { parseIdempotencyKey, readBoundedJson } from '@ygb/domain';
import type { Context, Hono } from 'hono';
import { DenyAllFileAuthorizationService } from '../files/authorization';
import { createFileReadIntent } from '../files/file-read-service';
import { FileStorageError } from '../files/file-error';
import { requestIdFromContext } from '../http-auth/errors';
import { customerSessionMiddleware } from '../middleware/customer-auth';
import { customerAuthOriginGuard } from '../middleware/origin-guard';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { resolveSellerPortalActor } from '../seller-portal/actor';
import {
  SellerFormalOrderPortalError,
  normalizeSellerFormalOrderPortalError,
} from '../seller-formal-orders/errors';
import { attachSellerOrderChatScreenshot } from './command';
import { requireSellerOrderChatScreenshot } from './read-model';

const BODY_LIMIT_BYTES = 2048;
const DENY_ALL = new DenyAllFileAuthorizationService();

export function registerSellerOrderChatScreenshotRoutes(app: Hono<any>): void {
  app.post(
    SELLER_ORDER_CHAT_SCREENSHOT_HTTP_PATHS.staffAttach,
    withErrors(attachScreenshot),
  );
  app.post(
    SELLER_ORDER_CHAT_SCREENSHOT_HTTP_PATHS.sellerReadIntent,
    customerAuthOriginGuard(),
    customerSessionMiddleware(),
    withErrors(createReadIntent),
  );
}

async function attachScreenshot(context: Context<any>): Promise<Response> {
  const actor = context.get('staffAuthorization') as
    | AssignmentStaffAuthorization
    | null
    | undefined;
  if (!actor) throw new FileStorageError('FORBIDDEN', 403);
  const body = await readBoundedJson(context.req.raw, BODY_LIMIT_BYTES);
  if (!body || Object.keys(body).length !== 2
    || typeof body['file_object_id'] !== 'string'
    || !Number.isSafeInteger(body['expected_file_version'])
    || Number(body['expected_file_version']) < 1) {
    throw new FileStorageError('VALIDATION_ERROR', 400);
  }
  const request: StaffAttachSellerOrderChatScreenshotRequest = {
    file_object_id: body['file_object_id'],
    expected_file_version: Number(body['expected_file_version']),
  };
  const result = await attachSellerOrderChatScreenshot(
    context.env.DB,
    {
      formalOrderId: identifier(context.req.param('id')),
      fileObjectId: identifier(request.file_object_id),
      expectedFileVersion: request.expected_file_version,
    },
    {
      actor,
      idempotencyKey: idempotencyKey(context),
      requestId: requestIdFromContext(context),
    },
  );
  const response: StaffAttachSellerOrderChatScreenshotResponseDto = {
    chat_screenshot: result,
  };
  return success(context, response, result.replayed ? 200 : 201);
}

async function createReadIntent(context: Context<any>): Promise<Response> {
  const actor = await resolveSellerPortalActor(context).catch((error) => {
    const code = (error as { code?: unknown })?.code;
    if (code === 'FORBIDDEN' || code === 'SESSION_INVALID') {
      throw new SellerFormalOrderPortalError('FORMAL_ORDER_NOT_FOUND', 404);
    }
    throw error;
  });
  const access = await requireSellerOrderChatScreenshot(
    context.env.DB,
    actor,
    identifier(context.req.param('id')),
  );
  const body = await readBoundedJson(context.req.raw, BODY_LIMIT_BYTES);
  if (!body || Object.keys(body).length !== 1
    || !Number.isSafeInteger(body['expected_file_version'])
    || Number(body['expected_file_version']) < 1) {
    throw new SellerFormalOrderPortalError('VALIDATION_ERROR', 400);
  }
  const request: SellerOrderChatScreenshotReadIntentRequest = {
    expected_file_version: Number(body['expected_file_version']),
  };
  const expectedVersion = request.expected_file_version;
  if (expectedVersion !== access.fileVersion) {
    throw new SellerFormalOrderPortalError('VERSION_CONFLICT', 409);
  }
  try {
    const result = await createFileReadIntent(
      context.env.DB,
      DENY_ALL,
      {
        fileObjectId: access.fileObjectId,
        fileEntityLinkId: access.fileEntityLinkId,
        expectedFileVersion: expectedVersion,
      },
      {
        actor: {
          type: 'SELLER_MEMBER',
          id: actor.memberId,
          roles: Object.freeze([actor.role]),
        },
        principal: {
          type: 'SELLER_SESSION',
          accountId: actor.accountId,
          identitySubjectId: actor.identitySubjectId,
        },
        idempotencyKey: idempotencyKey(context),
        requestId: requestIdFromContext(context),
      },
    );
    const response: SellerOrderChatScreenshotReadIntentResponseDto = {
      read_intent: {
        read_intent_id: result.readIntentId,
        access_token: result.accessToken,
        access_token_available: result.accessTokenAvailable,
        expires_at: result.expiresAt,
        replayed: result.replayed,
      },
    };
    return success(context, response, result.replayed ? 200 : 201);
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    if (code === 'FORBIDDEN'
      || code === 'FILE_NOT_VERIFIED'
      || code === 'FILE_OBJECT_NOT_FOUND') {
      throw new SellerFormalOrderPortalError('FORMAL_ORDER_NOT_FOUND', 404);
    }
    throw error;
  }
}

function withErrors(
  handler: (context: Context<any>) => Promise<Response>,
) {
  return async (context: Context<any>): Promise<Response> => {
    try {
      return await handler(context);
    } catch (error) {
      const normalized = error instanceof SellerFormalOrderPortalError
        ? error
        : error instanceof FileStorageError
          ? normalizeFileError(error)
          : normalizeSellerFormalOrderPortalError(error);
      context.header('Cache-Control', 'no-store');
      return context.json(apiFailure(
        publicCode(normalized.code),
        publicMessage(normalized.code),
        requestIdFromContext(context),
      ), normalized.status);
    }
  };
}

function normalizeFileError(error: unknown): FileStorageError {
  if (error instanceof FileStorageError) return error;
  const candidate = error as { code?: unknown; status?: unknown };
  if (candidate?.code === 'UNAUTHENTICATED') {
    return new FileStorageError('FORBIDDEN', 403);
  }
  return new FileStorageError('DEPENDENCY_UNAVAILABLE', 503);
}

function publicCode(code: string): 'VALIDATION_ERROR' | 'FORBIDDEN' | 'NOT_FOUND'
  | 'VERSION_CONFLICT' | 'IDEMPOTENCY_CONFLICT' | 'REQUEST_IN_PROGRESS'
  | 'DEPENDENCY_UNAVAILABLE' | 'FORMAL_ORDER_NOT_FOUND' {
  if (code === 'FORMAL_ORDER_NOT_FOUND') return code;
  if (code === 'VERSION_CONFLICT') return code;
  if (code === 'IDEMPOTENCY_CONFLICT') return code;
  if (code === 'REQUEST_IN_PROGRESS') return code;
  if (code === 'VALIDATION_ERROR') return code;
  if (code === 'FORBIDDEN') return code;
  if (code === 'NOT_FOUND' || code.endsWith('_NOT_FOUND')) return 'NOT_FOUND';
  return 'DEPENDENCY_UNAVAILABLE';
}

function publicMessage(code: string): string {
  switch (code) {
    case 'VALIDATION_ERROR': return '请求参数不正确';
    case 'FORBIDDEN': return '当前账号无权执行该操作';
    case 'NOT_FOUND':
    case 'FORMAL_ORDER_NOT_FOUND':
    case 'FILE_NOT_VERIFIED': return '资源不存在';
    case 'VERSION_CONFLICT': return '数据已发生变化，请刷新后重试';
    default: return '服务暂时不可用，请稍后重试';
  }
}

function success(
  context: Context<any>,
  data: unknown,
  status: 200 | 201,
): Response {
  context.header('Cache-Control', 'no-store');
  return context.json(apiSuccess(data, requestIdFromContext(context)), status);
}

function identifier(value: unknown): string {
  if (typeof value !== 'string') throw new FileStorageError('VALIDATION_ERROR', 400);
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length < 1 || normalized.length > 120
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new FileStorageError('VALIDATION_ERROR', 400);
  }
  return normalized;
}

function idempotencyKey(context: Context<any>): string {
  const value = parseIdempotencyKey(context.req.header('Idempotency-Key'));
  if (!value) throw new FileStorageError('VALIDATION_ERROR', 400);
  return value;
}
