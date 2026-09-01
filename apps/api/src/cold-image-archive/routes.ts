import {
  apiFailure,
  apiSuccess,
  isApiErrorCode,
  type ArchiveBundleStatusDto,
} from '@ygb/contracts';
import { readBoundedJson } from '@ygb/domain';
import type { Context, Hono } from 'hono';
import type { AppEnv } from '../app';
import { requirePermission } from '../staff-assignment/permission-policy';
import { ColdArchiveCommandError, recordOrderBusinessClosure, reopenOrderBusinessClosure } from './business-closure';
import { computeArchiveMetrics } from './metrics';
import { requestBundleRestore, RestoreCommandError } from './restore';

const BODY_LIMIT = 8192;
const LIST_PAGE_MAX = 100;

export function registerColdImageArchiveRoutes(app: Hono<AppEnv>): void {
  app.post('/api/staff/operations/archive/orders/:id/close', withErrors(closeOrder));
  app.post('/api/staff/operations/archive/orders/:id/reopen', withErrors(reopenOrder));
  app.post('/api/staff/operations/archive/bundles/:id/restore', withErrors(restoreBundle));
  app.get('/api/staff/operations/archive/bundles', withErrors(listBundles));
  app.get('/api/staff/operations/archive/metrics', withErrors(metrics));
}

async function closeOrder(context: Context<AppEnv>): Promise<Response> {
  const actor = requireOwner(context);
  const body = exactRecord(await readBoundedJson(context.req.raw, BODY_LIMIT),
    ['expected_version', 'not_applicable', 'reason']);
  const result = await recordOrderBusinessClosure(context.env.DB, {
    formalOrderId: context.req.param('id') ?? '',
    expectedVersion: integer(body['expected_version']),
    notApplicable: componentList(body['not_applicable']),
    reason: string(body['reason']),
  }, { actor, idempotencyKey: idempotencyKey(context), requestId: context.get('requestId') });
  return context.json(apiSuccess({ closure: result }, context.get('requestId')));
}

async function reopenOrder(context: Context<AppEnv>): Promise<Response> {
  const actor = requireOwner(context);
  const body = exactRecord(await readBoundedJson(context.req.raw, BODY_LIMIT),
    ['expected_version', 'reason']);
  const result = await reopenOrderBusinessClosure(context.env.DB, {
    formalOrderId: context.req.param('id') ?? '',
    expectedVersion: integer(body['expected_version']),
    reason: string(body['reason']),
  }, { actor, idempotencyKey: idempotencyKey(context), requestId: context.get('requestId') });
  return context.json(apiSuccess({ closure: result }, context.get('requestId')));
}

async function restoreBundle(context: Context<AppEnv>): Promise<Response> {
  const actor = requireOwner(context);
  // No request body is needed; tolerate an empty body alongside `{}`.
  const raw = await readBoundedJson(context.req.raw, BODY_LIMIT).catch(() => null);
  const bodyOk = raw === null
    || (typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      && Object.keys(raw as Record<string, unknown>).length === 0);
  if (!bodyOk) throw new ColdArchiveCommandError('VALIDATION_ERROR', 400);
  const result = await requestBundleRestore(context.env.DB, {
    bundleId: context.req.param('id') ?? '',
  }, { actor, idempotencyKey: idempotencyKey(context), requestId: context.get('requestId') });
  return context.json(apiSuccess({ restore: result }, context.get('requestId')));
}

async function listBundles(context: Context<AppEnv>): Promise<Response> {
  requireOwner(context);
  const url = new URL(context.req.raw.url);
  const limitRaw = Number(url.searchParams.get('limit') ?? '25');
  const limit = Number.isSafeInteger(limitRaw) && limitRaw >= 1 && limitRaw <= LIST_PAGE_MAX
    ? limitRaw : 25;
  const cursor = url.searchParams.get('cursor') ?? '';
  const stateFilter = url.searchParams.get('state') ?? '';
  const typeFilter = url.searchParams.get('bundle_type') ?? '';
  const params: unknown[] = [limit + 1];
  let where = '1=1';
  if (cursor !== '') {
    where += ' AND bundle.id>?';
    params.push(cursor);
  }
  if (isBundleState(stateFilter)) {
    where += ' AND bundle.state=?';
    params.push(stateFilter);
  }
  if (isBundleType(typeFilter)) {
    where += ' AND bundle.bundle_type=?';
    params.push(typeFilter);
  }
  const rows = await context.env.DB
    .prepare(
      `SELECT bundle.id AS bundle_id,bundle.bundle_version,bundle.bundle_type,bundle.state,bundle.formal_order_id,
     bundle.manifest_file_count,bundle.manifest_total_bytes,bundle.zip_byte_size,bundle.zip_sha256,
     bundle.drive_file_id,bundle.eligibility_at,bundle.sealed_at,bundle.archived_at,
     bundle.shadow_completed_at,bundle.hot_files_deleted,bundle.restore_expires_at,
     bundle.last_failure_category,bundle.is_current
     FROM archive_bundles bundle WHERE ${where} ORDER BY bundle.id LIMIT ?`,
    )
    .bind(...params)
    .all<Omit<ArchiveBundleStatusDto, 'is_current'> & { is_current: number }>();
  const page: ArchiveBundleStatusDto[] = rows.results.slice(0, limit)
    .map((row) => ({ ...row, is_current: row.is_current === 1 }));
  const hasMore = rows.results.length > limit;
  const last = page.length > 0 ? page[page.length - 1] : undefined;
  return context.json(apiSuccess({
    bundles: page,
    next_cursor: hasMore && last ? last.bundle_id : null,
  }, context.get('requestId')));
}

