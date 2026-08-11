import { apiSuccess, STAFF_SESSION_TTL_MS, type SqlDatabase, type StaffLogoutAllResponse } from '@ygb/contracts';
import { hashCanonicalJson } from '@ygb/domain';
import type { Context, Hono } from 'hono';
import { acquireIdempotency, type IdempotencyError } from '../foundation/idempotency';
import { resolveAssignmentStaffAuthorization, resolveStaffDataScope } from '../staff-assignment';
import { clearStaffSessionCookie, readStaffSessionCookie, writeStaffSessionCookie } from './cookies';
import { generateStaffOpaqueToken } from './crypto';
import { requestIdFromContext, StaffAuthError, staffAuthFailure } from './errors';
import {
  createInternalStaffSession,
  projectStaffSession,
  revokeStaffSession,
  type StaffIdentityRow,
} from './repository';
import { logoutAllStaffSessions } from './logout-all';
import { readCommittedLogoutAllReplay } from './logout-all-replay';
import { resolveTrustedStaffSession } from './session';
import {
  CloudflareAccessError,
  normalizeStaffEmail,
  verifyCloudflareAccessIdentity,
} from './cloudflare-access';

interface EmailIdentityRow {
  identity_id: string;
  staff_id: string;
  normalized_email: string;
  identity_status: 'ACTIVE'|'REVOKED';
  display_name: string;
  staff_status: 'ACTIVE'|'DISABLED';
  authorization_version: number;
  session_version: number;
}

export function registerCloudflareStaffAuthRoutes(app: Hono<any>): void {
  app.post('/api/staff-auth/access/bootstrap', wrap(bootstrap));
  app.get('/api/staff-auth/session', wrap(session));
  app.post('/api/staff-auth/logout', wrap(logout));
  app.post('/api/staff-auth/logout-all', wrap(logoutAll));
}

async function bootstrap(context: Context<any>): Promise<Response> {
  requireAllowedOrigin(context);
  let access;
  try {
    access = await verifyCloudflareAccessIdentity(context.req.raw, context.env, Date.now());
  } catch (error) {
    if (error instanceof CloudflareAccessError) {
      console.warn(JSON.stringify({
        event: 'STAFF_ACCESS_BOOTSTRAP_REJECTED',
        reason: error.reason,
        request_id: requestIdFromContext(context),
        access_jwt_present: Boolean(context.req.header('Cf-Access-Jwt-Assertion')),
        access_email_header_present: Boolean(context.req.header('Cf-Access-Authenticated-User-Email')),
      }));
    }
    if (error instanceof CloudflareAccessError && error.code === 'CONFIGURATION') {
      throw new StaffAuthError('DEPENDENCY_UNAVAILABLE', 503);
    }
    throw new StaffAuthError('UNAUTHENTICATED', 401);
  }
  const identity = await emailIdentity(context.env.DB, access.email);
  const authorization = await resolveAssignmentStaffAuthorization(context.env.DB, identity.staff_id);
  if (!authorization || authorization.authorizationVersion !== identity.authorization_version) {
    throw new StaffAuthError('UNAUTHENTICATED', 401);
  }
  const now = Date.now();
  const existing = readStaffSessionCookie(context);
  if (existing.value && !existing.malformed) {
    const trusted = await resolveTrustedStaffSession(context.env.DB, existing.value, now).catch(() => null);
    if (trusted) await revokeStaffSession(context.env.DB, {
      session: trusted.session, reason: 'SESSION_REPLACED_BY_ACCESS',
      requestId: requestIdFromContext(context), now,
    });
  }
  clearStaffSessionCookie(context);
  const token = generateStaffOpaqueToken();
  const sessionRow = await createInternalStaffSession(context.env.DB, {
    token,
    identity: toStaffIdentity(identity),
    requestId: requestIdFromContext(context),
    now,
    expiresAt: now + STAFF_SESSION_TTL_MS,
  });
  await context.env.DB.prepare(`
    UPDATE staff_email_identities
    SET verified_at=COALESCE(verified_at,?),last_login_at=?,updated_at=MAX(updated_at,?)
    WHERE id=? AND status='ACTIVE'
  `).bind(now, now, now, identity.identity_id).run();
  writeStaffSessionCookie(context, token);
  const dataScope = await resolveStaffDataScope(context.env.DB, authorization);
  context.header('Cache-Control','no-store');
  return context.json(apiSuccess({
    session: projectStaffSession(authorization, dataScope, sessionRow),
    access_email: identity.normalized_email,
  }, requestIdFromContext(context)));
}

async function session(context: Context<any>): Promise<Response> {
  const cookie = readStaffSessionCookie(context);
  if (cookie.malformed || !cookie.value) throw new StaffAuthError('UNAUTHENTICATED',401);
  const trusted = await resolveTrustedStaffSession(context.env.DB,cookie.value);
  const dataScope = await resolveStaffDataScope(context.env.DB,trusted.authorization);
  context.header('Cache-Control','no-store');
  return context.json(apiSuccess({
    session: projectStaffSession(trusted.authorization,dataScope,trusted.session),
  },requestIdFromContext(context)));
}

