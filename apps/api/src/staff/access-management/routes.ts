import { apiFailure, apiSuccess, isStaffRoleCode, type ApiErrorCode } from '@ygb/contracts';
import { parseIdempotencyKey } from '@ygb/domain';
import type { Context, Hono } from 'hono';
import type { AssignmentStaffAuthorization } from '../../staff-assignment';
import { requireStaffAccessManager } from './authorization';
import {
  changeBuyerPreSalesOwner,
  changeBuyerRefundOwner,
  changeSellerOrganizationManager,
  createStaffAccount,
  updateStaffAccount,
  changeStaffAccountStatus,
  revokePersonalDeny,
  setPersonalDeny,
} from './accounts';
import { StaffAccessManagementError } from './errors';
import {
  readStaffAccessManagementOverview,
  readStaffBuyerRefundOwnerAssignments,
  readStaffSellerOrganizationAssignments,
} from './read-model';

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
  app.get(
    '/api/staff/access-management/seller-organization-assignments',
    withErrors(async (context) => {
      requireActor(context);
      assertNoQuery(context);
      return success(context, {
        seller_organizations: await readStaffSellerOrganizationAssignments(context.env.DB),
      });
    }),
  );
  app.post(
    '/api/staff/access-management/seller-organization-assignments/:id/manager',
    withErrors(async (context) => {
      const actor = requireActor(context);
      const body = await readExactBody(context, [
        'assigned_staff_id',
        'expected_assignment_version',
      ]);
      if (
        typeof body['assigned_staff_id'] !== 'string' ||
        !nonnegativeInteger(body['expected_assignment_version'])
      )
        validation();
      const idempotencyKey = parseIdempotencyKey(context.req.header('Idempotency-Key'));
      if (!idempotencyKey) validation();
      const result = await changeSellerOrganizationManager(
        context.env.DB,
        {
          sellerOrganizationId: requiredString(context.req.param('id')),
          assignedStaffId: requiredString(body['assigned_staff_id']),
          expectedAssignmentVersion: body['expected_assignment_version'],
          idempotencyKey,
          requestId: requestId(context),
        },
        actor,
      );
      return success(context, result);
    }),
  );
  app.get(
    '/api/staff/access-management/buyer-assignments',
    withErrors(async (context) => {
      requireActor(context);
      assertNoQuery(context);
      return success(context, {
        buyers: await readStaffBuyerRefundOwnerAssignments(context.env.DB),
      });
    }),
  );
  app.post(
    '/api/staff/access-management/buyer-assignments',
    withErrors(async (context) => {
      const actor = requireActor(context);
      const body = await readExactBody(context, [
        'buyer_customer_id',
        'assigned_staff_id',
        'expected_assignment_version',
        'reason',
      ]);
      if (
        typeof body['buyer_customer_id'] !== 'string' ||
        typeof body['assigned_staff_id'] !== 'string' ||
        typeof body['reason'] !== 'string' ||
        body['reason'].trim().length < 1 ||
        body['reason'].length > 1000 ||
        !nonnegativeInteger(body['expected_assignment_version'])
      )
        validation();
      const idempotencyKey = parseIdempotencyKey(context.req.header('Idempotency-Key'));
      if (!idempotencyKey) validation();
      const result = await changeBuyerRefundOwner(
        context.env.DB,
        {
          buyerCustomerId: requiredString(body['buyer_customer_id']),
          assignedStaffId: requiredString(body['assigned_staff_id']),
          expectedAssignmentVersion: body['expected_assignment_version'],
          reason: body['reason'],
          idempotencyKey,
          requestId: requestId(context),
        },
        actor,
      );
      return success(context, result);
    }),
  );
  app.post(
    '/api/staff/access-management/buyer-pre-sales-assignments',
    withErrors(async (context) => {
      const actor = requireActor(context);
      const body = await readExactBody(context, [
        'buyer_customer_id',
        'assigned_staff_id',
        'expected_assignment_version',
        'reason',
      ]);
      if (
        typeof body['buyer_customer_id'] !== 'string' ||
        typeof body['assigned_staff_id'] !== 'string' ||
        typeof body['reason'] !== 'string' ||
        body['reason'].trim().length < 1 ||
        body['reason'].length > 1000 ||
        !nonnegativeInteger(body['expected_assignment_version'])
      )
        validation();
      const idempotencyKey = parseIdempotencyKey(context.req.header('Idempotency-Key'));
      if (!idempotencyKey) validation();
      const result = await changeBuyerPreSalesOwner(
        context.env.DB,
        {
          buyerCustomerId: requiredString(body['buyer_customer_id']),
          assignedStaffId: requiredString(body['assigned_staff_id']),
          expectedAssignmentVersion: body['expected_assignment_version'],
          reason: body['reason'],
          idempotencyKey,
          requestId: requestId(context),
        },
        actor,
      );
      return success(context, result);
    }),
  );
  app.get(
    '/api/staff/access-management/personal-denies',
    withErrors(async (context) => {
      requireActor(context);
      assertNoQuery(context);
      const rows = await context.env.DB
        .prepare(
          `SELECT override.staff_id,staff.display_name AS staff_display_name,
            override.permission_code,override.status,override.reason,
            override.assigned_by_staff_id,override.assigned_at,override.revoked_at
          FROM staff_permission_overrides override
          JOIN staff_users staff ON staff.id=override.staff_id
          WHERE override.effect='DENY' AND override.status='ACTIVE'
          ORDER BY staff.display_name,override.staff_id,override.permission_code`,
        )
        .all();
      return success(context, { denies: rows.results });
    }),
  );
  app.post(
    '/api/staff/access-management/personal-denies',
    withErrors(async (context) => {
      const actor = requireActor(context);
      const body = await readExactBody(context, [
        'staff_id',
        'permission_code',
        'reason',
      ]);
      if (
        typeof body['staff_id'] !== 'string' ||
        typeof body['permission_code'] !== 'string' ||
        typeof body['reason'] !== 'string' ||
        body['reason'].trim().length < 1 ||
        body['reason'].length > 1000
      )
        validation();
      const idempotencyKey = parseIdempotencyKey(context.req.header('Idempotency-Key'));
      if (!idempotencyKey) validation();
      const result = await setPersonalDeny(
        context.env.DB,
        {
          staffId: requiredString(body['staff_id']),
          permissionCode: requiredString(body['permission_code']),
          reason: body['reason'],
          idempotencyKey,
          requestId: requestId(context),
        },
        actor,
      );
      return success(context, result);
    }),
  );
  app.post(
    '/api/staff/access-management/personal-denies/revoke',
    withErrors(async (context) => {
      const actor = requireActor(context);
      const body = await readExactBody(context, [
        'staff_id',
        'permission_code',
        'reason',
      ]);
      if (
        typeof body['staff_id'] !== 'string' ||
        typeof body['permission_code'] !== 'string' ||
        typeof body['reason'] !== 'string' ||
        body['reason'].trim().length < 1 ||
        body['reason'].length > 1000
      )
        validation();
      const idempotencyKey = parseIdempotencyKey(context.req.header('Idempotency-Key'));
      if (!idempotencyKey) validation();
      const result = await revokePersonalDeny(
        context.env.DB,
        {
          staffId: requiredString(body['staff_id']),
          permissionCode: requiredString(body['permission_code']),
          reason: body['reason'],
          idempotencyKey,
          requestId: requestId(context),
        },
        actor,
      );
      return success(context, result);
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
function nonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
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
