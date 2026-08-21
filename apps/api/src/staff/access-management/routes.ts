import { apiFailure, apiSuccess, isStaffRoleCode, type ApiErrorCode } from '@ygb/contracts';
import type { Context, Hono } from 'hono';
import type { AssignmentStaffAuthorization } from '../../staff-assignment';
import { requireStaffAccessManager } from './authorization';
import { createStaffAccount, updateStaffAccount, changeStaffAccountStatus } from './accounts';
import { StaffAccessManagementError } from './errors';
import { readStaffAccessManagementOverview } from './read-model';

export function registerStaffAccessManagementRoutes(app: Hono<any>): void {
  app.get(
    '/api/staff/access-management',
    withErrors(async (context) => {
      requireActor(context);
      assertNoQuery(context);
      return success(context, await readStaffAccessManagementOverview(context.env.DB));
    }),
  );
  app.post(
    '/api/staff/access-management/employees',
    withErrors(async (context) => {
      const actor = requireActor(context);
      const body = await readExactBody(context, [
        'display_name',
        'email',
        'role_code',
        'marketplace_codes',
      ]);
      if (
        typeof body['display_name'] !== 'string' ||
        typeof body['email'] !== 'string' ||
        !isStaffRoleCode(body['role_code']) ||
        !stringArray(body['marketplace_codes'])
      )
        validation();
      const employee = await createStaffAccount(
        context.env.DB,
        {
          displayName: body['display_name'],
          email: body['email'],
          roleCode: body['role_code'],
          marketplaceCodes: body['marketplace_codes'],
        },
        actor,
      );
      return context.json(apiSuccess({ employee, replayed: false }, requestId(context)), 201);
    }),
  );
  app.post(
    '/api/staff/access-management/employees/:id/update',
    withErrors(async (context) => {
      const actor = requireActor(context);
      const body = await readExactBody(context, [
        'display_name',
        'email',
        'role_code',
        'marketplace_codes',
        'expected_version',
      ]);
      if (
        typeof body['display_name'] !== 'string' ||
        typeof body['email'] !== 'string' ||
        !isStaffRoleCode(body['role_code']) ||
        !stringArray(body['marketplace_codes']) ||
        !positiveInteger(body['expected_version'])
      )
        validation();
      const employee = await updateStaffAccount(
        context.env.DB,
        requiredString(context.req.param('id')),
        {
          displayName: body['display_name'],
          email: body['email'],
          roleCode: body['role_code'],
          marketplaceCodes: body['marketplace_codes'],
          expectedVersion: body['expected_version'],
        },
        actor,
      );
      return success(context, { employee, replayed: false });
    }),
  );
  app.post(
    '/api/staff/access-management/employees/:id/status',
    withErrors(async (context) => {
      const actor = requireActor(context);
      const body = await readExactBody(context, ['status', 'expected_version']);
      const status = body['status'];
      if (
        (status !== 'ACTIVE' && status !== 'DISABLED') ||
        !positiveInteger(body['expected_version'])
      )
        validation();
      const employee = await changeStaffAccountStatus(
        context.env.DB,
        requiredString(context.req.param('id')),
        { status, expectedVersion: body['expected_version'] },
        actor,
      );
      return success(context, { employee, replayed: false });
    }),
  );
}

function requireActor(context: Context<any>): AssignmentStaffAuthorization {
  return requireStaffAccessManager(
    context.get('staffAuthorization') as AssignmentStaffAuthorization | null | undefined,
  );
}
function withErrors(handler: (context: Context<any>) => Promise<Response>) {
  return async (context: Context<any>) => {
    try {
      return await handler(context);
    } catch (error) {
      const normalized =
        error instanceof StaffAccessManagementError
          ? error
          : new StaffAccessManagementError('DEPENDENCY_UNAVAILABLE', 503);
      return context.json(
        apiFailure(
          normalized.code as ApiErrorCode,
          publicMessage(normalized.code),
          requestId(context),
        ),
        normalized.status,
      );
    }
  };
}
function success(context: Context<any>, data: unknown): Response {
  context.header('Cache-Control', 'no-store');
  return context.json(apiSuccess(data, requestId(context)));
}
function publicMessage(code: StaffAccessManagementError['code']): string {
  switch (code) {
    case 'UNAUTHENTICATED':
      return '员工会话无效';
    case 'FORBIDDEN':
      return '仅总管理员可管理员工';
    case 'NOT_FOUND':
      return '员工不存在';
    case 'VERSION_CONFLICT':
      return '数据已变化，请刷新后重试';
    case 'STATE_CONFLICT':
      return '邮箱、岗位或负责站点与当前员工配置冲突';
    case 'VALIDATION_ERROR':
      return '请求参数不正确';
    default:
      return '员工管理暂时不可用';
  }
}
async function readExactBody(
  context: Context<any>,
  keys: readonly string[],
): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await context.req.json();
  } catch {
    validation();
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) validation();
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
    validation();
  return record;
}
function assertNoQuery(context: Context<any>): void {
  if ([...new URL(context.req.url).searchParams.keys()].length > 0) validation();
}
function stringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 10 &&
    value.every((item) => typeof item === 'string' && item.length >= 1 && item.length <= 100)
  );
}
function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}
function requiredString(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length < 1 || value.length > 200) validation();
  return value.trim();
}
function requestId(context: Context<any>): string {
  return String(context.get('requestId') ?? crypto.randomUUID());
}
function validation(): never {
  throw new StaffAccessManagementError('VALIDATION_ERROR', 400);
}
