import {
  apiFailure,
  apiSuccess,
  isStaffRoleCode,
  type ApiErrorCode,
} from '@ygb/contracts';
import type { Context, Hono } from 'hono';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { requireStaffAccessManager } from './authorization';
import { StaffAccessManagementError } from './errors';
import {
  cancelStaffBindingInvitation,
  createStaffBindingInvitation,
} from './invitations';
import {
  changeStaffAccessStatus,
  changeStaffRole,
} from './lifecycle';
import { readStaffAccessManagementOverview } from './read-model';

export function registerStaffAccessManagementRoutes(app: Hono<any>): void {
  app.get('/api/staff/access-management', withErrors(async (context) => {
    requireActor(context);
    assertNoQuery(context);
    return success(context, await readStaffAccessManagementOverview(
      context.env.DB,
    ));
  }));

  app.post('/api/staff/access-management/invitations', withErrors(async (context) => {
    const actor = requireActor(context);
    const body = await readExactBody(context, [
      'display_name', 'role_code', 'team_id',
    ]);
    if (!isStaffRoleCode(body['role_code'])) validation();
    const result = await createStaffBindingInvitation(context.env.DB, {
      displayName: requiredString(body['display_name']),
      roleCode: body['role_code'],
      teamId: nullableString(body['team_id']),
    }, command(context, actor));
    return success(context, result);
  }));

  app.post('/api/staff/access-management/invitations/:id/cancel', withErrors(async (context) => {
    const actor = requireActor(context);
    const body = await readExactBody(context, ['expected_version']);
    const result = await cancelStaffBindingInvitation(context.env.DB, {
      invitationId: requiredString(context.req.param('id')),
      expectedVersion: positiveInteger(body['expected_version']),
    }, command(context, actor));
    return success(context, result);
  }));

  app.post('/api/staff/access-management/employees/:id/status', withErrors(async (context) => {
    const actor = requireActor(context);
    const body = await readExactBody(context, ['status', 'expected_version']);
    const status = body['status'];
    if (status !== 'ACTIVE' && status !== 'DISABLED') validation();
    const result = await changeStaffAccessStatus(context.env.DB, {
      staffId: requiredString(context.req.param('id')),
      status,
      expectedVersion: positiveInteger(body['expected_version']),
    }, command(context, actor));
    return success(context, result);
  }));

  app.post('/api/staff/access-management/employees/:id/role', withErrors(async (context) => {
    const actor = requireActor(context);
    const body = await readExactBody(context, ['role_code', 'expected_version']);
    if (!isStaffRoleCode(body['role_code'])) validation();
    const result = await changeStaffRole(context.env.DB, {
      staffId: requiredString(context.req.param('id')),
      roleCode: body['role_code'],
      expectedVersion: positiveInteger(body['expected_version']),
    }, command(context, actor));
    return success(context, result);
  }));
}

function requireActor(context: Context<any>): AssignmentStaffAuthorization {
  return requireStaffAccessManager(context.get('staffAuthorization') as
    | AssignmentStaffAuthorization | null | undefined);
}

function command(context: Context<any>, actor: AssignmentStaffAuthorization) {
  return {
    actor,
    idempotencyKey: requireIdempotencyKey(context),
    requestId: requestId(context),
  };
}

function withErrors(handler: (context: Context<any>) => Promise<Response>) {
  return async (context: Context<any>): Promise<Response> => {
    try {
      return await handler(context);
    } catch (error) {
      const normalized = error instanceof StaffAccessManagementError
        ? error
        : new StaffAccessManagementError('DEPENDENCY_UNAVAILABLE', 503);
      return context.json(apiFailure(
        normalized.code as ApiErrorCode,
        publicMessage(normalized.code),
        requestId(context),
      ), normalized.status);
    }
  };
}

function success(context: Context<any>, data: unknown): Response {
  context.header('Cache-Control', 'no-store');
  return context.json(apiSuccess(data, requestId(context)));
}

function publicMessage(code: StaffAccessManagementError['code']): string {
  switch (code) {
    case 'UNAUTHENTICATED': return '员工会话无效';
    case 'FORBIDDEN': return '仅总管理员可管理员工权限';
    case 'NOT_FOUND': return '员工或邀请不存在';
    case 'VERSION_CONFLICT': return '数据已变化，请刷新后重试';
    case 'STATE_CONFLICT': return '当前状态不允许该操作';
    case 'VALIDATION_ERROR': return '请求参数不正确';
    case 'IDEMPOTENCY_CONFLICT': return '该操作与已提交请求冲突';
    case 'REQUEST_IN_PROGRESS': return '操作正在处理中';
    default: return '员工管理暂时不可用';
  }
}

async function readExactBody(
  context: Context<any>,
  exactKeys: readonly string[],
): Promise<Record<string, unknown>> {
  const length = context.req.header('Content-Length');
  if (length && (!/^\d+$/u.test(length) || Number(length) > 8192)) validation();
  let value: unknown;
  try {
    value = await context.req.json();
  } catch {
    validation();
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) validation();
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const expected = [...exactKeys].sort();
  if (keys.length !== expected.length
    || keys.some((key, index) => key !== expected[index])) validation();
  return value as Record<string, unknown>;
}

function assertNoQuery(context: Context<any>): void {
  if ([...new URL(context.req.url).searchParams.keys()].length > 0) validation();
}

function positiveInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    validation();
  }
  return value;
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string') validation();
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 200
    || /[\u0000-\u001f\u007f]/u.test(normalized)) validation();
  return normalized;
}

function nullableString(value: unknown): string | null {
  return value === null ? null : requiredString(value);
}

function requireIdempotencyKey(context: Context<any>): string {
  const value = context.req.header('Idempotency-Key')?.trim() ?? '';
  if (value.length < 8 || value.length > 128
    || /[\u0000-\u001f\u007f]/u.test(value)) validation();
  return value;
}

function requestId(context: Context<any>): string {
  return String(context.get('requestId') ?? crypto.randomUUID());
}

function validation(): never {
  throw new StaffAccessManagementError('VALIDATION_ERROR', 400);
}
