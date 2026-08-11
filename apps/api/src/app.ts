import {
  apiFailure,
  apiSuccess,
  type StaffAuthProviderAdapter,
  type StaffAuthProviderBindings,
  type StaffDataScope,
  type ObjectStorageAdapter,
  type DriveArchiveAdapter,
  type FeishuWorkbenchAdapter,
  type SqlDatabase,
} from '@ygb/contracts';
import { Hono } from 'hono';
import type { AssignmentStaffAuthorization } from './staff-assignment';
import type { StaffSessionRow } from './staff-auth';
import type { StaffMcpProductionRuntimeBindings } from './staff-mcp/runtime';
import { errorLogEvent,routeGroup,writeErrorLog } from './observability';
import { recordWorker5xxSignal,resolveOperationalAlertSink,type OperationalAlertSink } from './scheduled-operations/signals';
import { installSellerMemberPrivilegeSessionRotation } from './seller-portal/member-privilege-session-rotation';

export type AppBindings = StaffAuthProviderBindings
  & StaffMcpProductionRuntimeBindings
  & {
  DB: SqlDatabase;
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
  ACQUISITION_MACHINE_SHARED_SECRET?: string;
  STAFF_AUTH_PROVIDER_ADAPTER?: StaffAuthProviderAdapter;
  OUTBOX_DELIVERY_ADAPTER?: { deliver(event: { id: string; eventType: string; payloadJson: string }): Promise<void> };
  SCHEDULED_OPERATIONS_ENABLED?: string;
  SCHEDULED_OPERATIONS_DISABLED_JOBS?: string;
  ACQUISITION_MAINTENANCE_ENABLED?: string;
  OPERATIONAL_ALERT_SINK?: OperationalAlertSink;
  OPERATIONAL_ALERT_MODE?: string;
  FEISHU_WORKBENCH_SYNC_ENABLED?: string;
  FEISHU_WORKBENCH_CALLBACK_ENABLED?: string;
  FEISHU_WORKBENCH_WEB_ORIGIN?: string;
  FEISHU_WORKBENCH_API_ORIGIN?: string;
  FEISHU_WORKBENCH_APP_ID?: string;
  FEISHU_WORKBENCH_APP_SECRET?: string;
  FEISHU_WORKBENCH_TENANT_KEY?: string;
  FEISHU_WORKBENCH_ENCRYPT_KEY?: string;
  FEISHU_WORKBENCH_VERIFICATION_TOKEN?: string;
  FEISHU_WORKBENCH_REQUEST_TIMEOUT_MS?: string;
  FEISHU_WORKBENCH_MAX_ATTEMPTS?: string;
  FEISHU_WORKBENCH_RATE_LIMIT_PER_SECOND?: string;
  FEISHU_WORKBENCH_ADAPTER?: FeishuWorkbenchAdapter;
  FEISHU_OPERATIONAL_ALERT_ENABLED?: string;
  FEISHU_OPERATIONAL_ALERT_CHAT_ID?: string;
  FEISHU_OPERATIONAL_ALERT_RATE_LIMIT_PER_SECOND?: string;
  FEISHU_OPERATIONAL_ALERT_SINK?: OperationalAlertSink;
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

  // Runs around the member-registration route that will be registered later in
  // index.ts. It replaces the just-issued cookie after a privilege-version bump.
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
  bindings:Pick<AppBindings,'OPERATIONAL_ALERT_MODE'|'OPERATIONAL_ALERT_SINK'|'FEISHU_OPERATIONAL_ALERT_SINK'>,
  feishuSink:OperationalAlertSink|null=bindings.FEISHU_OPERATIONAL_ALERT_SINK??null,
):OperationalAlertSink|null {
  try {
    const primary=resolveOperationalAlertSink({
      ...((bindings.OPERATIONAL_ALERT_MODE!==undefined)?{mode:bindings.OPERATIONAL_ALERT_MODE}:{}),
      ...(bindings.OPERATIONAL_ALERT_SINK?{localSink:bindings.OPERATIONAL_ALERT_SINK}:{}),
    });
    if(primary!==null&&feishuSink!==null)return null;
    return primary??feishuSink;
  } catch { return null; }
}
