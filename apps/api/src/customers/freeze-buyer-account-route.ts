import { apiFailure, apiSuccess } from '@ygb/contracts';
import { parseIdempotencyKey } from '@ygb/domain';
import type { Context, Hono } from 'hono';
import { requestIdFromContext } from '../http-auth/errors';
import { customerAuthOriginGuard } from '../middleware/origin-guard';
import { freezeBuyerAuthAccount } from '../buyer-self-registration/recovery';
import { CustomerAuthError, type CustomerAccessActor } from '../customer-auth/customer-auth-shared';

/**
 * T9-B09 fix: the runtime buyer-account freeze endpoint. The underlying
 * freezeBuyerAuthAccount command (set FROZEN + revoke sessions + audit +
 * idempotency) already existed; this is the missing HTTP shell.
 */
export function registerFreezeBuyerAccountRoutes(app: Hono<any>): void {
  app.post(
    '/api/staff/buyer-accounts/:id/freeze',
    customerAuthOriginGuard(),
    withErrors(async (context) => {
      const actor = requireStaff(context);
      const accountId = context.req.param('id');
      if (!accountId || accountId.length < 1 || accountId.length > 120) {
        throw new CustomerAuthError('VALIDATION_ERROR', 400);
      }
      const raw = await context.req.text();
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(raw);
      } catch {
        throw new CustomerAuthError('VALIDATION_ERROR', 400);
      }
      const reason = typeof body['reason'] === 'string' ? body['reason'] : '';
      const expectedVersion = typeof body['expected_version'] === 'number' ? body['expected_version'] : -1;
      if (reason.length < 1 || reason.length > 2000 || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
        throw new CustomerAuthError('VALIDATION_ERROR', 400);
      }
      const idempotencyKey = parseIdempotencyKey(
        context.req.header('Idempotency-Key'),
      );
      if (!idempotencyKey) {
        throw new CustomerAuthError('VALIDATION_ERROR', 400);
      }

      const result = await freezeBuyerAuthAccount(
        context.env.DB,
        { accountId, expectedVersion, reason },
        {
          actor: {
            staffId: actor.staffId,
            displayName: actor.displayName,
            roles: [...actor.roles],
            permissions: actor.permissions,
          },
          idempotencyKey,
          requestId: requestIdFromContext(context),
        },
      );

      return context.json(apiSuccess({
        buyer_account: {
          account_id: result.account_id,
          version: result.version,
          session_version: result.session_version,
          status: 'FROZEN',
        },
        replayed: result.replayed,
      }, requestIdFromContext(context)), 200);
    }),
  );
}

function requireStaff(context: Context<any>): CustomerAccessActor {
  const actor = context.get('staffAuthorization') as CustomerAccessActor | null | undefined;
  if (!actor) {
    throw new CustomerAuthError('FORBIDDEN', 403);
  }
  return actor;
}

function withErrors(
  handler: (context: Context<any>) => Promise<Response>,
): (context: Context<any>) => Promise<Response> {
  return async (context) => {
    try {
      return await handler(context);
    } catch (error) {
      const normalized = error instanceof CustomerAuthError
        ? error
        : new CustomerAuthError('DEPENDENCY_UNAVAILABLE', 503);
      context.header('Cache-Control', 'no-store');
      return context.json(
        apiFailure(
          normalized.code as never,
          message(normalized.code),
          requestIdFromContext(context),
        ),
        normalized.status,
      );
    }
  };
}

function message(code: string): string {
  switch (code) {
    case 'FORBIDDEN': return '当前岗位不能冻结买家账号';
    case 'NOT_FOUND': return '买家账号不存在';
    case 'CONFLICT': return '版本不匹配，请刷新后重试';
    case 'VALIDATION_ERROR': return '提交信息不正确';
    case 'IDEMPOTENCY_CONFLICT': return '幂等键已用于不同请求';
    default: return '买家账号冻结暂时不可用，请稍后重试';
  }
}
