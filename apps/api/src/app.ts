import {
  apiFailure,
  apiSuccess,
  type StaffAuthProviderBindings,
  type StaffDataScope,
  type ObjectStorageAdapter,
  type DriveArchiveAdapter,
  type SqlDatabase,
} from '@ygb/contracts';
import { Hono } from 'hono';
import type { AssignmentStaffAuthorization } from './staff-assignment';
import type { StaffSessionRow } from './staff-auth';
import type { StaffMcpProductionRuntimeBindings } from './staff-mcp/runtime';
import { errorLogEvent,routeGroup,writeErrorLog } from './observability';
import { recordWorker5xxSignal,resolveOperationalAlertSink,type OperationalAlertSink } from './scheduled-operations/signals';
import { installSellerMemberPrivilegeSessionRotation } from './seller-portal/member-privilege-session-rotation';
import type { OperationalAlertServiceBinding } from './operational-readiness/alert-sink-contract';

export type AppBindings = StaffAuthProviderBindings
  & StaffMcpProductionRuntimeBindings
  & {
  DB: SqlDatabase;
  APP_ENVIRONMENT?: string;
  APP_RELEASE_SHA?: string;
  KEYWORD_IMAGE_GENERATOR?: unknown;
  KEYWORD_GENERATOR_SHARED_SECRET?: string;
  KEYWORD_HMAC_SECRET?: string;
  FILE_OBJECT_STORAGE?: ObjectStorageAdapter;
  DRIVE_ARCHIVE_ADAPTER?: DriveArchiveAdapter;
  DRIVE_ARCHIVE_ENABLED?: string;
  DRIVE_ARCHIVE_COPY_ENABLED?: string;
  DRIVE_ARCHIVE_PROXY_READ_ENABLED?: string;
  DRIVE_ARCHIVE_R2_DELETE_ENABLED?: string;
  GOOGLE_DRIVE_CLIENT_ID?: string;
  GOOGLE_DRIVE_CLIENT_SECRET?: string;
  GOOGLE_DRIVE_REFRESH_TOKEN?: string;
  GOOGLE_DRIVE_FOLDER_ID?: string;
  GOOGLE_DRIVE_OWNER_ACCOUNT_KEY?: string;
  CUSTOMER_SESSION_SECRET?: string;
  CUSTOMER_SECURITY_TOKEN_SECRET?: string;
  OUTBOX_DELIVERY_ADAPTER?: { deliver(event: { id: string; eventType: string; payloadJson: string }): Promise<void> };
  SCHEDULED_OPERATIONS_ENABLED?: string;
  SCHEDULED_OPERATIONS_DISABLED_JOBS?: string;
  ACQUISITION_MAINTENANCE_ENABLED?: string;
  OPERATIONAL_ALERT_SINK?: OperationalAlertSink|OperationalAlertServiceBinding;
  OPERATIONAL_ALERT_MODE?: string;
  OPERATIONAL_ALERT_SINK_SERVICE?: string;
  OPERATIONAL_ALERT_SINK_ENTRYPOINT?: string;
  OPERATIONAL_ALERT_SINK_IDENTITY?: string;
  OPERATIONAL_ALERT_SINK_DEPLOYMENT_VERSION?: string;
  OPERATIONAL_ALERT_SINK_CONFIG_FINGERPRINT?: string;
  SELLER_PRINCIPAL_RATE_ENFORCEMENT_ENABLED?: string;
};

export type AppVariables = {
  requestId: string;
  errorLogged: boolean;
  staffAuthorization?: AssignmentStaffAuthorization;
  staffDataScope?: StaffDataScope;
  staffSession?: StaffSessionRow;
};
export type AppEnv = { Bindings: AppBindings; Variables: AppVariables };

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
    if (!context.res.headers.has('Cache-Control')) context.header('Cache-Control', 'no-store');
    if (context.res.status >= 500 && !context.get('errorLogged')) {
      context.set('errorLogged', true);
      writeErrorLog(errorLogEvent({request_id:requestId,method:context.req.method,route_group:routeGroup(new URL(context.req.url).pathname),status:context.res.status,error_category:'handled_server_error',cf_ray:context.req.header('CF-Ray') ?? null}));
      if (context.env?.DB) {
        const sink=configuredAlertSink(context.env);
        await recordWorker5xxSignal(context.env.DB,{requestId,observedAt:Date.now(),...(sink?{sink}:{})}).catch(()=>undefined);
      }
    }
  });

  // Registration privilege changes are committed atomically by migration 0062.
  // This middleware only reissues the current-device cookie at the new version.
  installSellerMemberPrivilegeSessionRotation(app);

  app.onError(async (_error, context) => {
    const requestId = context.get('requestId') || crypto.randomUUID();
    context.set('errorLogged', true);
    writeErrorLog(errorLogEvent({request_id:requestId,method:context.req.method,route_group:routeGroup(new URL(context.req.url).pathname),status:500,error_category:'unhandled_exception',cf_ray:context.req.header('CF-Ray') ?? null}));
    if (context.env?.DB) {
      const sink=configuredAlertSink(context.env);
      await recordWorker5xxSignal(context.env.DB,{requestId,observedAt:Date.now(),...(sink?{sink}:{})}).catch(()=>undefined);
    }
    return context.json(apiFailure('DEPENDENCY_UNAVAILABLE','服务暂时不可用，请稍后重试',requestId),500);
  });

  app.get('/health', (context) => {
    const requestId = context.get('requestId');
    return context.json(apiSuccess({status:'ok' as const,timestamp:Date.now()},requestId));
  });
  app.notFound((context) => context.json(apiFailure('NOT_FOUND','请求的资源不存在',context.get('requestId')),404));
  return app;
}

export function configuredAlertSink(
  bindings:Pick<AppBindings,'APP_ENVIRONMENT'|'OPERATIONAL_ALERT_MODE'|'OPERATIONAL_ALERT_SINK'>,
):OperationalAlertSink|null {
  try {
    const mode=bindings.OPERATIONAL_ALERT_MODE;
    if(mode==='local'&&bindings.APP_ENVIRONMENT!=='local')return null;
    if(mode==='bound'&&bindings.APP_ENVIRONMENT!=='production')return null;
    return resolveOperationalAlertSink({
      ...(mode!==undefined?{mode}:{}),
      ...(bindings.OPERATIONAL_ALERT_SINK&&mode==='bound'?{boundSink:bindings.OPERATIONAL_ALERT_SINK}:{}),
      ...(bindings.OPERATIONAL_ALERT_SINK&&mode!=='bound'?{localSink:bindings.OPERATIONAL_ALERT_SINK}:{}),
    });
  } catch { return null; }
}
