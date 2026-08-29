import type { ApiErrorCode } from '@ygb/contracts';
import { apiFailure, apiSuccess } from '@ygb/contracts';
import { parseIdempotencyKey, readBoundedJson } from '@ygb/domain';
import type { Context, Hono } from 'hono';
import { requestIdFromContext } from '../http-auth/errors';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import {
  addMembers,
  cancelBatch,
  confirmBatch,
  createBatch,
  exportBatchCsv,
  exportFilename,
  listBatches,
  projectSellerPortalBatch,
  projectSellerPortalDetail,
  readBatchDetail,
  removeMember,
} from './batches';
import { resolveSellerPortalActor } from '../seller-portal/actor';
import {
  authorizeSellerSettlement,
  cleanSettlementIdentifier,
  normalizeSettlementError,
  SellerSettlementError,
} from './shared';

/**
 * Stage 7.5 batch 3 routes. Staff endpoints live under the existing
 * organization-scoped prefix (owner global, seller_ops within scope; write
 * operations require SELLER_SETTLEMENT_RECORD). Seller portal members read
 * their organization's non-draft batches only; buyers never reach these
 * routes (404 from the auth layer).
 */

const BODY_LIMIT = 32 * 1024;
const DEFAULT_LIMIT = 25;

export function registerStaffBatchRoutes(app: Hono<any>): void {
  app.get('/api/staff/seller-settlements/:organizationId/batches', withErrors(listHandler));
  app.post('/api/staff/seller-settlements/:organizationId/batches', withErrors(createHandler));
  app.get('/api/staff/seller-settlements/:organizationId/batches/:batchId', withErrors(detailHandler));
  app.post(
    '/api/staff/seller-settlements/:organizationId/batches/:batchId/members',
    withErrors(addMembersHandler),
  );
  app.post(
    '/api/staff/seller-settlements/:organizationId/batches/:batchId/members/:payableId/remove',
    withErrors(removeMemberHandler),
  );
  app.post(
    '/api/staff/seller-settlements/:organizationId/batches/:batchId/confirm',
    withErrors(confirmHandler),
  );
  app.post(
    '/api/staff/seller-settlements/:organizationId/batches/:batchId/cancel',
    withErrors(cancelHandler),
  );
  app.post(
    '/api/staff/seller-settlements/:organizationId/batches/:batchId/export',
    withErrors(exportHandler),
  );
}

export function registerSellerBatchRoutes(app: Hono<any>): void {
  app.get('/api/seller-portal/settlement/batches', withErrors(sellerListHandler));
  app.get('/api/seller-portal/settlement/batches/:batchId', withErrors(sellerDetailHandler));
}

async function listHandler(context: Context<any>): Promise<Response> {
  const actor = requireAuthorization(context);
  const organizationId = organization(context);
  await authorizeSellerSettlement(context.env.DB, actor, organizationId, { viewOnly: true });
  const url = new URL(context.req.url);
  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw === null ? DEFAULT_LIMIT : Number(limitRaw);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new SellerSettlementError('VALIDATION_ERROR', 400);
  }
  const cursor = url.searchParams.get('cursor');
  if (cursor !== null && (cursor.length < 1 || cursor.length > 1000)) {
    throw new SellerSettlementError('VALIDATION_ERROR', 400);
  }
  return success(context, await listBatches(context.env.DB, organizationId, {
    limit,
    ...(cursor === null ? {} : { cursor }),
  }));
}

async function createHandler(context: Context<any>): Promise<Response> {
  const actor = requireAuthorization(context);
  const organizationId = organization(context);
  await authorizeSellerSettlement(context.env.DB, actor, organizationId);
  const body = await bodyRecord(context);
  allowedKeys(body, ['reason']);
  const reason = body['reason'] === undefined ? null : nullableReason(body['reason']);
  const result = await createBatch(
    context.env.DB,
    { sellerOrganizationId: organizationId, reason },
    command(context, actor),
  );
  return success(context, { batch: result.batch, replayed: result.replayed },
    result.replayed ? 200 : 201);
}

async function detailHandler(context: Context<any>): Promise<Response> {
  const actor = requireAuthorization(context);
  const organizationId = organization(context);
  await authorizeSellerSettlement(context.env.DB, actor, organizationId, { viewOnly: true });
  const pagination = memberPagination(context);
  return success(context, {
    batch: await readBatchDetail(
      context.env.DB,
      organizationId,
      cleanSettlementIdentifier(context.req.param('batchId')),
      pagination,
    ),
  });
}

