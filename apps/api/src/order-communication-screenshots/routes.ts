import {
  ORDER_COMMUNICATION_SCREENSHOT_HTTP_PATHS,
  apiFailure,
  apiSuccess,
  type AttachOrderCommunicationScreenshotRequest,
  type FileUploadDescriptor,
  type SellerOrderCommunicationScreenshotReadIntentRequest,
  type StaffOrderCommunicationScreenshotListDto,
} from '@ygb/contracts';
import { parseIdempotencyKey, readBoundedJson } from '@ygb/domain';
import type { Context, Hono } from 'hono';
import { createFileUploadIntent } from '../files/create-upload-intent';
import { createFileReadIntent } from '../files/file-read-service';
import { FileStorageError } from '../files/file-error';
import { cleanFileIdentifier } from '../files/file-records';
import { DenyAllFileAuthorizationService } from '../files/authorization';
import { requestIdFromContext } from '../http-auth/errors';
import { customerSessionMiddleware } from '../middleware/customer-auth';
import { customerAuthOriginGuard } from '../middleware/origin-guard';
import {
  resolveStaffDataScope,
  scopeAllowsSellerOrganization,
  type AssignmentStaffAuthorization,
} from '../staff-assignment';
import { resolveSellerPortalActor } from '../seller-portal/actor';
import {
  SellerFormalOrderPortalError,
  normalizeSellerFormalOrderPortalError,
} from '../seller-formal-orders/errors';
import type { SqlDatabase } from '@ygb/contracts';
import { attachOrderCommunicationScreenshot } from './command';
import {
  listOrderCommunicationScreenshots,
  requireOrderCommunicationScreenshotForSeller,
} from './read-model';

const BODY_LIMIT_BYTES = 2048;
const DENY_ALL = new DenyAllFileAuthorizationService();

interface FormalOrderScopeRow {
  seller_organization_id: string;
}

export function registerOrderCommunicationScreenshotRoutes(app: Hono<any>): void {
  app.post(
    ORDER_COMMUNICATION_SCREENSHOT_HTTP_PATHS.staffIntents,
    withErrors(createIntent),
  );
  app.post(
    ORDER_COMMUNICATION_SCREENSHOT_HTTP_PATHS.staffAttach,
    withErrors(attachScreenshot),
  );
  app.get(
    ORDER_COMMUNICATION_SCREENSHOT_HTTP_PATHS.staffList,
    withErrors(listScreenshots),
  );
  app.get(
    ORDER_COMMUNICATION_SCREENSHOT_HTTP_PATHS.sellerList,
    customerAuthOriginGuard(),
    customerSessionMiddleware(),
    withErrors(listForSeller),
  );
  app.post(
    ORDER_COMMUNICATION_SCREENSHOT_HTTP_PATHS.sellerReadIntent,
    customerAuthOriginGuard(),
    customerSessionMiddleware(),
    withErrors(createReadIntent),
  );
}

async function createIntent(context: Context<any>): Promise<Response> {
  const actor = requireActor(context);
  await requireFormalOrderInScope(context.env.DB, actor, context.req.param('id'));
  const body = await readBoundedJson(context.req.raw, BODY_LIMIT_BYTES);
  const files = body?.['files'];
  if (!Array.isArray(files) || files.length < 1 || files.length > 8) {
    throw new FileStorageError('VALIDATION_ERROR', 400);
  }
  const descriptors: FileUploadDescriptor[] = [];
  for (const descriptor of files) {
    if (!descriptor || typeof descriptor !== 'object') {
      throw new FileStorageError('VALIDATION_ERROR', 400);
    }
    const record = descriptor as Record<string, unknown>;
    if (
      typeof record['client_file_name'] !== 'string'
      || typeof record['extension'] !== 'string'
      || typeof record['declared_mime'] !== 'string'
      || !Number.isSafeInteger(record['byte_size'])
    ) {
      throw new FileStorageError('VALIDATION_ERROR', 400);
    }
    descriptors.push({
      clientFileName: record['client_file_name'],
      declaredMime: record['declared_mime'] as FileUploadDescriptor['declaredMime'],
      byteSize: Number(record['byte_size']),
    });
  }
  const result = await createFileUploadIntent(
    context.env.DB,
    DENY_ALL,
    {
      purpose: 'ORDER_COMMUNICATION_SCREENSHOT',
      visibility: 'SELLER_VISIBLE',
      files: descriptors,
    },
    {
      actor: {
        type: 'STAFF',
        id: actor.staffId,
        roles: [...actor.roles],
      },
      idempotencyKey: idempotencyKey(context),
      requestId: requestIdFromContext(context),
    },
  );
  context.header('Cache-Control', 'no-store');
  return context.json(apiSuccess({
    upload_intent_id: result.uploadIntentId,
    purpose: result.purpose,
    visibility: result.visibility,
    status: result.status,
    version: result.version,
    expires_at: result.expiresAt,
    uploads: result.uploads.map((slot) => ({
      file_object_id: slot.fileObjectId,
      slot_no: slot.slotNo,
      upload_token: slot.uploadToken,
      upload_token_available: slot.uploadTokenAvailable,
      expires_at: slot.expiresAt,
    })),
    replayed: result.replayed,
  }, requestIdFromContext(context)), result.replayed ? 200 : 201);
}

