import { apiFailure,apiSuccess,type SqlDatabase } from '@ygb/contracts';
import { hashCanonicalJson,parseIdempotencyKey,readBoundedJson } from '@ygb/domain';
import type { Context,Hono } from 'hono';
import type { AppEnv } from '../app';
import { createAuditEventStatement } from '../foundation/audit';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  IdempotencyError,
  markIdempotencyFailed,
  type IdempotencyClaim,
} from '../foundation/idempotency';
import { createOutboxStatements,prepareOutboxEvent } from '../foundation/outbox';
import { requestIdFromContext } from '../http-auth/errors';
import { customerAuthOriginGuard } from '../middleware/origin-guard';
import type { AssignmentStaffAuthorization } from '../staff-assignment';

const BODY_LIMIT=16*1024;
const MAX_ATTESTATION_LIFETIME_MS=7*24*60*60*1000;
const MAX_CLOCK_SKEW_MS=5*60*1000;
export const OPERATIONAL_ALERT_ATTESTATION_EVENT='OPERATIONAL_ALERT_SINK_ATTESTED';
export const OPERATIONAL_ALERT_ATTESTATION_AGGREGATE='OPERATIONAL_ALERT_ATTESTATION';

export interface OperationalAlertAttestation {
  attestation_id:string;
  release_sha:string;
  sink_identity:string;
  sink_config_fingerprint:string;
  verified_at:number;
  expires_at:number;
  delivery_result:'PASS';
  failure_result:'PASS';
  recovery_result:'PASS';
  evidence_reference:string;
  verified_by_staff_id:string;
}

class AlertAttestationError extends Error{
  constructor(public readonly code:'VALIDATION_ERROR'|'FORBIDDEN'|'CONFLICT'|'DEPENDENCY_UNAVAILABLE',public readonly status:400|403|409|503){super(code);}
}

export function registerOperationalAlertAttestationRoutes(app:Hono<AppEnv>):void{
  app.post('/api/staff/production-readiness/operational-alert-attestations',customerAuthOriginGuard(),wrap(async(context)=>{
    const actor=owner(context);
    const body=await exactBody(context,[
      'release_sha','sink_identity','sink_config_fingerprint','verified_at','expires_at',
      'delivery_result','failure_result','recovery_result','evidence_reference',
    ]);
    const attested=normalizeAttestationInput(body,actor.staffId);
    assertAttestationMatchesRuntime(attested,context.env,Date.now());
    const idempotencyKey=idempotency(context);
    const requestHash=await hashCanonicalJson({action:'ATTEST_OPERATIONAL_ALERT_SINK',payload:attestationPayload(attested)});
    const aggregateId=`${attested.release_sha}:${attested.sink_config_fingerprint}`;
    const acquired=await acquireIdempotency<OperationalAlertAttestation>(context.env.DB,{
      actorType:'STAFF',actorId:actor.staffId,idempotencyKey,requestHash,
      action:'ATTEST_OPERATIONAL_ALERT_SINK',targetType:OPERATIONAL_ALERT_ATTESTATION_AGGREGATE,targetId:aggregateId,
    });
    if(acquired.kind==='REPLAY')return success(context,acquired.response,200);
    const claim=acquired.claim,now=Date.now();
    const response:OperationalAlertAttestation={...attested,attestation_id:crypto.randomUUID()};
    try{
      const outbox=await prepareOutboxEvent({
        id:crypto.randomUUID(),dedupKey:`operational-alert-attestation:${response.attestation_id}`,
        eventType:OPERATIONAL_ALERT_ATTESTATION_EVENT,aggregateType:OPERATIONAL_ALERT_ATTESTATION_AGGREGATE,
        aggregateId,payload:response,createdAt:now,
      });
      await context.env.DB.batch([
        createAuditEventStatement(context.env.DB,{
          id:response.attestation_id,aggregateType:OPERATIONAL_ALERT_ATTESTATION_AGGREGATE,aggregateId,
          eventType:OPERATIONAL_ALERT_ATTESTATION_EVENT,
          actor:{type:'STAFF',id:actor.staffId,roles:[...actor.roles]},requestId:requestIdFromContext(context),idempotencyKey,
          nextState:response,reason:response.evidence_reference,createdAt:now,
        }),
        context.env.DB.prepare(`INSERT INTO transaction_assertions(assertion_value) SELECT CASE WHEN EXISTS(SELECT 1 FROM audit_events WHERE id=? AND event_type=? AND actor_type='STAFF') THEN 1 ELSE 0 END`).bind(response.attestation_id,OPERATIONAL_ALERT_ATTESTATION_EVENT),
        ...createOutboxStatements(context.env.DB,outbox),
        completeIdempotencyStatement(context.env.DB,claim,response,{now,resultReferences:{attestation_id:response.attestation_id,outbox_id:outbox.input.id}}),
        assertIdempotencyCompletionStatement(context.env.DB,claim),
      ]);
    }catch(error){await fail(context.env.DB,claim,now);throw error;}
    return success(context,response,201);
  }));
}

