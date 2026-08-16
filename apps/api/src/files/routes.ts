import {
  apiFailure,
  apiSuccess,
  FILE_HTTP_PURPOSE_ROUTES,
  type ApiErrorCode,
  type FileActor,
  type FilePurpose,
  type FileReadPrincipal,
  type FileUploadDescriptor,
  type FileVisibility,
  type ObjectStorageAdapter,
  type StaffDataScope,
} from '@ygb/contracts';
import type { Context, Hono, MiddlewareHandler } from 'hono';
import type { AppEnv } from '../app';
import type { CustomerSessionContext } from '../customer-auth/authenticate-customer';
import {
  customerSessionMiddleware,
  requireCustomerSessionFromContext,
} from '../middleware/customer-auth';
import { resolveSellerPortalActor } from '../seller-portal/actor';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { driveArchiveRuntime } from '../cold-image-archive/runtime';
import {
  completeFileUploadIntent,
  consumeFileReadIntent,
  createFileReadIntent,
  createFileUploadIntent,
  FileStorageError,
  normalizeFileStorageError,
  uploadFileObject,
} from './index';
import { RouteBoundFileAuthorizationService } from './route-authorization';

const BUYER_UPLOADS = new Map<FilePurpose, FileVisibility>([
  ['ORDER_EVIDENCE', 'BUYER_VISIBLE'],
  ['REVIEW_EVIDENCE', 'SELLER_VISIBLE'],
]);
const SELLER_UPLOADS = new Map<FilePurpose, FileVisibility>([
  ['PRODUCT_APPLICATION_IMAGE', 'SELLER_VISIBLE'],
]);
const NO_UPLOADS = new Map<FilePurpose, FileVisibility>();
const STAFF_UPLOADS = new Map<FilePurpose, FileVisibility>([
  ['BUYER_REFUND_PROOF', 'INTERNAL_ONLY'],
  ['SELLER_SETTLEMENT_PROOF', 'INTERNAL_ONLY'],
  ['ORDER_EVIDENCE_INTERNAL_COMMUNICATION', 'SELLER_VISIBLE'],
  ['PRODUCT_IMAGE', 'SELLER_VISIBLE'],
]);
const JSON_BODY_MAX_BYTES = 16 * 1024;
const MULTIPART_BODY_MAX_BYTES = 26 * 1024 * 1024;

export function registerFileHttpRoutes(app: Hono<AppEnv>): void {
  const customerSession = customerSessionMiddleware();

  registerIntentRoute(
    app,
    FILE_HTTP_PURPOSE_ROUTES.buyerOrderEvidence.path,
    customerSession,
    'BUYER',
    'ORDER_EVIDENCE',
    'BUYER_VISIBLE',
  );
  registerIntentRoute(
    app,
    FILE_HTTP_PURPOSE_ROUTES.buyerReviewEvidence.path,
    customerSession,
    'BUYER',
    'REVIEW_EVIDENCE',
    'SELLER_VISIBLE',
  );
  registerIntentRoute(
    app,
    FILE_HTTP_PURPOSE_ROUTES.sellerProductApplicationImage.path,
    customerSession,
    'SELLER',
    'PRODUCT_APPLICATION_IMAGE',
    'SELLER_VISIBLE',
  );
  registerIntentRoute(
    app,
    FILE_HTTP_PURPOSE_ROUTES.staffBuyerRefundProof.path,
    undefined,
    'STAFF',
    'BUYER_REFUND_PROOF',
    'INTERNAL_ONLY',
  );
  registerIntentRoute(
    app,
    FILE_HTTP_PURPOSE_ROUTES.staffSellerSettlementProof.path,
    undefined,
    'STAFF',
    'SELLER_SETTLEMENT_PROOF',
    'INTERNAL_ONLY',
  );
  registerIntentRoute(
    app,
    FILE_HTTP_PURPOSE_ROUTES.staffSellerOrderChatScreenshot.path,
    undefined,
    'STAFF',
    'ORDER_EVIDENCE_INTERNAL_COMMUNICATION',
    'SELLER_VISIBLE',
  );

  registerLifecycleRoutes(app, 'BUYER', '/api/buyer-portal', customerSession);
  registerLifecycleRoutes(app, 'SELLER', '/api/seller-portal', customerSession);
  registerLifecycleRoutes(app, 'STAFF', '/api/staff');
}

