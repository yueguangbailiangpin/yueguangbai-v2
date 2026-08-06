import {
  apiFailure,
  apiSuccess,
  type StaffAuthProviderAdapter,
  type StaffAuthProviderBindings,
  type StaffDataScope,
  type SqlDatabase,
} from '@ygb/contracts';
import { Hono } from 'hono';
import type { AssignmentStaffAuthorization } from './staff-assignment';
import type { StaffSessionRow } from './staff-auth';
import {
  errorLogEvent,
  routeGroup,
  writeErrorLog,
} from './observability';

export type AppBindings = StaffAuthProviderBindings & {
  DB: SqlDatabase;
  KEYWORD_IMAGE_GENERATOR?: unknown;
  KEYWORD_GENERATOR_SHARED_SECRET?: string;
  KEYWORD_HMAC_SECRET?: string;
  FILE_OBJECT_STORAGE?: unknown;
  CUSTOMER_SESSION_SECRET?: string;
  CUSTOMER_SECURITY_TOKEN_SECRET?: string;
  STAFF_AUTH_PROVIDER_ADAPTER?: StaffAuthProviderAdapter;
};

export type AppVariables = {
  requestId: string;
  errorLogged: boolean;
  staffAuthorization?: AssignmentStaffAuthorization;
  staffDataScope?: StaffDataScope;
  staffSession?: StaffSessionRow;
};

export type AppEnv = {
  Bindings: AppBindings;
  Variables: AppVariables;
};

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', async (context, next) => {
    const requestId = crypto.randomUUID();
    context.set('requestId', requestId);
    context.set('errorLogged', false);
    context.header('X-Request-ID', requestId);

    await next();

    context.header('X-Content-Type-Options', 'nosniff');
    context.header('Referrer-Policy', 'no-referrer');
    context.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (!context.res.headers.has('Cache-Control')) {
      context.header('Cache-Control', 'no-store');
    }

    if (context.res.status >= 500 && !context.get('errorLogged')) {
      context.set('errorLogged', true);
      writeErrorLog(errorLogEvent({
        request_id: requestId,
        method: context.req.method,
        route_group: routeGroup(new URL(context.req.url).pathname),
        status: context.res.status,
        error_category: 'handled_server_error',
        cf_ray: context.req.header('CF-Ray') ?? null,
      }));
    }
  });

  app.onError((_error, context) => {
    const requestId = context.get('requestId') || crypto.randomUUID();
    context.set('errorLogged', true);
    writeErrorLog(errorLogEvent({
      request_id: requestId,
      method: context.req.method,
      route_group: routeGroup(new URL(context.req.url).pathname),
      status: 500,
      error_category: 'unhandled_exception',
      cf_ray: context.req.header('CF-Ray') ?? null,
    }));

    return context.json(
      apiFailure(
        'DEPENDENCY_UNAVAILABLE',
        '服务暂时不可用，请稍后重试',
        requestId,
      ),
      500,
    );
  });

  app.get('/health', (context) => {
    const requestId = context.get('requestId');
    return context.json(apiSuccess({
      status: 'ok' as const,
      timestamp: Date.now(),
    }, requestId));
  });

  app.notFound((context) => {
    return context.json(
      apiFailure(
        'NOT_FOUND',
        '请求的资源不存在',
        context.get('requestId'),
      ),
      404,
    );
  });

  return app;
}
