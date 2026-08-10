import type { FeishuWorkbenchAdapter } from '@ygb/contracts';
import type { OperationalAlertSink } from '../scheduled-operations/signals';
import { FeishuTaskV2Adapter } from './production-adapter';

export interface FeishuWorkbenchRuntimeBindings {
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
}

export function feishuWorkbenchRuntime(bindings: FeishuWorkbenchRuntimeBindings) {
  const webOrigin = safeOrigin(bindings.FEISHU_WORKBENCH_WEB_ORIGIN);
  const tenantKey = cleanValue(bindings.FEISHU_WORKBENCH_TENANT_KEY, 200);
  const appId = cleanValue(bindings.FEISHU_WORKBENCH_APP_ID, 128);
  const encryptKey = cleanSecret(bindings.FEISHU_WORKBENCH_ENCRYPT_KEY);
  const verificationToken = cleanSecret(bindings.FEISHU_WORKBENCH_VERIFICATION_TOKEN, 16);
  const syncRequested = bindings.FEISHU_WORKBENCH_SYNC_ENABLED === 'true';
  const alertRequested = bindings.FEISHU_OPERATIONAL_ALERT_ENABLED === 'true';
  const needsProductionAdapter = (syncRequested
    && bindings.FEISHU_WORKBENCH_ADAPTER === undefined)
    || (alertRequested && bindings.FEISHU_OPERATIONAL_ALERT_SINK === undefined);
  const productionAdapter = needsProductionAdapter
    && webOrigin !== null && tenantKey !== null
    ? createProductionAdapter(bindings, tenantKey, appId, webOrigin)
    : null;
  const adapter = syncRequested && webOrigin !== null && tenantKey !== null
    ? bindings.FEISHU_WORKBENCH_ADAPTER ?? productionAdapter : null;
  const alertSink = alertRequested && webOrigin !== null && tenantKey !== null
    ? bindings.FEISHU_OPERATIONAL_ALERT_SINK ?? productionAdapter : null;
  return {
    adapter,
    alertSink,
    syncEnabled: adapter !== null,
    alertEnabled: alertSink !== null,
    callbackEnabled: bindings.FEISHU_WORKBENCH_CALLBACK_ENABLED === 'true'
      && tenantKey !== null && appId !== null && encryptKey !== null && verificationToken !== null,
    appId,
    tenantKey,
    encryptKey,
    verificationToken,
    webOrigin,
  } as const;
}

function createProductionAdapter(
  bindings:FeishuWorkbenchRuntimeBindings,
  tenantKey:string,
  appId:string|null,
  webOrigin:string,
):FeishuTaskV2Adapter|null {
  const appSecret=cleanSecret(bindings.FEISHU_WORKBENCH_APP_SECRET);
  if(!appId||!appSecret||bindings.FEISHU_WORKBENCH_API_ORIGIN!=='https://open.feishu.cn') return null;
  const requestTimeoutMs=integer(bindings.FEISHU_WORKBENCH_REQUEST_TIMEOUT_MS,100,10_000);
  const maxAttempts=integer(bindings.FEISHU_WORKBENCH_MAX_ATTEMPTS,1,3);
  const rateLimitPerSecond=integer(bindings.FEISHU_WORKBENCH_RATE_LIMIT_PER_SECOND,1,10);
  const alertEnabled=bindings.FEISHU_OPERATIONAL_ALERT_ENABLED==='true';
  const operationalAlertChatId=alertEnabled
    ? cleanSecret(bindings.FEISHU_OPERATIONAL_ALERT_CHAT_ID,8) : null;
  const operationalAlertRateLimitPerSecond=alertEnabled
    ? integer(bindings.FEISHU_OPERATIONAL_ALERT_RATE_LIMIT_PER_SECOND,1,5) : null;
  if(requestTimeoutMs===null||maxAttempts===null||rateLimitPerSecond===null
    ||(alertEnabled&&(operationalAlertChatId===null
      ||operationalAlertRateLimitPerSecond===null)))return null;
  try{return new FeishuTaskV2Adapter({
    apiOrigin:bindings.FEISHU_WORKBENCH_API_ORIGIN,
    appId,
    appSecret,
    tenantKey,
    requestTimeoutMs,
    maxAttempts,
    rateLimitPerSecond,
    ...(alertEnabled?{
      operationalAlertChatId:operationalAlertChatId!,
      operationalAlertWebOrigin:webOrigin,
      operationalAlertRateLimitPerSecond:operationalAlertRateLimitPerSecond!,
    }:{}),
  });}catch{return null;}
}
function cleanSecret(value: string | undefined,minimum=32): string | null {
  return typeof value === 'string' && value.length >= minimum && value.length <= 1000 && !/[\u0000-\u001f\u007f]/u.test(value) ? value : null;
}
function cleanValue(value:string|undefined,maximum:number):string|null {
  return typeof value==='string'&&value.length>=1&&value.length<=maximum&&!/[\u0000-\u001f\u007f]/u.test(value)?value:null;
}
function integer(value:string|undefined,minimum:number,maximum:number):number|null {
  if(typeof value!=='string'||!/^\d+$/u.test(value))return null;
  const parsed=Number(value);return Number.isSafeInteger(parsed)&&parsed>=minimum&&parsed<=maximum?parsed:null;
}
function safeOrigin(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.pathname === '/' && !url.search && !url.hash
      && !url.username && !url.password ? url.origin : null;
  } catch { return null; }
}