function registerIntentRoute(
  app: Hono<AppEnv>,
  path: string,
  middleware: MiddlewareHandler<AppEnv> | undefined,
  domain: ActorDomain,
  purpose: FilePurpose,
  visibility: FileVisibility,
): void {
  const handler = withFileErrors(async (context) => {
    const authority = await resolveRouteAuthority(context, domain);
    const body = await readIntentBody(context);
    const result = await createFileUploadIntent(
      context.env.DB,
      authorization(context, authority),
      { purpose, visibility, files: body['files'] },
      {
        actor: authority.actor,
        idempotencyKey: requireIdempotencyKey(context),
        requestId: requestId(context),
      },
    );
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
    }, requestId(context)));
  });
  if (middleware) app.post(path, middleware, handler);
  else app.post(path, handler);
}

function registerLifecycleRoutes(
  app: Hono<AppEnv>,
  domain: ActorDomain,
  prefix: string,
  middleware?: MiddlewareHandler<AppEnv>,
): void {
  const upload = withFileErrors(async (context) => {
    const authority = await resolveRouteAuthority(context, domain);
    const file = await readSingleMultipartFile(context);
    const result = await uploadFileObject(
      context.env.DB,
      requireObjectStorage(context),
      authorization(context, authority),
      {
        fileObjectId: requiredIdentifier(context.req.param('fileObjectId')),
        uploadToken: requireBoundedHeader(context, 'X-Upload-Token', 32, 512),
        declaredMime: file.type,
        bytes: new Uint8Array(await file.arrayBuffer()),
      },
      {
        actor: authority.actor,
        idempotencyKey: requireIdempotencyKey(context),
        requestId: requestId(context),
      },
    );
    return context.json(apiSuccess({
      file_object_id: result.fileObjectId,
      upload_intent_id: result.uploadIntentId,
      status: result.status,
      detected_mime: result.detectedMime,
      byte_size: result.byteSize,
      sha256: result.sha256,
      version: result.version,
      replayed: result.replayed,
    }, requestId(context)));
  });

  const complete = withFileErrors(async (context) => {
    const authority = await resolveRouteAuthority(context, domain);
    const body = await readExactObject(context, new Set(['expected_version']));
    const result = await completeFileUploadIntent(
      context.env.DB,
      requireObjectStorage(context),
      authorization(context, authority),
      {
        uploadIntentId: requiredIdentifier(context.req.param('id')),
        expectedVersion: positiveSafeInteger(body['expected_version']),
      },
      {
        actor: authority.actor,
        idempotencyKey: requireIdempotencyKey(context),
        requestId: requestId(context),
      },
    );
    return context.json(apiSuccess({
      upload_intent_id: result.uploadIntentId,
      status: result.status,
      version: result.version,
      files: result.files.map((file) => ({
        file_object_id: file.fileObjectId,
        purpose: file.purpose,
        visibility: file.visibility,
        detected_mime: file.detectedMime,
        byte_size: file.verifiedByteSize,
        sha256: file.sha256,
        version: file.version,
      })),
      replayed: result.replayed,
    }, requestId(context)));
  });

  const readIntent = withFileErrors(async (context) => {
    const authority = await resolveRouteAuthority(context, domain);
    const body = await readExactObject(
      context,
      new Set(['expected_file_version']),
    );
    const fileObjectId = requiredIdentifier(context.req.param('fileObjectId'));
    const fileEntityLinkId = await resolveFileEntityLinkId(
      context,
      fileObjectId,
    );
    const result = await createFileReadIntent(
      context.env.DB,
      authorization(context, authority),
      {
        fileObjectId,
        ...(fileEntityLinkId === undefined ? {} : { fileEntityLinkId }),
        expectedFileVersion: positiveSafeInteger(body['expected_file_version']),
      },
      {
        actor: authority.actor,
        principal: authority.principal,
        idempotencyKey: requireIdempotencyKey(context),
        requestId: requestId(context),
      },
    );
    return context.json(apiSuccess({
      read_intent_id: result.readIntentId,
      file_object_id: result.fileObjectId,
      access_token: result.accessToken,
      access_token_available: result.accessTokenAvailable,
      expires_at: result.expiresAt,
      replayed: result.replayed,
    }, requestId(context)));
  }, { concealCustomerRead: domain !== 'STAFF' });

  const readContent = withFileErrors(async (context) => {
    const authority = await resolveRouteAuthority(context, domain);
    const driveRuntime=driveArchiveRuntime(context.env);
    const result = await consumeFileReadIntent(
      context.env.DB,
      requireObjectStorage(context),
      authorization(context, authority),
      {
        readIntentId: requiredIdentifier(context.req.param('id')),
        accessToken: requireBoundedHeader(
          context,
          'X-File-Read-Token',
          32,
          512,
        ),
      },
      { actor: authority.actor, principal: authority.principal },
      {
        adapter: driveRuntime.adapter,
        proxyReadEnabled: driveRuntime.enabled && driveRuntime.proxyReadEnabled,
      },
    );
    return new Response(result.bytes, {
      status: 200,
      headers: {
        'Content-Type': result.contentType,
        'Content-Length': String(result.bytes.byteLength),
        'Cache-Control': 'no-store',
        'Content-Disposition': 'inline',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }, { concealCustomerRead: domain !== 'STAFF' });

  addRoute(app, 'put', `${prefix}/file-uploads/:fileObjectId/content`, middleware, upload);
  addRoute(app, 'post', `${prefix}/file-upload-intents/:id/complete`, middleware, complete);
  addRoute(app, 'post', `${prefix}/files/:fileObjectId/read-intents`, middleware, readIntent);
  addRoute(app, 'get', `${prefix}/file-read-intents/:id/content`, middleware, readContent);
}

type ActorDomain = 'BUYER' | 'SELLER' | 'STAFF';
interface RouteAuthority {
  actor: FileActor;
  principal: FileReadPrincipal;
  allowedUploads: ReadonlyMap<FilePurpose, FileVisibility>;
  staffAuthorization?: AssignmentStaffAuthorization;
  staffDataScope?: StaffDataScope;
}

async function resolveRouteAuthority(
  context: Context<AppEnv>,
  domain: ActorDomain,
): Promise<RouteAuthority> {
  if (domain === 'STAFF') {
    const staff = context.get('staffAuthorization') as
      | AssignmentStaffAuthorization
      | undefined;
    const scope = context.get('staffDataScope') as StaffDataScope | undefined;
    if (!staff || !scope) throw new FileStorageError('FORBIDDEN', 403);
    return {
      actor: { type: 'STAFF', id: staff.staffId, roles: [...staff.roles] },
      principal: { type: 'STAFF_SESSION', staffId: staff.staffId },
      allowedUploads: STAFF_UPLOADS,
      staffAuthorization: staff,
      staffDataScope: scope,
    };
  }

  const session = requireCustomerSessionFromContext(context);
  if (domain === 'BUYER') {
    if (session.accountType !== 'BUYER') denyNotFound();
    const row = await context.env.DB.prepare(`
      SELECT id FROM buyer_customers
      WHERE identity_subject_id=? AND access_status='ACTIVE'
    `).bind(session.identitySubjectId).first<{ id: string }>();
    if (!row) denyNotFound();
    return {
      actor: { type: 'BUYER_CUSTOMER', id: row.id, roles: [] },
      principal: customerPrincipal(session, 'BUYER_SESSION'),
      allowedUploads: BUYER_UPLOADS,
    };
  }

  if (session.accountType !== 'SELLER_MEMBER') denyNotFound();
  let seller: Awaited<ReturnType<typeof resolveSellerPortalActor>>;
  try {
    seller = await resolveSellerPortalActor(context);
  } catch (error) {
    const status = (error as { status?: unknown })?.status;
    if (status === 401 || status === 403 || status === 404) denyNotFound();
    throw error;
  }
  return {
    actor: {
      type: 'SELLER_MEMBER',
      id: seller.memberId,
      roles: [seller.role],
    },
    principal: {
      type: 'SELLER_SESSION',
      accountId: seller.accountId,
      identitySubjectId: seller.identitySubjectId,
    },
    allowedUploads: seller.role === 'OWNER' || seller.role === 'OPERATIONS'
      ? SELLER_UPLOADS
      : NO_UPLOADS,
  };
}

function customerPrincipal(
  session: CustomerSessionContext,
  type: 'BUYER_SESSION' | 'SELLER_SESSION',
): FileReadPrincipal {
  return {
    type,
    accountId: session.accountId,
    identitySubjectId: session.identitySubjectId,
  } as FileReadPrincipal;
}

function authorization(
  context: Context<AppEnv>,
  authority: RouteAuthority,
): RouteBoundFileAuthorizationService {
  return new RouteBoundFileAuthorizationService(
    context.env.DB,
    authority.actor,
    authority.allowedUploads,
    authority.principal,
    authority.staffAuthorization,
    authority.staffDataScope,
  );
}

async function resolveFileEntityLinkId(
  context: Context<AppEnv>,
  fileObjectId: string,
): Promise<string | undefined> {
  const result = await context.env.DB.prepare(`
    SELECT id, authorization_mode
    FROM file_entity_links
    WHERE file_object_id=?
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at>?)
    ORDER BY CASE authorization_mode
      WHEN 'LEGACY_VISIBILITY' THEN 0 ELSE 1 END,
      created_at, id
    LIMIT 1
  `).bind(fileObjectId, Date.now()).first<{
    id: string;
    authorization_mode: 'LEGACY_VISIBILITY' | 'EXPLICIT_AUDIENCES';
  }>();
  if (!result) throw new FileStorageError('FILE_NOT_VERIFIED', 409);
  return result.authorization_mode === 'LEGACY_VISIBILITY'
    ? undefined
    : result.id;
}

async function readIntentBody(context: Context<AppEnv>): Promise<{
  files: readonly FileUploadDescriptor[];
}> {
  const body = await readExactObject(context, new Set(['files']));
  if (!Array.isArray(body['files']) || body['files'].length < 1 || body['files'].length > 10) {
    throw new FileStorageError('VALIDATION_ERROR', 400);
  }
  return {
    files: body['files'].map((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new FileStorageError('VALIDATION_ERROR', 400);
      }
      const record = value as Record<string, unknown>;
      assertExactKeys(
        record,
        new Set(['client_file_name', 'extension', 'declared_mime', 'byte_size']),
      );
      const clientFileName = requiredText(record['client_file_name'], 255);
      const extension = requiredText(record['extension'], 10).toLowerCase();
      if (!clientFileName.toLowerCase().endsWith(`.${extension}`)) {
        throw new FileStorageError('VALIDATION_ERROR', 400);
      }
      return {
        clientFileName,
        declaredMime: requiredText(record['declared_mime'], 100).toLowerCase(),
        byteSize: positiveSafeInteger(record['byte_size']),
      };
    }),
  };
}

async function readSingleMultipartFile(context: Context<AppEnv>): Promise<File> {
  const contentType = context.req.header('Content-Type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data;')) {
    throw new FileStorageError('VALIDATION_ERROR', 400);
  }
  const contentLength = context.req.header('Content-Length');
  if (contentLength && (!/^\d+$/u.test(contentLength)
    || Number(contentLength) > MULTIPART_BODY_MAX_BYTES)) {
    throw new FileStorageError('VALIDATION_ERROR', 400);
  }
  const formData = await context.req.formData().catch(() => null);
  if (!formData) throw new FileStorageError('VALIDATION_ERROR', 400);
  const keys = [...new Set(formData.keys())];
  if (keys.length !== 1 || keys[0] !== 'file') {
    throw new FileStorageError('VALIDATION_ERROR', 400);
  }
  const values = formData.getAll('file');
  if (values.length !== 1 || typeof values[0] === 'string') {
    throw new FileStorageError('VALIDATION_ERROR', 400);
  }
  const file = values[0] as File;
  if (file.size < 1 || file.size > MULTIPART_BODY_MAX_BYTES
    || file.name.length < 1 || file.name.length > 255
    || file.type.length < 1 || file.type.length > 100) {
    throw new FileStorageError('VALIDATION_ERROR', 400);
  }
  return file;
}

async function readExactObject(
  context: Context<AppEnv>,
  allowedKeys: ReadonlySet<string>,
): Promise<Record<string, unknown>> {
  const contentType = context.req.header('Content-Type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new FileStorageError('VALIDATION_ERROR', 400);
  }
  const length = context.req.header('Content-Length');
  if (length && (!/^\d+$/u.test(length)
    || Number(length) > JSON_BODY_MAX_BYTES)) {
    throw new FileStorageError('VALIDATION_ERROR', 400);
  }
  const text = await context.req.text();
  if (new TextEncoder().encode(text).byteLength > JSON_BODY_MAX_BYTES) {
    throw new FileStorageError('VALIDATION_ERROR', 400);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new FileStorageError('VALIDATION_ERROR', 400);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new FileStorageError('VALIDATION_ERROR', 400);
  }
  const record = value as Record<string, unknown>;
  assertExactKeys(record, allowedKeys);
  return record;
}

function assertExactKeys(
  record: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
): void {
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      throw new FileStorageError('VALIDATION_ERROR', 400);
    }
  }
}

