import {
  apiFailure,
  apiSuccess,
  isStaffAssignmentDutyCode,
  isStaffAvailabilityStatus,
  isStaffWorkItemType,
  type ApiErrorCode,
} from '@ygb/contracts';
import type { Context, Hono } from 'hono';
import { setStaffAvailability } from './availability-service';
import {
  configureAssignmentFallback,
  getAssignmentFallback,
} from './fallback-service';
import {
  createReassignmentBatch,
  getReassignmentBatch,
  runReassignmentBatchChunk,
} from './batch-transfer-service';
import type { AssignmentStaffAuthorization } from './effective-authorization';
import { StaffAssignmentError } from './errors';
import { requirePermission } from './permission-policy';
import { decodeStaffWorkItemCursor, encodeStaffWorkItemCursor } from './pagination';
import {
  getVisibleWorkItem,
  listMyAssignments,
  listVisibleWorkItems,
} from './read-model';
import {
  changeFixedAssignment,
  reassignWorkItem,
} from './reassignment-service';

export function registerStaffAssignmentRoutes(app: Hono<any>): void {
  app.get('/api/staff/assignment-fallbacks/:marketplaceCode', withStaffErrors(async (context) => {
    const actor = requireStaffActor(context);
    const marketplaceCode = requiredString(context.req.param('marketplaceCode'));
    return context.json(apiSuccess({
      fallback: await getAssignmentFallback(
        context.env.DB,
        marketplaceCode,
        actor,
      ),
    }, requestId(context)));
  }));

  app.put('/api/staff/assignment-fallbacks/:marketplaceCode', withStaffErrors(async (context) => {
    const actor = requireStaffActor(context);
    const body = await readJson(context);
    const result = await configureAssignmentFallback(context.env.DB, {
      marketplaceCode: requiredString(context.req.param('marketplaceCode')),
      staffId: requiredString(body['staff_id']),
      expectedVersion: integer(body['expected_version']),
    }, {
      actor,
      idempotencyKey: requireIdempotencyKey(context),
      requestId: requestId(context),
    });
    return context.json(apiSuccess({ fallback: result }, requestId(context)));
  }));

  app.get('/api/staff/me/assignments', withStaffErrors(async (context) => {
    const actor = requireStaffActor(context);
    return context.json(apiSuccess({
      assignments: await listMyAssignments(context.env.DB, actor),
    }, requestId(context)));
  }));

  app.get('/api/staff/me/work-items', withStaffErrors(async (context) => {
    const actor = requireStaffActor(context);
    const parameters = new URL(context.req.url).searchParams;
    for (const key of parameters.keys()) {
      if (!['status', 'work_type', 'limit', 'cursor'].includes(key)
        || parameters.getAll(key).length !== 1) {
        throw new StaffAssignmentError('VALIDATION_ERROR', 400);
      }
    }
    const status = context.req.query('status');
    if (status !== undefined
      && status !== 'OPEN'
      && status !== 'COMPLETED'
      && status !== 'CANCELLED') {
      throw new StaffAssignmentError('VALIDATION_ERROR', 400);
    }
    const normalizedStatus = status ?? 'OPEN';
    const workType = context.req.query('work_type');
    if (workType !== undefined && !isStaffWorkItemType(workType)) {
      throw new StaffAssignmentError('VALIDATION_ERROR', 400);
    }
    const cursor = decodeStaffWorkItemCursor(context.req.query('cursor'), {
      status: normalizedStatus,
      workType: workType ?? null,
    });
    const page = await listVisibleWorkItems(context.env.DB, actor, {
      status: normalizedStatus,
      workType: workType ?? null,
      limit: parseLimit(context.req.query('limit')),
      cursor,
    });
    const lastCursor = page.next_cursor === null
      ? null
      : JSON.parse(page.next_cursor) as { createdAt: number; id: string };
    return context.json(apiSuccess({
      work_items: page.work_items,
      next_cursor: lastCursor === null ? null : encodeStaffWorkItemCursor({
        ...lastCursor,
        status: normalizedStatus,
        workType: workType ?? null,
      }),
    }, requestId(context)));
  }));

  app.get('/api/staff/me/work-items/:id', withStaffErrors(async (context) => {
    const actor = requireStaffActor(context);
    return context.json(apiSuccess({
      work_item: await getVisibleWorkItem(
        context.env.DB,
        actor,
        requiredString(context.req.param('id')),
      ),
    }, requestId(context)));
  }));

  app.patch('/api/staff/me/availability', withStaffErrors(async (context) => {
    const actor = requireStaffActor(context);
    const body = await readJson(context);
    const status = body['availability_status'];
    if (!isStaffAvailabilityStatus(status)) {
      throw new StaffAssignmentError('VALIDATION_ERROR', 400);
    }
    const result = await setStaffAvailability(context.env.DB, {
      staffId: typeof body['staff_id'] === 'string'
        ? body['staff_id']
        : actor.staffId,
      availabilityStatus: status,
      reason: optionalString(body['reason']),
      expectedVersion: integer(body['expected_version']),
    }, {
      actor,
      idempotencyKey: requireIdempotencyKey(context),
      requestId: requestId(context),
    });
    return context.json(apiSuccess({ availability: result }, requestId(context)));
  }));

  app.post('/api/staff/assignments/reassign', withStaffErrors(async (context) => {
    const actor = requireStaffActor(context);
    const body = await readJson(context);
    const duty = body['duty_code'];
    const subjectType = body['subject_type'];
    if (!isStaffAssignmentDutyCode(duty)
      || (subjectType !== 'BUYER_CUSTOMER'
        && subjectType !== 'SELLER_ORGANIZATION')) {
      throw new StaffAssignmentError('VALIDATION_ERROR', 400);
    }
    const result = await changeFixedAssignment(context.env.DB, {
      subjectType,
      subjectId: requiredString(body['subject_id']),
      dutyCode: duty,
      targetStaffId: requiredString(body['target_staff_id']),
      expectedAssignmentVersion: integer(body['expected_assignment_version']),
      transferOpenWorkItems: body['transfer_open_work_items'] === true,
      reason: requiredString(body['reason']),
      marketplaceCode: optionalString(body['marketplace_code']) ?? 'JP',
    }, {
      actor,
      idempotencyKey: requireIdempotencyKey(context),
      requestId: requestId(context),
    });
    return context.json(apiSuccess({ assignment: result }, requestId(context)));
  }));

  app.post('/api/staff/work-items/:id/reassign', withStaffErrors(async (context) => {
    const actor = requireStaffActor(context);
    const body = await readJson(context);
    const result = await reassignWorkItem(context.env.DB, {
      workItemId: requiredString(context.req.param('id')),
      targetStaffId: requiredString(body['target_staff_id']),
      expectedVersion: integer(body['expected_version']),
      reason: requiredString(body['reason']),
    }, {
      actor,
      idempotencyKey: requireIdempotencyKey(context),
      requestId: requestId(context),
    });
    return context.json(apiSuccess({ work_item: result }, requestId(context)));
  }));

  app.post('/api/staff/reassignment-batches', withStaffErrors(async (context) => {
    const actor = requireStaffActor(context);
    const body = await readJson(context);
    const duty = body['duty_code'];
    const subjectType = body['subject_type'];
    if (!isStaffAssignmentDutyCode(duty)
      || (subjectType !== 'BUYER_CUSTOMER'
        && subjectType !== 'SELLER_ORGANIZATION')) {
      throw new StaffAssignmentError('VALIDATION_ERROR', 400);
    }
    const result = await createReassignmentBatch(context.env.DB, {
      sourceStaffId: requiredString(body['source_staff_id']),
      targetStaffId: optionalString(body['target_staff_id']),
      dutyCode: duty,
      subjectType,
      reason: requiredString(body['reason']),
    }, {
      actor,
      idempotencyKey: requireIdempotencyKey(context),
      requestId: requestId(context),
    });
    return context.json(apiSuccess({ batch: result }, requestId(context)));
  }));

  app.post('/api/staff/reassignment-batches/:id/run', withStaffErrors(async (context) => {
    const actor = requireStaffActor(context);
    const body = await readJson(context);
    const limit = body['limit'] == null
      ? undefined
      : integer(body['limit']);
    const result = await runReassignmentBatchChunk(context.env.DB, {
      batchId: requiredString(context.req.param('id')),
      expectedVersion: integer(body['expected_version']),
      ...(limit === undefined ? {} : { limit }),
      marketplaceCode: optionalString(body['marketplace_code']) ?? 'JP',
    }, {
      actor,
      idempotencyKey: requireIdempotencyKey(context),
      requestId: requestId(context),
    });
    return context.json(apiSuccess({ batch: result }, requestId(context)));
  }));

  app.get('/api/staff/reassignment-batches/:id', withStaffErrors(async (context) => {
    const actor = requireStaffActor(context);
    requirePermission(actor, 'ASSIGNMENT_BATCH_TRANSFER');
    return context.json(apiSuccess({
      batch: await getReassignmentBatch(
        context.env.DB,
        requiredString(context.req.param('id')),
      ),
    }, requestId(context)));
  }));
}

