import { apiFailure, apiSuccess } from '@ygb/contracts';
import { readBoundedJson } from '@ygb/domain';
import type { Context, Hono } from 'hono';
import { requestIdFromContext } from '../http-auth/errors';
import { customerAuthOriginGuard } from '../middleware/origin-guard';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import {
  IdentityResolutionError,
  listIdentityResolutionCases,
  reportIdentityResolutionCase,
  resolveIdentityResolutionCase,
  searchIdentityResolutionCandidates,
} from './identity-resolution';

const BODY_LIMIT = 16 * 1024;

export function registerIdentityResolutionRoutes(app: Hono<any>): void {
  app.get(
    '/api/staff/customer-identity-resolution/cases',
    withErrors(async (context) =>
      context.json(
        apiSuccess(
          { cases: await listIdentityResolutionCases(context.env.DB, actor(context)) },
          requestIdFromContext(context),
        ),
      ),
    ),
  );

  app.get(
    '/api/staff/customer-identity-resolution/candidates',
    withErrors(async (context) => {
      const url = new URL(context.req.url);
      if ([...url.searchParams.keys()].some((key) => !['customer_type', 'query'].includes(key)))
        throw validation();
      const type = url.searchParams.get('customer_type'),
        query = url.searchParams.get('query');
      if ((type !== 'BUYER' && type !== 'SELLER') || !query) throw validation();
      const items = await searchIdentityResolutionCandidates(context.env.DB, actor(context), {
        customerType: type,
        query,
      });
      return context.json(apiSuccess({ items }, requestIdFromContext(context)));
    }),
  );

  app.post(
    '/api/staff/customer-identity-resolution/cases',
    customerAuthOriginGuard(),
    withErrors(async (context) => {
      const body = await exactBody(context, [
        'customer_type',
        'marketplace_code',
        'wechat_id',
        'reason_code',
        'note',
      ]);
      if (
        (body['customer_type'] !== 'BUYER' && body['customer_type'] !== 'SELLER') ||
        typeof body['marketplace_code'] !== 'string' ||
        typeof body['wechat_id'] !== 'string' ||
        ![
          'AMBIGUOUS_HISTORY',
          'IDENTITY_CONFLICT',
          'LEGACY_MISSING_IDENTITY',
          'STAFF_REPORTED',
        ].includes(String(body['reason_code'])) ||
        !(body['note'] === null || typeof body['note'] === 'string')
      )
        throw validation();
      const caseItem = await reportIdentityResolutionCase(
        context.env.DB,
        actor(context),
        secret(context),
        {
          customerType: body['customer_type'],
          marketplaceCode: body['marketplace_code'],
          wechatId: body['wechat_id'],
          reasonCode: body['reason_code'] as
            | 'AMBIGUOUS_HISTORY'
            | 'IDENTITY_CONFLICT'
            | 'LEGACY_MISSING_IDENTITY'
            | 'STAFF_REPORTED',
          note: body['note'],
        },
      );
      return context.json(apiSuccess({ case: caseItem }, requestIdFromContext(context)), 201);
    }),
  );

  app.post(
    '/api/staff/customer-identity-resolution/cases/:id/resolve',
    customerAuthOriginGuard(),
    withErrors(async (context) => {
      const body = await exactBody(context, ['subject_id', 'reason']);
      if (typeof body['subject_id'] !== 'string' || typeof body['reason'] !== 'string')
        throw validation();
      const caseItem = await resolveIdentityResolutionCase(context.env.DB, actor(context), {
        caseId: context.req.param('id') ?? '',
        subjectId: body['subject_id'],
        reason: body['reason'],
      });
      return context.json(apiSuccess({ case: caseItem }, requestIdFromContext(context)));
    }),
  );
}

function actor(context: Context<any>): AssignmentStaffAuthorization {
  const value = context.get('staffAuthorization') as AssignmentStaffAuthorization | undefined;
  if (!value || value.staffStatus !== 'ACTIVE') throw new IdentityResolutionError('FORBIDDEN', 403);
  return value;
}
function secret(context: Context<any>): string {
  const value = String(context.env.CUSTOMER_SECURITY_TOKEN_SECRET ?? '');
  if (new TextEncoder().encode(value).byteLength < 32)
    throw new IdentityResolutionError('DEPENDENCY_UNAVAILABLE', 503);
  return value;
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
  return new IdentityResolutionError('VALIDATION_ERROR', 400);
}
function withErrors(handler: (context: Context<any>) => Promise<Response>) {
  return async (context: Context<any>) => {
    try {
      return await handler(context);
    } catch (error) {
      const normalized =
        error instanceof IdentityResolutionError
          ? error
          : new IdentityResolutionError('DEPENDENCY_UNAVAILABLE', 503);
      const message =
        normalized.code === 'FORBIDDEN'
          ? '当前身份不能处理客户身份冲突'
          : normalized.code === 'NOT_FOUND'
            ? '没有找到对应记录'
            : normalized.code === 'CONFLICT'
              ? '身份冲突仍未满足安全处理条件'
              : normalized.code === 'VALIDATION_ERROR'
                ? '提交信息不正确'
                : '身份处理服务暂时不可用';
      return context.json(
        apiFailure(normalized.code, message, requestIdFromContext(context)),
        normalized.status,
      );
    }
  };
}