function withFileErrors(
  handler: (context: Context<AppEnv>) => Promise<Response>,
  options: { concealCustomerRead?: boolean } = {},
) {
  return async (context: Context<AppEnv>): Promise<Response> => {
    try {
      return await handler(context);
    } catch (error) {
      const source = normalizeFileStorageError(error);
      const normalized = options.concealCustomerRead
        && shouldConcealCustomerReadError(source)
        ? new FileStorageError('NOT_FOUND', 404)
        : source;
      const code = toApiCode(normalized.code);
      return context.json(
        apiFailure(code, code, requestId(context)),
        normalized.status,
      );
    }
  };
}

function shouldConcealCustomerReadError(error: FileStorageError): boolean {
  return error.code === 'FORBIDDEN'
    || error.code === 'NOT_FOUND'
    || error.code === 'FILE_INTENT_NOT_FOUND'
    || error.code === 'FILE_OBJECT_NOT_FOUND'
    || error.code === 'FILE_NOT_VERIFIED'
    || error.code === 'FILE_READ_INTENT_NOT_FOUND';
}

function toApiCode(code: FileStorageError['code']): ApiErrorCode {
  return code;
}

function requireObjectStorage(context: Context<AppEnv>): ObjectStorageAdapter {
  const value = context.env.FILE_OBJECT_STORAGE as
    | Partial<ObjectStorageAdapter>
    | undefined;
  if (!value
    || typeof value.putObject !== 'function'
    || typeof value.headObject !== 'function'
    || typeof value.readObject !== 'function'
    || typeof value.deleteObject !== 'function') {
    throw new FileStorageError('DEPENDENCY_UNAVAILABLE', 503);
  }
  return value as ObjectStorageAdapter;
}

