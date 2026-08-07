import type { FeishuWorkbenchAdapter } from '@ygb/contracts';

export interface FeishuWorkbenchRuntimeBindings {
  FEISHU_WORKBENCH_SYNC_ENABLED?: string;
  FEISHU_WORKBENCH_CALLBACK_ENABLED?: string;
  FEISHU_WORKBENCH_CALLBACK_SECRET?: string;
  FEISHU_WORKBENCH_WEB_ORIGIN?: string;
  FEISHU_WORKBENCH_ADAPTER?: FeishuWorkbenchAdapter;
}

export function feishuWorkbenchRuntime(bindings: FeishuWorkbenchRuntimeBindings) {
  const webOrigin = safeOrigin(bindings.FEISHU_WORKBENCH_WEB_ORIGIN);
  const adapter = bindings.FEISHU_WORKBENCH_SYNC_ENABLED === 'true'
    && webOrigin !== null ? bindings.FEISHU_WORKBENCH_ADAPTER ?? null : null;
  return {
    adapter,
    syncEnabled: adapter !== null,
    callbackEnabled: bindings.FEISHU_WORKBENCH_CALLBACK_ENABLED === 'true'
      && cleanSecret(bindings.FEISHU_WORKBENCH_CALLBACK_SECRET) !== null,
    callbackSecret: cleanSecret(bindings.FEISHU_WORKBENCH_CALLBACK_SECRET),
    webOrigin,
  } as const;
}

function cleanSecret(value: string | undefined): string | null {
  return typeof value === 'string' && value.length >= 32 && value.length <= 1000 ? value : null;
}
function safeOrigin(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.pathname === '/' && !url.search && !url.hash
      && !url.username && !url.password ? url.origin : null;
  } catch { return null; }
}