async function addMembersHandler(context: Context<any>): Promise<Response> {
  const actor = requireAuthorization(context);
  const organizationId = organization(context);
  await authorizeSellerSettlement(context.env.DB, actor, organizationId);
  const body = await bodyRecord(context);
  exactKeys(body, ['payable_ids', 'expected_version', 'reason']);
  const payableIds = body['payable_ids'];
  if (!Array.isArray(payableIds) || payableIds.length > 100) {
    throw new SellerSettlementError('VALIDATION_ERROR', 400);
  }
  const result = await addMembers(
    context.env.DB,
    {
      batchId: cleanSettlementIdentifier(context.req.param('batchId')),
      payableIds: payableIds.map((id) => cleanSettlementIdentifier(id)),
      expectedVersion: positiveInteger(body['expected_version']),
      reason: requiredString(body['reason']),
    },
    command(context, actor),
  );
  return success(context, result, result.replayed ? 200 : 201);
}

async function removeMemberHandler(context: Context<any>): Promise<Response> {
  const actor = requireAuthorization(context);
  const organizationId = organization(context);
  await authorizeSellerSettlement(context.env.DB, actor, organizationId);
  const body = await bodyRecord(context);
  exactKeys(body, ['reason', 'expected_version']);
  const result = await removeMember(
    context.env.DB,
    {
      batchId: cleanSettlementIdentifier(context.req.param('batchId')),
      payableId: cleanSettlementIdentifier(context.req.param('payableId')),
      expectedVersion: positiveInteger(body['expected_version']),
      reason: requiredString(body['reason']),
    },
    command(context, actor),
  );
  return success(context, result, result.replayed ? 200 : 201);
}

async function confirmHandler(context: Context<any>): Promise<Response> {
  const actor = requireAuthorization(context);
  const organizationId = organization(context);
  await authorizeSellerSettlement(context.env.DB, actor, organizationId);
  const body = await bodyRecord(context);
  exactKeys(body, ['expected_version', 'reason']);
  const result = await confirmBatch(
    context.env.DB,
    {
      batchId: cleanSettlementIdentifier(context.req.param('batchId')),
      expectedVersion: positiveInteger(body['expected_version']),
      reason: requiredString(body['reason']),
    },
    command(context, actor),
  );
  return success(context, result, result.replayed ? 200 : 201);
}

async function cancelHandler(context: Context<any>): Promise<Response> {
  const actor = requireAuthorization(context);
  const organizationId = organization(context);
  await authorizeSellerSettlement(context.env.DB, actor, organizationId);
  const body = await bodyRecord(context);
  exactKeys(body, ['reason', 'expected_version']);
  const result = await cancelBatch(
    context.env.DB,
    {
      batchId: cleanSettlementIdentifier(context.req.param('batchId')),
      expectedVersion: positiveInteger(body['expected_version']),
      reason: requiredString(body['reason']),
    },
    command(context, actor),
  );
  return success(context, result, result.replayed ? 200 : 201);
}

/**
 * Stage 7.5R export: prechecked page-enumerated CSV with idempotent receipts.
 * First request streams the file; a same-key replay answers with the stored
 * receipt JSON instead of re-streaming (single audit side effect). Oversized
 * batches fail with 409 EXPORT_TOO_LARGE before any byte is sent.
 */
async function exportHandler(context: Context<any>): Promise<Response> {
  const actor = requireAuthorization(context);
  const organizationId = organization(context);
  await authorizeSellerSettlement(context.env.DB, actor, organizationId);
  const batchId = cleanSettlementIdentifier(context.req.param('batchId'));
  let expectedVersion: number | null = null;
  try {
    const body = await bodyRecord(context);
    allowedKeys(body, ['expected_version']);
    if (body['expected_version'] !== undefined) {
      expectedVersion = positiveInteger(body['expected_version']);
    }
  } catch (error) {
    if (error instanceof SellerSettlementError) throw error;
    throw new SellerSettlementError('VALIDATION_ERROR', 400);
  }
  const key = parseIdempotencyKey(context.req.header('Idempotency-Key'));
  if (!key) throw new SellerSettlementError('VALIDATION_ERROR', 400);
  const outcome = await exportBatchCsv(
    context.env.DB,
    { batchId, expectedVersion, expectedOrganizationId: organizationId },
    {
      actor,
      idempotencyKey: key,
      requestId: requestIdFromContext(context),
    },
  );
  if (outcome.kind === 'REPLAY') {
    return success(context, { receipt: outcome.receipt });
  }
  context.header('Cache-Control', 'no-store');
  context.header('Content-Type', 'text/csv; charset=utf-8');
  context.header(
    'Content-Disposition',
    `attachment; filename="${exportFilename(batchId)}"`,
  );
  context.header('X-Export-Row-Count', String(outcome.receipt.row_count));
  context.header('X-Export-Sha256', outcome.receipt.sha256);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of outcome.chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return context.body(stream);
}

