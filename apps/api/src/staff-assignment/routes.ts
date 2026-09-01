import { apiFailure, apiSuccess, isStaffWorkItemType, type ApiErrorCode } from '@ygb/contracts';
import type { Context, Hono } from 'hono';
import type { AssignmentStaffAuthorization } from './effective-authorization';
import { StaffAssignmentError } from './errors';
import { decodeStaffWorkItemCursor, encodeStaffWorkItemCursor } from './pagination';
import {
  getVisibleWorkItem,
  listMyAssignments,
  listVisibleWorkItems,
  readWorkbenchSummary,
} from './read-model';

/** Frozen Staff V1 exposes only read-only Role × Marketplace work queues. */
export function registerStaffAssignmentRoutes(app: Hono<any>): void {
  app.get(
    '/api/staff/me/assignments',
    withStaffErrors(async (context) => {
      const actor = requireStaffActor(context);
      return context.json(
        apiSuccess(
          { assignments: await listMyAssignments(context.env.DB, actor) },
          requestId(context),
        ),
      );
    }),
  );

  app.get(
    '/api/staff/me/work-items',
    withStaffErrors(async (context) => {
      const actor = requireStaffActor(context);
      const parameters = new URL(context.req.url).searchParams;
      for (const key of parameters.keys()) {
        if (
          !['status', 'work_type', 'limit', 'cursor'].includes(key) ||
          parameters.getAll(key).length !== 1
        )
          throw new StaffAssignmentError('VALIDATION_ERROR', 400);
      }
      const status = context.req.query('status');
      if (
        status !== undefined &&
        status !== 'OPEN' &&
        status !== 'COMPLETED' &&
        status !== 'CANCELLED'
      )
        throw new StaffAssignmentError('VALIDATION_ERROR', 400);
      const normalizedStatus = status ?? 'OPEN';
      const workType = context.req.query('work_type');
      if (workType !== undefined && !isStaffWorkItemType(workType))
        throw new StaffAssignmentError('VALIDATION_ERROR', 400);
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
      const lastCursor =
        page.next_cursor === null
          ? null
          : (JSON.parse(page.next_cursor) as { createdAt: number; id: string });
      return context.json(
        apiSuccess(
          {
            work_items: page.work_items,
            next_cursor:
              lastCursor === null
                ? null
                : encodeStaffWorkItemCursor({
                    ...lastCursor,
                    status: normalizedStatus,
                    workType: workType ?? null,
                  }),
          },
          requestId(context),
        ),
      );
    }),
  );

  // Stage 7.5 batch 1: authoritative workbench metrics (SLA counts, exception
  // orders, role-gated refund amount, recent items). Registered before the
  // :id route so the literal path wins.
  app.get(
    '/api/staff/me/work-items/summary',
    withStaffErrors(async (context) => {
      const actor = requireStaffActor(context);
      const parameters = new URL(context.req.url).searchParams;
      if (parameters.size > 0) throw new StaffAssignmentError('VALIDATION_ERROR', 400);
      return context.json(
        apiSuccess(
          { summary: await readWorkbenchSummary(context.env.DB, actor) },
          requestId(context),
        ),
      );
    }),
  );

  app.get(
    '/api/staff/me/work-items/:id',
    withStaffErrors(async (context) => {
      const actor = requireStaffActor(context);
      return context.json(
        apiSuccess(
          {
            work_item: await getVisibleWorkItem(
              context.env.DB,
              actor,
              requiredString(context.req.param('id')),
            ),
          },
          requestId(context),
        ),
      );
    }),
  );
}

function requireStaffActor(context: Context<any>): AssignmentStaffAuthorization {
  const actor = context.get('staffAuthorization') as
    | AssignmentStaffAuthorization
    | null
    | undefined;
  if (!actor) throw new StaffHttpUnauthenticatedError();
  return actor;
}
class StaffHttpUnauthenticatedError extends Error {}
function withStaffErrors(handler: (context: Context<any>) => Promise<Response>) {
  return async (context: Context<any>): Promise<Response> => {
    try {
      return await handler(context);
    } catch (error) {
      const id = requestId(context);
      if (error instanceof StaffHttpUnauthenticatedError)
        return context.json(apiFailure('UNAUTHENTICATED', '员工会话无效', id), 401);
      const normalized =
        error instanceof StaffAssignmentError
          ? error
          : new StaffAssignmentError('DEPENDENCY_UNAVAILABLE', 503);
      return context.json(
        apiFailure(toApiErrorCode(normalized.code), publicMessage(normalized.code), id),
        normalized.status,
      );
    }
  };
}
function toApiErrorCode(code: StaffAssignmentError['code']): ApiErrorCode {
  switch (code) {
    case 'VALIDATION_ERROR':
      return 'VALIDATION_ERROR';
    case 'FORBIDDEN':
      return 'FORBIDDEN';
    case 'NOT_FOUND':
      return 'NOT_FOUND';
    case 'VERSION_CONFLICT':
      return 'VERSION_CONFLICT';
    case 'REQUEST_IN_PROGRESS':
      return 'REQUEST_IN_PROGRESS';
    case 'IDEMPOTENCY_CONFLICT':
      return 'IDEMPOTENCY_CONFLICT';
    case 'DEPENDENCY_UNAVAILABLE':
    case 'BUYER_PRE_SALES_OWNER_NOT_ASSIGNED':
    case 'BUYER_REFUND_OWNER_NOT_ASSIGNED':
    case 'SELLER_ACCOUNT_MANAGER_NOT_ASSIGNED':
      return 'DEPENDENCY_UNAVAILABLE';
    default:
      return 'STATE_CONFLICT';
  }
}
function publicMessage(code: StaffAssignmentError['code']): string {
  switch (code) {
    case 'FORBIDDEN':
      return '无权查看该工作项';
    case 'NOT_FOUND':
      return '资源不存在';
    case 'VALIDATION_ERROR':
      return '请求参数不正确';
    default:
      return '服务暂时不可用，请稍后重试';
  }
}
function requiredString(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length < 1)
    throw new StaffAssignmentError('VALIDATION_ERROR', 400);
  return value.trim();
}
function parseLimit(value: string | undefined): number {
  if (value == null) return 50;
  if (!/^[1-9][0-9]*$/u.test(value)) throw new StaffAssignmentError('VALIDATION_ERROR', 400);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > 100)
    throw new StaffAssignmentError('VALIDATION_ERROR', 400);
  return parsed;
}
function requestId(context: Context<any>): string {
  return String(context.get('requestId') ?? crypto.randomUUID());
}
