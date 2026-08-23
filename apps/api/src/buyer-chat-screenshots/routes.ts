import {
  BUYER_ORDER_CHAT_SCREENSHOT_HTTP_PATHS,
  apiFailure,
  apiSuccess,
  type StaffAttachBuyerChatScreenshotRequest,
  type StaffAttachBuyerChatScreenshotResponseDto,
} from '@ygb/contracts';
import { parseIdempotencyKey, readBoundedJson } from '@ygb/domain';
import type { Context, Hono } from 'hono';
import { FileStorageError } from '../files/file-error';
import { requestIdFromContext } from '../http-auth/errors';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { attachBuyerChatScreenshot } from './command';

const BODY_LIMIT_BYTES = 2048;

export function registerBuyerChatScreenshotRoutes(app: Hono<any>): void {
  app.post(
    BUYER_ORDER_CHAT_SCREENSHOT_HTTP_PATHS.staffAttach,
    withErrors(attachScreenshot),
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
  const request: StaffAttachBuyerChatScreenshotRequest = {
    file_object_id: body['file_object_id'],
    expected_file_version: Number(body['expected_file_version']),
  };
  const result = await attachBuyerChatScreenshot(
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
  const response: StaffAttachBuyerChatScreenshotResponseDto = {
    chat_screenshot: result,
  };
  return success(context, response, result.replayed ? 200 : 201);
}

function withErrors(
  handler: (context: Context<any>) => Promise<Response>,
) {
  return async (context: Context<any>): Promise<Response> => {
    try {
      return await handler(context);
    } catch (error) {
      const normalized = error instanceof FileStorageError
        ? error
        : new FileStorageError('DEPENDENCY_UNAVAILABLE', 503);
      context.header('Cache-Control', 'no-store');
      return context.json(apiFailure(
        publicCode(normalized.code),
        publicMessage(normalized.code),
        requestIdFromContext(context),
      ), normalized.status);
    }
  };
}

function publicCode(
  code: string,
): 'VALIDATION_ERROR' | 'FORBIDDEN' | 'NOT_FOUND' | 'VERSION_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT' | 'REQUEST_IN_PROGRESS' | 'FILE_STORAGE_CONFLICT'
  | 'FILE_NOT_VERIFIED' | 'DEPENDENCY_UNAVAILABLE' {
  switch (code) {
    case 'VALIDATION_ERROR':
    case 'FORBIDDEN':
    case 'NOT_FOUND':
    case 'VERSION_CONFLICT':
    case 'IDEMPOTENCY_CONFLICT':
    case 'REQUEST_IN_PROGRESS':
    case 'FILE_STORAGE_CONFLICT':
    case 'FILE_NOT_VERIFIED':
      return code;
    default:
      return 'DEPENDENCY_UNAVAILABLE';
  }
}

function publicMessage(code: string): string {
  switch (code) {
    case 'VALIDATION_ERROR': return '请求参数不正确';
    case 'FORBIDDEN': return '当前账号无权执行该操作';
    case 'NOT_FOUND': return '订单不存在或不可访问';
    case 'VERSION_CONFLICT': return '文件版本已变化，请刷新后重试';
    case 'FILE_STORAGE_CONFLICT': return '该截图已挂载，请重新上传';
    case 'FILE_NOT_VERIFIED': return '截图未完成校验，请重新上传';
    case 'IDEMPOTENCY_CONFLICT': return '请求与已有操作冲突';
    case 'REQUEST_IN_PROGRESS': return '相同请求正在处理中';
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