/**
 * Security boundary: Phase 3H never reads staffId/roles/permissions/scope from
 * request headers or JSON. An upstream verified staff-auth middleware must set
 * `staffAuthorization`. Until it does, every internal endpoint fails closed.
 */
function requireStaffActor(context: Context<any>): AssignmentStaffAuthorization {
  const actor = context.get('staffAuthorization') as
    | AssignmentStaffAuthorization
    | null
    | undefined;
  if (!actor) throw new StaffHttpUnauthenticatedError();
  return actor;
}

class StaffHttpUnauthenticatedError extends Error {}

function withStaffErrors(
  handler: (context: Context<any>) => Promise<Response>,
) {
  return async (context: Context<any>): Promise<Response> => {
    try {
      return await handler(context);
    } catch (error) {
      const id = requestId(context);
      if (error instanceof StaffHttpUnauthenticatedError) {
        return context.json(
          apiFailure('UNAUTHENTICATED', '员工会话无效', id),
          401,
        );
      }
      const normalized = error instanceof StaffAssignmentError
        ? error
        : new StaffAssignmentError('DEPENDENCY_UNAVAILABLE', 503);
      return context.json(
        apiFailure(
          toApiErrorCode(normalized.code),
          publicMessage(normalized.code),
          id,
        ),
        normalized.status,
      );
    }
  };
}

