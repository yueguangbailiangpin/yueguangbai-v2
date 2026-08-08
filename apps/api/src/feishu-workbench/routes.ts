import { apiFailure } from '@ygb/contracts';
import type { Hono } from 'hono';
import { handleFeishuWorkbenchCallback, FeishuWorkbenchCallbackError, verifyAndDecodeFeishuWorkbenchCallback } from './callback';
import { feishuWorkbenchRuntime } from './runtime';

const MAX_CALLBACK_BODY_BYTES=16*1024;

export function registerFeishuWorkbenchRoutes(app:Hono<any>):void {
  app.post('/api/feishu-workbench/callback',async(context)=>{
    const runtime=feishuWorkbenchRuntime(context.env);
    const requestId=String(context.get('requestId')??crypto.randomUUID());
    try {
      if(!runtime.callbackEnabled) throw new FeishuWorkbenchCallbackError('DEPENDENCY_UNAVAILABLE',503);
      const body=await readBoundedUtf8Body(context.req.raw,MAX_CALLBACK_BODY_BYTES);
      const now=Date.now();
      const verified=await verifyAndDecodeFeishuWorkbenchCallback({
        encryptKey:runtime.encryptKey,verificationToken:runtime.verificationToken,
        appId:runtime.appId,tenantKey:runtime.tenantKey,
        signature:context.req.header('X-Lark-Signature')??null,
        timestamp:context.req.header('X-Lark-Request-Timestamp')??null,
        nonce:context.req.header('X-Lark-Request-Nonce')??null,body,now,
      });
      if(verified.kind==='CHALLENGE') return context.json({challenge:verified.challenge},200,{'Cache-Control':'no-store'});
      const result=await handleFeishuWorkbenchCallback(context.env.DB,{callback:verified.callback,nonceHash:verified.nonceHash,payloadHash:verified.payloadHash,now,requestId});
      const toast=result.outcome==='SUCCEEDED'
        ? {type:'success',content:'任务已更新，请在月光白网页确认正式业务动作'}
        : result.outcome==='IN_PROGRESS'
          ? {type:'info',content:'任务处理中，请稍后在月光白网页查看'}
          : {type:'warning',content:'任务未更新，请刷新月光白网页后重试'};
      return context.json({toast},200,{'Cache-Control':'no-store'});
    } catch(error) {
      const normalized=error instanceof FeishuWorkbenchCallbackError?error:new FeishuWorkbenchCallbackError('DEPENDENCY_UNAVAILABLE',503);
      const messages={VALIDATION_ERROR:'回调参数不正确',UNAUTHENTICATED:'回调验证失败',FORBIDDEN:'无权执行该操作',NOT_FOUND:'资源不存在',VERSION_CONFLICT:'数据已发生变化，请刷新后重试',DEPENDENCY_UNAVAILABLE:'服务暂时不可用，请稍后重试'} as const;
      return context.json(apiFailure(normalized.code,messages[normalized.code],requestId),normalized.status);
    }
  });
}

async function readBoundedUtf8Body(request:Request,maximum:number):Promise<string> {
  const length=request.headers.get('content-length');
  if(length!==null&&(!/^\d+$/u.test(length)||Number(length)>maximum)) throw new FeishuWorkbenchCallbackError('VALIDATION_ERROR',400);
  if(!request.body) return '';
  const reader=request.body.getReader();
  const chunks:Uint8Array[]=[];
  let size=0;
  try {
    while(true) {
      const next=await reader.read();
      if(next.done) break;
      size+=next.value.byteLength;
      if(size>maximum) { await reader.cancel(); throw new FeishuWorkbenchCallbackError('VALIDATION_ERROR',400); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const raw=new Uint8Array(size); let offset=0;
  for(const chunk of chunks) { raw.set(chunk,offset); offset+=chunk.byteLength; }
  try { return new TextDecoder('utf-8',{fatal:true}).decode(raw); } catch { throw new FeishuWorkbenchCallbackError('VALIDATION_ERROR',400); }
}
