import { apiFailure, apiSuccess } from '@ygb/contracts';
import { parseIdempotencyKey, readBoundedJson } from '@ygb/domain';
import type { Context, Hono } from 'hono';
import { IdempotencyError } from '../foundation/idempotency';
import { requestIdFromContext } from '../http-auth/errors';
import { customerAuthOriginGuard } from '../middleware/origin-guard';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { AcquisitionError } from './errors';
import type { AcquisitionCommandContext } from './command';
import {
  correctLeadSource,
  listSourceCorrectionCandidates,
} from './reporting-operations';

const BODY_LIMIT = 16 * 1024;

export function registerAcquisitionReportingOperationRoutes(app: Hono<any>): void {
  app.get(
    '/api/staff/acquisition/source-corrections/candidates',
    withErrors(async (context) => {
      const url = new URL(context.req.url);
      if ([...url.searchParams.keys()].some((key) => key !== 'limit')) throw validation();
      const raw = url.searchParams.get('limit');
      const limit = raw === null ? 100 : Number(raw);
      const items = await listSourceCorrectionCandidates(context.env.DB, actor(context), limit);
      return context.json(apiSuccess({ items }, requestIdFromContext(context)));
    }),
  );

  app.post(
    '/api/staff/acquisition/source-corrections',
    customerAuthOriginGuard(),
    withErrors(async (context) => {
      const body = await exactBody(context, [
        'lead_id',
        'new_channel_id',
        'expected_correction_sequence',
        'reason',
      ]);
      if (
        typeof body['lead_id'] !== 'string' ||
        typeof body['new_channel_id'] !== 'string' ||
        !Number.isSafeInteger(body['expected_correction_sequence']) ||
        typeof body['reason'] !== 'string'
      )
        throw validation();
      const result = await correctLeadSource(
        context.env.DB,
        {
          leadId: body['lead_id'],
          newChannelId: body['new_channel_id'],
          expectedCorrectionSequence: Number(body['expected_correction_sequence']),
          reason: body['reason'],
        },
        command(context),
      );
      return context.json(apiSuccess(result, requestIdFromContext(context)), 201);
    }),
  );
}

function actor(context: Context<any>): AssignmentStaffAuthorization {
  const value = context.get('staffAuthorization') as AssignmentStaffAuthorization | undefined;
  if (!value || value.staffStatus !== 'ACTIVE') throw new AcquisitionError('UNAUTHENTICATED', 401);
  return value;
}
function command(context: Context<any>): AcquisitionCommandContext {
  let key;
  try {
    key = parseIdempotencyKey(context.req.header('Idempotency-Key'));
  } catch {
    throw validation();
  }
  if (!key) throw validation();
  return { actor: actor(context), idempotencyKey: key, requestId: requestIdFromContext(context) };
}
async function exactBody(context: Context<any>, keys: readonly string[]) {
  const value = await readBoundedJson(context.req.raw, BODY_LIMIT);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw validation();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length || keys.some((key) => !Object.hasOwn(record, key)))
    throw validation();
  return record;
}
function validation() {
  return new AcquisitionError('VALIDATION_ERROR', 400);
}
function withErrors(handler: (context: Context<any>) => Promise<Response>) {
  return async (context: Context<any>) => {
    try {
      return await handler(context);
    } catch (error) {
      const normalized =
        error instanceof AcquisitionError || error instanceof IdempotencyError
          ? error
          : new AcquisitionError('DEPENDENCY_UNAVAILABLE', 503);
      const message =
        normalized.code === 'FORBIDDEN'
          ? '当前岗位或负责站点不允许此操作'
          : normalized.code === 'NOT_FOUND'
            ? '没有找到对应记录'
            : normalized.code === 'STATE_CONFLICT'
              ? '当前状态不允许此操作'
              : normalized.code === 'VERSION_CONFLICT'
                ? '页面数据已变化，请刷新后重试'
                : normalized.code === 'IDEMPOTENCY_CONFLICT'
                  ? '幂等键已用于其他请求'
                  : normalized.code === 'REQUEST_IN_PROGRESS'
                    ? '相同请求正在处理中'
                    : normalized.code === 'VALIDATION_ERROR'
                      ? '提交信息不正确'
                      : '服务暂时不可用';
      return context.json(
        apiFailure(normalized.code, message, requestIdFromContext(context)),
        normalized.status,
      );
    }
  };
}