function toApiErrorCode(code: StaffAssignmentError['code']): ApiErrorCode {
  switch (code) {
    case 'VALIDATION_ERROR': return 'VALIDATION_ERROR';
    case 'FORBIDDEN': return 'FORBIDDEN';
    case 'NOT_FOUND': return 'NOT_FOUND';
    case 'VERSION_CONFLICT': return 'VERSION_CONFLICT';
    case 'REQUEST_IN_PROGRESS': return 'REQUEST_IN_PROGRESS';
    case 'IDEMPOTENCY_CONFLICT': return 'IDEMPOTENCY_CONFLICT';
    case 'DEPENDENCY_UNAVAILABLE':
    case 'NO_ELIGIBLE_ASSIGNEE':
    case 'OWNER_FALLBACK_NOT_CONFIGURED':
    case 'OWNER_FALLBACK_INVALID':
      return 'DEPENDENCY_UNAVAILABLE';
    default: return 'STATE_CONFLICT';
  }
}

function publicMessage(code: StaffAssignmentError['code']): string {
  switch (code) {
    case 'NO_ELIGIBLE_ASSIGNEE': return '当前没有可接收该任务的员工';
    case 'OWNER_FALLBACK_NOT_CONFIGURED': return '未配置 Marketplace 主负责人';
    case 'OWNER_FALLBACK_INVALID': return 'Marketplace 主负责人当前不可用';
    case 'FORBIDDEN': return '无权执行该操作';
    case 'NOT_FOUND': return '资源不存在';
    case 'VERSION_CONFLICT': return '数据已发生变化，请刷新后重试';
    case 'VALIDATION_ERROR': return '请求参数不正确';
    default: return '服务暂时不可用，请稍后重试';
  }
}

async function readJson(context: Context<any>): Promise<Record<string, unknown>> {
  try {
    const body = await context.req.json();
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
  } catch {
    // normalized below
  }
  throw new StaffAssignmentError('VALIDATION_ERROR', 400);
}
function requiredString(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length < 1) {
    throw new StaffAssignmentError('VALIDATION_ERROR', 400);
  }
  return value;
}
function optionalString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') {
    throw new StaffAssignmentError('VALIDATION_ERROR', 400);
  }
  return value;
}
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new StaffAssignmentError('VALIDATION_ERROR', 400);
  }
  return value;
}
function parseLimit(value: string | undefined): number {
  if (value == null) return 50;
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw new StaffAssignmentError('VALIDATION_ERROR', 400);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new StaffAssignmentError('VALIDATION_ERROR', 400);
  }
  return parsed;
}
function requireIdempotencyKey(context: Context<any>): string {
  const value = context.req.header('Idempotency-Key');
  if (!value || value.length < 8 || value.length > 128
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new StaffAssignmentError('VALIDATION_ERROR', 400);
  }
  return value;
}
function requestId(context: Context<any>): string {
  return String(context.get('requestId') ?? crypto.randomUUID());
}