async function logout(context: Context<any>): Promise<Response> {
  requireAllowedOrigin(context);
  const cookie=readStaffSessionCookie(context); clearStaffSessionCookie(context);
  if(cookie.value&&!cookie.malformed){
    const trusted=await resolveTrustedStaffSession(context.env.DB,cookie.value).catch(()=>null);
    if(trusted)await revokeStaffSession(context.env.DB,{session:trusted.session,reason:'LOGOUT',requestId:requestIdFromContext(context),now:Date.now()});
  }
  context.header('Cache-Control','no-store');
  return context.json(apiSuccess({logged_out:true,all_devices_logged_out:false},requestIdFromContext(context)));
}

async function logoutAll(context: Context<any>): Promise<Response> {
  requireAllowedOrigin(context);
  const key=context.req.header('Idempotency-Key')?.trim()??'';
  if(key.length<8||key.length>128||/[\u0000-\u001f\u007f]/u.test(key))throw new StaffAuthError('VALIDATION_ERROR',400);
  const cookie=readStaffSessionCookie(context);
  if(cookie.malformed||!cookie.value)throw new StaffAuthError('UNAUTHENTICATED',401);
  const replay=await readCommittedLogoutAllReplay(context.env.DB,{sessionToken:cookie.value,idempotencyKey:key});
  if(replay){clearStaffSessionCookie(context);context.header('Cache-Control','no-store');return context.json(apiSuccess(replay.response,requestIdFromContext(context)));}
  const trusted=await resolveTrustedStaffSession(context.env.DB,cookie.value);
  const now=Date.now();
  const requestHash=await hashCanonicalJson({action:'STAFF_LOGOUT_ALL',staff_id:trusted.authorization.staffId,issued_session_version:trusted.session.issued_session_version});
  let acquired;
  try{acquired=await acquireIdempotency<StaffLogoutAllResponse>(context.env.DB,{actorType:'STAFF',actorId:trusted.authorization.staffId,action:'STAFF_LOGOUT_ALL',targetType:'STAFF_USER',targetId:trusted.authorization.staffId,idempotencyKey:key,requestHash},{now});}
  catch(error){throw normalizeIdempotencyError(error);}
  const response=acquired.kind==='REPLAY'?acquired.response:await logoutAllStaffSessions(context.env.DB,{
    staffId:trusted.authorization.staffId,currentSessionId:trusted.session.id,roles:[...trusted.authorization.roles],
    requestId:requestIdFromContext(context),claim:acquired.claim,now,
  });
  clearStaffSessionCookie(context); context.header('Cache-Control','no-store');
  return context.json(apiSuccess(response,requestIdFromContext(context)));
}

async function emailIdentity(database:SqlDatabase, rawEmail:string):Promise<EmailIdentityRow>{
  const email=normalizeStaffEmail(rawEmail); if(!email)throw new StaffAuthError('UNAUTHENTICATED',401);
  const rows=await database.prepare(`
    SELECT identity.id AS identity_id,identity.staff_id,identity.normalized_email,
      identity.status AS identity_status,staff.display_name,staff.status AS staff_status,
      staff.authorization_version,staff.session_version
    FROM staff_email_identities identity JOIN staff_users staff ON staff.id=identity.staff_id
    WHERE identity.normalized_email=? LIMIT 2
  `).bind(email).all<EmailIdentityRow>();
  if(rows.results.length!==1)throw new StaffAuthError('UNAUTHENTICATED',401);
  const row=rows.results[0]!;
  if(row.identity_status!=='ACTIVE'||row.staff_status!=='ACTIVE')throw new StaffAuthError('UNAUTHENTICATED',401);
  return row;
}
function toStaffIdentity(row:EmailIdentityRow):StaffIdentityRow{
  return {identity_id:row.identity_id,staff_id:row.staff_id,identity_status:row.identity_status,
    identity_user_id:null,display_name:row.display_name,staff_status:row.staff_status,
    authorization_version:Number(row.authorization_version),session_version:Number(row.session_version)};
}
function requireAllowedOrigin(context:Context<any>):void{
  const origin=context.req.header('Origin')?.trim()??'';
  if(!origin)throw new StaffAuthError('FORBIDDEN',403);
  const configured=String(context.env.STAFF_AUTH_ALLOWED_ORIGINS??'').split(',').map((v)=>v.trim()).filter(Boolean);
  if(configured.length>0){if(!configured.includes(origin))throw new StaffAuthError('FORBIDDEN',403);return;}
  if(origin!==new URL(context.req.url).origin)throw new StaffAuthError('FORBIDDEN',403);
}
function normalizeIdempotencyError(error:unknown):StaffAuthError{const candidate=error as Partial<IdempotencyError>;if(candidate&&(candidate.status===400||candidate.status===409||candidate.status===503)&&typeof candidate.code==='string')return new StaffAuthError(candidate.code,candidate.status);return new StaffAuthError('DEPENDENCY_UNAVAILABLE',503);}
function wrap(handler:(context:Context<any>)=>Promise<Response>){
  return async(context:Context<any>)=>{try{return await handler(context);}catch(error){return staffAuthFailure(context,error instanceof StaffAuthError?error:new StaffAuthError('DEPENDENCY_UNAVAILABLE',503));}};
}