async function sellerListHandler(context: Context<any>): Promise<Response> {
  const actor = await requireSellerActor(context);
  const url = new URL(context.req.url);
  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw === null ? DEFAULT_LIMIT : Number(limitRaw);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new SellerSettlementError('VALIDATION_ERROR', 400);
  }
  const cursor = url.searchParams.get('cursor');
  // DRAFT/CANCELLED batches are internal working state: filtered inside the
  // keyset SQL (7.5R) so pagination never leaks them or stalls the cursor.
  const page = await listBatches(context.env.DB, actor.sellerOrganizationId, {
    limit,
    visibleOnly: true,
    ...(cursor === null ? {} : { cursor }),
  });
  return success(context, {
    batches: page.batches.map(projectSellerPortalBatch),
    next_cursor: page.next_cursor,
  });
}

async function sellerDetailHandler(context: Context<any>): Promise<Response> {
  const actor = await requireSellerActor(context);
  const detail = await readBatchDetail(
    context.env.DB,
    actor.sellerOrganizationId,
    cleanSettlementIdentifier(context.req.param('batchId')),
    memberPagination(context),
  );
  return success(context, { batch: projectSellerPortalDetail(detail) });
}

function memberPagination(context: Context<any>): { limit?: number; cursor?: string | null } {
  const url = new URL(context.req.url);
  const limitRaw = url.searchParams.get('members_limit');
  const cursorRaw = url.searchParams.get('members_cursor');
  let limit: number | undefined;
  if (limitRaw !== null) {
    limit = Number(limitRaw);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new SellerSettlementError('VALIDATION_ERROR', 400);
    }
  }
  if (cursorRaw !== null && (cursorRaw.length < 1 || cursorRaw.length > 1000)) {
    throw new SellerSettlementError('VALIDATION_ERROR', 400);
  }
  return {
    ...(limit === undefined ? {} : { limit }),
    ...(cursorRaw === null ? {} : { cursor: cursorRaw }),
  };
}

function requireAuthorization(context: Context<any>): AssignmentStaffAuthorization {
  const authorization = context.get('staffAuthorization') as
    | AssignmentStaffAuthorization
    | null
    | undefined;
  if (!authorization) {
    throw new SellerSettlementError('UNAUTHENTICATED', 401);
  }
  return authorization;
}

interface SellerPortalActorContext {
  sellerOrganizationId: string;
}

async function requireSellerActor(
  context: Context<any>,
): Promise<SellerPortalActorContext> {
  const actor = await resolveSellerPortalActor(context);
  if (actor.role !== 'OWNER' && actor.role !== 'FINANCE') {
    throw new SellerSettlementError('NOT_FOUND', 404);
  }
  return { sellerOrganizationId: actor.sellerOrganizationId };
}

function command(context: Context<any>, actor: AssignmentStaffAuthorization) {
  const key = parseIdempotencyKey(context.req.header('Idempotency-Key'));
  if (!key) throw new SellerSettlementError('VALIDATION_ERROR', 400);
  return {
    actor,
    idempotencyKey: key,
    requestId: requestIdFromContext(context),
  };
}

function organization(context: Context<any>): string {
  return cleanSettlementIdentifier(context.req.param('organizationId'));
}

async function bodyRecord(context: Context<any>): Promise<Record<string, unknown>> {
  const raw = context.req.raw.body === null ? '{}' : null;
  if (raw !== null) {
    return {};
  }
  const value = await readBoundedJson(context.req.raw, BODY_LIMIT);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SellerSettlementError('VALIDATION_ERROR', 400);
  }
  return value as Record<string, unknown>;
}

function exactKeys(body: Record<string, unknown>, keys: readonly string[]): void {
  allowedKeys(body, keys);
  if (keys.some((key) => !Object.hasOwn(body, key))) {
    throw new SellerSettlementError('VALIDATION_ERROR', 400);
  }
}

function allowedKeys(body: Record<string, unknown>, keys: readonly string[]): void {
  const allowed = new Set(keys);
  if (Object.keys(body).some((key) => !allowed.has(key))) {
    throw new SellerSettlementError('VALIDATION_ERROR', 400);
  }
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length < 1) {
    throw new SellerSettlementError('VALIDATION_ERROR', 400);
  }
  return value;
}

function nullableReason(value: unknown): string | null {
  if (value === null) return null;
  return requiredString(value);
}

function positiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new SellerSettlementError('VALIDATION_ERROR', 400);
  }
  return Number(value);
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
      const normalized = normalizeSettlementError(error);
      const code = normalized.code as ApiErrorCode;
      const message = code === 'FORBIDDEN'
          ? '无权执行该操作'
          : code === 'NOT_FOUND'
            ? '资源不存在'
            : code === 'VALIDATION_ERROR'
              ? '请求参数不正确'
              : code === 'VERSION_CONFLICT'
                ? '数据已发生变化，请刷新后重试'
                : code === 'IDEMPOTENCY_CONFLICT'
                  ? '幂等键与原请求不一致'
                  : '当前结算状态无法执行该操作';
      context.header('Cache-Control', 'no-store');
      return context.json(
        apiFailure(code, message, requestIdFromContext(context)),
        normalized.status,
      );
    }
  };
}