export async function operationalAlertAttestationReady(database:SqlDatabase,bindings:Record<string,unknown>,now:number):Promise<boolean>{
  if(bindings['APP_ENVIRONMENT']!=='production')return true;
  const release=releaseSha(bindings['APP_RELEASE_SHA']);
  const identity=sinkIdentity(bindings['OPERATIONAL_ALERT_SINK_IDENTITY']);
  const fingerprint=fingerprintSha(bindings['OPERATIONAL_ALERT_SINK_CONFIG_FINGERPRINT']);
  if(!release||!identity||!fingerprint)return false;
  const row=await database.prepare(`SELECT next_state_json FROM audit_events WHERE aggregate_type=? AND event_type=? AND actor_type='STAFF' ORDER BY created_at DESC,id DESC LIMIT 1`).bind(OPERATIONAL_ALERT_ATTESTATION_AGGREGATE,OPERATIONAL_ALERT_ATTESTATION_EVENT).first<{next_state_json:string}>();
  if(!row)return false;
  try{
    const value=JSON.parse(row.next_state_json) as unknown;
    if(!value||typeof value!=='object'||Array.isArray(value))return false;
    const record=value as Record<string,unknown>;
    if(Object.keys(record).length!==11)return false;
    const parsed=normalizeAttestationInput(record,String(record['verified_by_staff_id']??''),String(record['attestation_id']??''));
    return parsed.release_sha===release&&parsed.sink_identity===identity&&parsed.sink_config_fingerprint===fingerprint&&validTiming(parsed,now);
  }catch{return false;}
}

function normalizeAttestationInput(body:Record<string,unknown>,staffId:string,attestationId?:string):OperationalAlertAttestation{
  const release=releaseSha(body['release_sha']),identity=sinkIdentity(body['sink_identity']),fingerprint=fingerprintSha(body['sink_config_fingerprint']);
  const verifiedAt=integer(body['verified_at']),expiresAt=integer(body['expires_at']);
  const evidence=text(body['evidence_reference'],8,1000);
  if(!release||!identity||!fingerprint||verifiedAt===null||expiresAt===null||!evidence
    ||body['delivery_result']!=='PASS'||body['failure_result']!=='PASS'||body['recovery_result']!=='PASS'
    ||!safeLabel(staffId,200))validation();
  const id=attestationId??'pending';if(!safeLabel(id,200))validation();
  return{attestation_id:id,release_sha:release,sink_identity:identity,sink_config_fingerprint:fingerprint,verified_at:verifiedAt,expires_at:expiresAt,delivery_result:'PASS',failure_result:'PASS',recovery_result:'PASS',evidence_reference:evidence,verified_by_staff_id:staffId};
}
function attestationPayload(value:OperationalAlertAttestation){return{release_sha:value.release_sha,sink_identity:value.sink_identity,sink_config_fingerprint:value.sink_config_fingerprint,verified_at:value.verified_at,expires_at:value.expires_at,delivery_result:value.delivery_result,failure_result:value.failure_result,recovery_result:value.recovery_result,evidence_reference:value.evidence_reference};}