async function attachScreenshot(context: Context<any>): Promise<Response> {
  const actor = requireActor(context);
  const body = await readBoundedJson(context.req.raw, BODY_LIMIT_BYTES);
  if (!body || Object.keys(body).length !== 2
    || typeof body['file_object_id'] !== 'string'
    || !Number.isSafeInteger(body['expected_file_version'])
    || Number(body['expected_file_version']) < 1) {
    throw new FileStorageError('VALIDATION_ERROR', 400);
  }
  const request: AttachOrderCommunicationScreenshotRequest = {
    file_object_id: body['file_object_id'],
    expected_file_version: Number(body['expected_file_version']),
  };
  const result = await attachOrderCommunicationScreenshot(
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
  context.header('Cache-Control', 'no-store');
  return context.json(apiSuccess(
    { screenshot: result },
    requestIdFromContext(context),
  ), result.replayed ? 200 : 201);
}

async function listScreenshots(context: Context<any>): Promise<Response> {
  const actor = requireActor(context);
  const orderId = await requireFormalOrderInScope(
    context.env.DB,
    actor,
    context.req.param('id'),
  );
  const screenshots = await listOrderCommunicationScreenshots(
    context.env.DB,
    [orderId.formalOrderId],
  );
  const dto: StaffOrderCommunicationScreenshotListDto = {
    formal_order_id: orderId.formalOrderId,
    seller_organization_id: orderId.sellerOrganizationId,
    screenshots: Object.freeze(screenshots.get(orderId.formalOrderId) ?? []),
  };
  context.header('Cache-Control', 'no-store');
  return context.json(apiSuccess(dto, requestIdFromContext(context)));
}

async function listForSeller(context: Context<any>): Promise<Response> {
  const actor = await resolveSellerPortalActor(context).catch((error) => {
    const code = (error as { code?: unknown })?.code;
    if (code === 'FORBIDDEN' || code === 'SESSION_INVALID') {
      throw new SellerFormalOrderPortalError('FORMAL_ORDER_NOT_FOUND', 404);
    }
    throw error;
  });
  const orderId = identifier(context.req.param('id'));
  const order = (await context.env.DB
    .prepare(
      `SELECT seller_organization_id FROM formal_orders
      WHERE id=? AND seller_organization_id=?`,
    )
    .bind(orderId, actor.sellerOrganizationId)
    .first()) as { seller_organization_id: string } | null;
  if (!order) throw new SellerFormalOrderPortalError('FORMAL_ORDER_NOT_FOUND', 404);
  const screenshots = await listOrderCommunicationScreenshots(context.env.DB, [orderId]);
  context.header('Cache-Control', 'no-store');
  return context.json(apiSuccess({
    formal_order_id: orderId,
    screenshots: Object.freeze(screenshots.get(orderId) ?? []),
  }, requestIdFromContext(context)));
}

async function createReadIntent(context: Context<any>): Promise<Response> {
  const actor = await resolveSellerPortalActor(context).catch((error) => {
    const code = (error as { code?: unknown })?.code;
    if (code === 'FORBIDDEN' || code === 'SESSION_INVALID') {
      throw new SellerFormalOrderPortalError('FORMAL_ORDER_NOT_FOUND', 404);
    }
    throw error;
  });
  const access = await requireOrderCommunicationScreenshotForSeller(
    context.env.DB,
    actor,
    identifier(context.req.param('id')),
    identifier(context.req.param('fileObjectId')),
  );
  const body = await readBoundedJson(context.req.raw, BODY_LIMIT_BYTES);
  if (!body || Object.keys(body).length !== 1
    || !Number.isSafeInteger(body['expected_file_version'])
    || Number(body['expected_file_version']) < 1) {
    throw new SellerFormalOrderPortalError('VALIDATION_ERROR', 400);
  }
  const request: SellerOrderCommunicationScreenshotReadIntentRequest = {
    expected_file_version: Number(body['expected_file_version']),
  };
  if (request.expected_file_version !== access.fileVersion) {
    throw new SellerFormalOrderPortalError('VERSION_CONFLICT', 409);
  }
  try {
    const result = await createFileReadIntent(
      context.env.DB,
      DENY_ALL,
      {
        fileObjectId: access.fileObjectId,
        fileEntityLinkId: access.fileEntityLinkId,
        expectedFileVersion: request.expected_file_version,
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
    context.header('Cache-Control', 'no-store');
    return context.json(apiSuccess({
      read_intent_id: result.readIntentId,
      access_token: result.accessToken,
      access_token_available: result.accessTokenAvailable,
      expires_at: result.expiresAt,
      replayed: result.replayed,
    }, requestIdFromContext(context)), result.replayed ? 200 : 201);
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

function requireActor(context: Context<any>): AssignmentStaffAuthorization {
  const actor = context.get('staffAuthorization') as
    | AssignmentStaffAuthorization
    | null
    | undefined;
  if (!actor || actor.staffStatus !== 'ACTIVE') {
    throw new FileStorageError('FORBIDDEN', 403);
  }
  return actor;
}

async function requireFormalOrderInScope(
  database: SqlDatabase,
  actor: AssignmentStaffAuthorization,
  rawId: unknown,
): Promise<{ formalOrderId: string; sellerOrganizationId: string }> {
  const orderId = identifier(rawId);
  const row = await database
    .prepare(`SELECT seller_organization_id FROM formal_orders WHERE id=?`)
    .bind(orderId)
    .first<FormalOrderScopeRow>();
  if (!row) throw new FileStorageError('NOT_FOUND', 404);
  const scope = await resolveStaffDataScope(database, actor, {
    requiredPermission: 'ORDER_VIEW',
  });
  if (!scopeAllowsSellerOrganization(scope, row.seller_organization_id)) {
    throw new FileStorageError('NOT_FOUND', 404);
  }
  return {
    formalOrderId: orderId,
    sellerOrganizationId: row.seller_organization_id,
  };
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
          ? error
          : await normalizeSellerPortalOrDependency(error);
      context.header('Cache-Control', 'no-store');
      return context.json(apiFailure(
        publicCode(normalized.code),
        publicMessage(normalized.code),
        requestIdFromContext(context),
      ), normalized.status);
    }
  };
}

async function normalizeSellerPortalOrDependency(
  error: unknown,
): Promise<FileStorageError | SellerFormalOrderPortalError> {
  try {
    return await normalizeSellerFormalOrderPortalError(error);
  } catch {
    return new FileStorageError('DEPENDENCY_UNAVAILABLE', 503);
  }
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

function identifier(value: unknown): string {
  if (typeof value !== 'string') throw new FileStorageError('VALIDATION_ERROR', 400);
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length < 1 || normalized.length > 120
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new FileStorageError('VALIDATION_ERROR', 400);
  }
  return cleanFileIdentifier(normalized, 120);
}

function idempotencyKey(context: Context<any>): string {
  const value = parseIdempotencyKey(context.req.header('Idempotency-Key'));
  if (!value) throw new FileStorageError('VALIDATION_ERROR', 400);
  return value;
}