function requireIdempotencyKey(context: Context<AppEnv>): string {
  return requireBoundedHeader(context, 'Idempotency-Key', 8, 128);
}

function requireBoundedHeader(
  context: Context<AppEnv>,
  name: string,
  minimum: number,
  maximum: number,
): string {
  const value = context.req.header(name)?.trim() ?? '';
  if (value.length < minimum || value.length > maximum
    || value.includes(',')
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new FileStorageError('VALIDATION_ERROR', 400);
  }
  return value;
}

function requiredIdentifier(value: unknown): string {
  return requiredText(value, 120);
}

function requiredText(value: unknown, maximum: number): string {
  if (typeof value !== 'string') {
    throw new FileStorageError('VALIDATION_ERROR', 400);
  }
  const cleaned = value.trim();
  if (cleaned.length < 1 || cleaned.length > maximum
    || /[\u0000-\u001f\u007f]/u.test(cleaned)) {
    throw new FileStorageError('VALIDATION_ERROR', 400);
  }
  return cleaned;
}

function positiveSafeInteger(value: unknown): number {
  if (typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value < 1) {
    throw new FileStorageError('VALIDATION_ERROR', 400);
  }
  return value;
}

function requestId(context: Context<AppEnv>): string {
  return String(context.get('requestId') ?? crypto.randomUUID());
}

function denyNotFound(): never {
  throw new FileStorageError('NOT_FOUND', 404);
}

function addRoute(
  app: Hono<AppEnv>,
  method: 'get' | 'post' | 'put',
  path: string,
  middleware: MiddlewareHandler<AppEnv> | undefined,
  handler: (context: Context<AppEnv>) => Promise<Response>,
): void {
  if (middleware) app[method](path, middleware, handler);
  else app[method](path, handler);
}