function assertAttestationMatchesRuntime(value:OperationalAlertAttestation,bindings:AppEnv['Bindings'],now:number):void{
  if(bindings.APP_ENVIRONMENT!=='production'||bindings.OPERATIONAL_ALERT_MODE!=='bound'
    ||value.release_sha!==releaseSha(bindings.APP_RELEASE_SHA)
    ||value.sink_identity!==sinkIdentity(bindings.OPERATIONAL_ALERT_SINK_IDENTITY)
    ||value.sink_config_fingerprint!==fingerprintSha(bindings.OPERATIONAL_ALERT_SINK_CONFIG_FINGERPRINT)
    ||!validTiming(value,now))throw new AlertAttestationError('CONFLICT',409);
}
function validTiming(value:Pick<OperationalAlertAttestation,'verified_at'|'expires_at'>,now:number):boolean{return value.verified_at<=now+MAX_CLOCK_SKEW_MS&&value.expires_at>now&&value.expires_at>value.verified_at&&value.expires_at-value.verified_at<=MAX_ATTESTATION_LIFETIME_MS;}
function releaseSha(value:unknown):string|null{if(typeof value!=='string')return null;const normalized=value.trim().toLowerCase();return /^[0-9a-f]{40}$/u.test(normalized)?normalized:null;}
function fingerprintSha(value:unknown):string|null{if(typeof value!=='string')return null;const normalized=value.trim().toLowerCase();return /^[0-9a-f]{64}$/u.test(normalized)?normalized:null;}
function sinkIdentity(value:unknown):string|null{if(typeof value!=='string')return null;const normalized=value.normalize('NFKC').trim();return safeLabel(normalized,200)&&normalized.length>=8&&!normalized.startsWith('REQUIRED_')&&/^[A-Za-z0-9._:/@-]+$/u.test(normalized)?normalized:null;}
function integer(value:unknown):number|null{return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;}
function text(value:unknown,min:number,max:number):string|null{if(typeof value!=='string')return null;const normalized=value.normalize('NFKC').trim();return normalized.length>=min&&safeLabel(normalized,max)?normalized:null;}
function safeLabel(value:string,max:number):boolean{return value.length>=1&&value.length<=max&&!/[\u0000-\u001f\u007f]/u.test(value);}
function owner(context:Context<AppEnv>):AssignmentStaffAuthorization{const actor=context.get('staffAuthorization') as AssignmentStaffAuthorization|undefined;if(!actor||actor.staffStatus!=='ACTIVE'||!actor.roles.has('owner')||!actor.permissions.has('AUDIT_VIEW'))throw new AlertAttestationError('FORBIDDEN',403);return actor;}
function idempotency(context:Context<AppEnv>):string{try{const value=parseIdempotencyKey(context.req.header('Idempotency-Key'));if(value)return value;}catch{}validation();}
async function exactBody(context:Context<AppEnv>,keys:readonly string[]):Promise<Record<string,unknown>>{let value:unknown;try{value=await readBoundedJson(context.req.raw,BODY_LIMIT);}catch{validation();}if(!value||typeof value!=='object'||Array.isArray(value))validation();const body=value as Record<string,unknown>;if(Object.keys(body).length!==keys.length||keys.some((key)=>!Object.hasOwn(body,key)))validation();return body;}
function validation():never{throw new AlertAttestationError('VALIDATION_ERROR',400);}
async function fail(database:SqlDatabase,claim:IdempotencyClaim,now:number):Promise<void>{await markIdempotencyFailed(database,claim,'OPERATIONAL_ALERT_ATTESTATION_FAILED',now).catch(()=>false);}
function success(context:Context<AppEnv>,data:unknown,status:200|201){context.header('Cache-Control','no-store');return context.json(apiSuccess(data,requestIdFromContext(context)),status);}
function wrap(handler:(context:Context<AppEnv>)=>Promise<Response>){return async(context:Context<AppEnv>)=>{try{return await handler(context);}catch(error){const e=error instanceof AlertAttestationError||error instanceof IdempotencyError?error:new AlertAttestationError('DEPENDENCY_UNAVAILABLE',503);const message=e.code==='FORBIDDEN'?'只有总管理员可以登记告警演练证明':e.code==='CONFLICT'?'告警演练证明与当前 release、sink 配置或有效期不匹配':e.code==='IDEMPOTENCY_CONFLICT'?'幂等键已用于其他请求':e.code==='REQUEST_IN_PROGRESS'?'相同请求正在处理中':e.code==='VALIDATION_ERROR'?'告警演练证明内容不正确':'告警演练证明服务暂时不可用';return context.json(apiFailure(e.code,message,requestIdFromContext(context)),e.status);}};}