async function metrics(context: Context<AppEnv>): Promise<Response> {
  requireOwner(context);
  const value = await computeArchiveMetrics(context.env.DB, { now: Date.now() });
  return context.json(apiSuccess({ metrics: value }, context.get('requestId')));
}

function isBundleState(value: string): boolean {
  return ['ONLINE', 'ARCHIVED', 'RESTORE_REQUESTED', 'RESTORING', 'RESTORED_TEMPORARILY', 'RESTORE_FAILED']
    .includes(value);
}

function isBundleType(value: string): boolean {
  return ['ORDER', 'BUYER_REFUND_PAYMENT', 'SELLER_SETTLEMENT_PAYMENT'].includes(value);
}

function requireOwner(context: Context<AppEnv>) {
  const actor = context.get('staffAuthorization');
  if (!actor || actor.staffStatus !== 'ACTIVE' || !actor.roles.has('owner')) {
    throw new ColdArchiveCommandError('FORBIDDEN', 403);
  }
  requirePermission(actor, 'SCHEDULED_OPERATIONS_RUN');
  return actor;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ColdArchiveCommandError('VALIDATION_ERROR', 400);
  }
  return value as Record<string, unknown>;
}

function exactRecord(value: unknown, fields: readonly string[]): Record<string, unknown> {
  const body = record(value);
  const keys = Object.keys(body);
  if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) {
    throw new ColdArchiveCommandError('VALIDATION_ERROR', 400);
  }
  return body;
}

function integer(value: unknown): number {
  if (!Number.isSafeInteger(value)) throw new ColdArchiveCommandError('VALIDATION_ERROR', 400);
  return Number(value);
}

function string(value: unknown): string {
  if (typeof value !== 'string') throw new ColdArchiveCommandError('VALIDATION_ERROR', 400);
  return value;
}

function componentList(value: unknown): ('review' | 'buyer_refund' | 'seller_principal' | 'seller_service_fee')[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new ColdArchiveCommandError('VALIDATION_ERROR', 400);
  }
  return value as ('review' | 'buyer_refund' | 'seller_principal' | 'seller_service_fee')[];
}

function idempotencyKey(context: Context<AppEnv>): string {
  const value = context.req.header('Idempotency-Key')?.trim() ?? '';
  if (value.length < 8 || value.length > 128 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new ColdArchiveCommandError('VALIDATION_ERROR', 400);
  }
  return value;
}

function withErrors(handler: (context: Context<AppEnv>) => Promise<Response>) {
  return async (context: Context<AppEnv>): Promise<Response> => {
    try {
      return await handler(context);
    } catch (error) {
      const codeValue = property(error, 'code');
      const statusValue = property(error, 'status');
      const code = isApiErrorCode(codeValue) ? codeValue : 'DEPENDENCY_UNAVAILABLE';
      return context.json(apiFailure(code, message(code), context.get('requestId')), status(statusValue));
    }
  };
}

function property(value: unknown, key: string): unknown {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? Reflect.get(value, key)
    : undefined;
}

function status(value: unknown): 400 | 403 | 404 | 409 | 503 {
  switch (value) {
    case 400: return 400;
    case 403: return 403;
    case 404: return 404;
    case 409: return 409;
    default: return 503;
  }
}

function message(code: string): string {
  switch (code) {
    case 'FORBIDDEN': return '无权执行此操作';
    case 'NOT_FOUND': return '归档事实不存在';
    case 'VERSION_CONFLICT': return '归档事实版本已变化';
    case 'IDEMPOTENCY_CONFLICT': return '幂等键已用于不同请求';
    case 'REQUEST_IN_PROGRESS': return '请求正在处理中';
    case 'STATE_CONFLICT': return '业务条件尚未满足或当前状态不允许执行';
    case 'VALIDATION_ERROR': return '请求参数不正确';
    default: return '归档服务暂时不可用，请稍后重试';
  }
}

export { RestoreCommandError };
