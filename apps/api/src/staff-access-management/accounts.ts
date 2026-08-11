import {
  isStaffRoleCode,
  type SqlDatabase,
  type SqlStatement,
  type StaffAccessEmployeeDto,
  type StaffRoleCode,
} from '@ygb/contracts';
import { canonicalJson } from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { normalizeStaffEmail } from '../staff-auth/cloudflare-access';
import { StaffAccessManagementError } from './errors';
import { readStaffAccessEmployee } from './read-model';

interface TargetRow {
  id:string; display_name:string; status:'ACTIVE'|'DISABLED';
  authorization_version:number; session_version:number; version:number;
  role_code:string|null; active_role_count:number; email:string|null;
}
interface ScopeRow { role_code:string; marketplace_code:string; scope_kind:'PRIMARY'|'SUPPORT' }

export async function createStaffAccount(
  database:SqlDatabase,
  input:{ displayName:string; email:string; roleCode:StaffRoleCode; marketplaceCodes:readonly string[] },
  actor:AssignmentStaffAuthorization,
):Promise<StaffAccessEmployeeDto>{
  requireOwner(actor);
  const displayName=text(input.displayName,100); const email=normalizeStaffEmail(input.email);
  if(!email||!isStaffRoleCode(input.roleCode))validation();
  const markets=await normalizedMarkets(database,input.roleCode,input.marketplaceCodes);
  const now=Date.now(); const staffId=crypto.randomUUID(); const identityId=crypto.randomUUID();
  await assertEmailAvailable(database,email,null);
  const scopeKinds=await resolveScopeKinds(database,input.roleCode,markets,null);
  const statements:SqlStatement[]=[
    database.prepare(`INSERT INTO staff_users(id,display_name,status,authorization_version,version,created_at,updated_at,disabled_at)
      VALUES(?,?,'ACTIVE',1,1,?,?,NULL)`).bind(staffId,displayName,now,now),
    database.prepare(`INSERT INTO staff_email_identities(id,staff_id,normalized_email,status,verified_at,last_login_at,created_at,updated_at,revoked_at)
      VALUES(?, ?, ?, 'ACTIVE', NULL, NULL, ?, ?, NULL)`).bind(identityId,staffId,email,now,now),
    database.prepare(`INSERT INTO staff_role_assignments(id,staff_id,role_code,status,assigned_by_staff_id,assigned_at,revoked_at,revoked_by_staff_id,revoked_reason,created_at,updated_at)
      VALUES(?,?,?,'ACTIVE',?,?,NULL,NULL,NULL,?,?)`).bind(crypto.randomUUID(),staffId,input.roleCode,actor.staffId,now,now,now),
    ...markets.map((market)=>database.prepare(`INSERT INTO staff_marketplace_scopes(
      id,staff_id,role_code,marketplace_code,status,assigned_by_staff_id,assigned_at,
      revoked_at,reason,created_at,updated_at,scope_kind
    ) VALUES(?,?,?,?,'ACTIVE',?,?,NULL,'STAFF_ACCOUNT_CREATED',?,?,?)`).bind(
      crypto.randomUUID(),staffId,input.roleCode,market,actor.staffId,now,now,now,scopeKinds.get(market)??'SUPPORT')),
    database.prepare(`INSERT INTO staff_authorization_events(id,staff_id,authorization_version,event_type,actor_staff_id,request_id,idempotency_key,change_summary_json,created_at)
      VALUES(?, ?, 1, 'STAFF_PROVISIONED', ?, NULL, NULL, ?, ?)`).bind(crypto.randomUUID(),staffId,actor.staffId,canonicalJson({email,role_code:input.roleCode,marketplace_codes:markets,scope_kinds:Object.fromEntries(scopeKinds)}),now),
    createAuditEventStatement(database,{id:crypto.randomUUID(),aggregateType:'STAFF',aggregateId:staffId,eventType:'STAFF_EMAIL_ACCOUNT_CREATED',
      actor:{type:'STAFF',id:actor.staffId,roles:[...actor.roles]},requestId:null,idempotencyKey:null,
      nextState:{display_name:displayName,email,role_code:input.roleCode,marketplace_codes:markets,scope_kinds:Object.fromEntries(scopeKinds),status:'ACTIVE'},createdAt:now}),
  ];
  await database.batch(statements);
  return readStaffAccessEmployee(database,staffId);
}

export async function updateStaffAccount(
  database:SqlDatabase,
  staffId:string,
  input:{ displayName:string; email:string; roleCode:StaffRoleCode; marketplaceCodes:readonly string[]; expectedVersion:number },
  actor:AssignmentStaffAuthorization,
):Promise<StaffAccessEmployeeDto>{
  requireOwner(actor); if(staffId===actor.staffId)stateConflict();
  const target=await targetRow(database,staffId); if(!target)notFound();
  if(target.version!==input.expectedVersion)versionConflict();
  if(target.active_role_count!==1||!isStaffRoleCode(target.role_code))dependency();
  const displayName=text(input.displayName,100); const email=normalizeStaffEmail(input.email);
  if(!email||!isStaffRoleCode(input.roleCode))validation();
  const markets=await normalizedMarkets(database,input.roleCode,input.marketplaceCodes);
  await assertEmailAvailable(database,email,staffId);
  if(target.role_code==='owner'&&input.roleCode!=='owner'&&await activeOwnerCount(database)<=1)stateConflict();
  const scopeKinds=await resolveScopeKinds(database,input.roleCode,markets,staffId);
  const now=Date.now(); const nextVersion=target.version+1;
  const statements:SqlStatement[]=[
    database.prepare(`UPDATE staff_users SET display_name=?,authorization_version=authorization_version+1,
      session_version=session_version+1,version=version+1,updated_at=? WHERE id=? AND version=?`)
      .bind(displayName,now,staffId,target.version),
    database.prepare(`UPDATE staff_sessions SET status='REVOKED',revoked_at=?,revoked_reason='STAFF_ACCESS_CHANGED',updated_at=?
      WHERE staff_id=? AND status='ACTIVE'`).bind(now,now,staffId),
  ];
  if(target.email===null){
    statements.push(database.prepare(`INSERT INTO staff_email_identities(id,staff_id,normalized_email,status,verified_at,last_login_at,created_at,updated_at,revoked_at)
      VALUES(?,?,?,'ACTIVE',NULL,NULL,?,?,NULL)`).bind(crypto.randomUUID(),staffId,email,now,now));
  }else{
    statements.push(database.prepare(`UPDATE staff_email_identities SET normalized_email=?,updated_at=? WHERE staff_id=? AND status='ACTIVE'`)
      .bind(email,now,staffId));
  }
  if(target.role_code!==input.roleCode){
    statements.push(database.prepare(`UPDATE staff_role_assignments SET status='REVOKED',revoked_at=?,revoked_by_staff_id=?,revoked_reason='STAFF_ACCOUNT_ROLE_CHANGED',updated_at=?
      WHERE staff_id=? AND status='ACTIVE'`).bind(now,actor.staffId,now,staffId));
    statements.push(database.prepare(`INSERT INTO staff_role_assignments(id,staff_id,role_code,status,assigned_by_staff_id,assigned_at,revoked_at,revoked_by_staff_id,revoked_reason,created_at,updated_at)
      VALUES(?,?,?,'ACTIVE',?,?,NULL,NULL,NULL,?,?)`).bind(crypto.randomUUID(),staffId,input.roleCode,actor.staffId,now,now,now));
  }
  statements.push(database.prepare(`UPDATE staff_marketplace_scopes SET status='REVOKED',revoked_at=?,reason='STAFF_ACCOUNT_SCOPE_CHANGED',updated_at=?
    WHERE staff_id=? AND status='ACTIVE'`).bind(now,now,staffId));
  for(const market of markets)statements.push(database.prepare(`INSERT INTO staff_marketplace_scopes(
    id,staff_id,role_code,marketplace_code,status,assigned_by_staff_id,assigned_at,revoked_at,
    reason,created_at,updated_at,scope_kind
  ) VALUES(?,?,?,?,'ACTIVE',?,?,NULL,'STAFF_ACCOUNT_SCOPE_CHANGED',?,?,?)`).bind(
    crypto.randomUUID(),staffId,input.roleCode,market,actor.staffId,now,now,now,scopeKinds.get(market)??'SUPPORT'));
  statements.push(database.prepare(`INSERT INTO staff_authorization_events(id,staff_id,authorization_version,event_type,actor_staff_id,request_id,idempotency_key,change_summary_json,created_at)
    SELECT ?,id,authorization_version,'STAFF_ACCESS_PROFILE_CHANGED',?,NULL,NULL,?,? FROM staff_users WHERE id=?`)
    .bind(crypto.randomUUID(),actor.staffId,canonicalJson({display_name:displayName,email,role_code:input.roleCode,marketplace_codes:markets,scope_kinds:Object.fromEntries(scopeKinds)}),now,staffId));
  statements.push(createAuditEventStatement(database,{id:crypto.randomUUID(),aggregateType:'STAFF',aggregateId:staffId,eventType:'STAFF_ACCESS_PROFILE_CHANGED',
    actor:{type:'STAFF',id:actor.staffId,roles:[...actor.roles]},requestId:null,idempotencyKey:null,
    previousState:{display_name:target.display_name,email:target.email,role_code:target.role_code,version:target.version},
    nextState:{display_name:displayName,email,role_code:input.roleCode,marketplace_codes:markets,scope_kinds:Object.fromEntries(scopeKinds),version:nextVersion},createdAt:now}));
  await database.batch(statements);
  return readStaffAccessEmployee(database,staffId);
}

export async function changeStaffAccountStatus(
  database:SqlDatabase,staffId:string,input:{status:'ACTIVE'|'DISABLED';expectedVersion:number},actor:AssignmentStaffAuthorization,
):Promise<StaffAccessEmployeeDto>{
  requireOwner(actor); if(staffId===actor.staffId)stateConflict();
  const target=await targetRow(database,staffId); if(!target)notFound();
  if(target.version!==input.expectedVersion||target.status===input.status)versionConflict();
  if(target.active_role_count!==1||!isStaffRoleCode(target.role_code))dependency();
  if(input.status==='DISABLED'&&target.role_code==='owner'&&await activeOwnerCount(database)<=1)stateConflict();
  if(input.status==='ACTIVE'){
    if(!target.email)stateConflict();
    if(target.role_code!=='owner'){
      const row=await database.prepare(`SELECT COUNT(*) AS total FROM staff_marketplace_scopes WHERE staff_id=? AND status='ACTIVE'`).bind(staffId).first<{total:number}>();
      if(Number(row?.total??0)<1)stateConflict();
    }
  }
  const scopes=target.role_code==='owner'?[]:await activeScopes(database,staffId);
  const now=Date.now();
  const statements:SqlStatement[]=[
    database.prepare(`UPDATE staff_users SET status=?,disabled_at=?,authorization_version=authorization_version+1,
      session_version=session_version+1,version=version+1,updated_at=? WHERE id=? AND version=?`)
      .bind(input.status,input.status==='DISABLED'?now:null,now,staffId,target.version),
    database.prepare(`UPDATE staff_sessions SET status='REVOKED',revoked_at=?,revoked_reason='STAFF_ACCESS_STATUS_CHANGED',updated_at=?
      WHERE staff_id=? AND status='ACTIVE'`).bind(now,now,staffId),
  ];
  if(input.status==='DISABLED'){
    statements.push(database.prepare(`UPDATE staff_marketplace_scopes SET scope_kind='SUPPORT',updated_at=?
      WHERE staff_id=? AND status='ACTIVE' AND scope_kind='PRIMARY'`).bind(now,staffId));
    for(const scope of scopes){
      if(scope.scope_kind!=='PRIMARY')continue;
      statements.push(database.prepare(`UPDATE staff_marketplace_scopes SET scope_kind='PRIMARY',updated_at=?
        WHERE id=(
          SELECT candidate.id FROM staff_marketplace_scopes candidate
          JOIN staff_users staff ON staff.id=candidate.staff_id
          WHERE candidate.role_code=? AND candidate.marketplace_code=?
            AND candidate.status='ACTIVE' AND candidate.scope_kind='SUPPORT'
            AND candidate.staff_id<>? AND staff.status='ACTIVE'
          ORDER BY candidate.assigned_at,candidate.id LIMIT 1
        ) AND NOT EXISTS(
          SELECT 1 FROM staff_marketplace_scopes primary_scope
          JOIN staff_users primary_staff ON primary_staff.id=primary_scope.staff_id
          WHERE primary_scope.role_code=? AND primary_scope.marketplace_code=?
            AND primary_scope.status='ACTIVE' AND primary_scope.scope_kind='PRIMARY'
            AND primary_staff.status='ACTIVE'
        )`).bind(now,scope.role_code,scope.marketplace_code,staffId,scope.role_code,scope.marketplace_code));
    }
  }
  statements.push(
    database.prepare(`INSERT INTO staff_authorization_events(id,staff_id,authorization_version,event_type,actor_staff_id,request_id,idempotency_key,change_summary_json,created_at)
      SELECT ?,id,authorization_version,'STAFF_ACCESS_STATUS_CHANGED',?,NULL,NULL,?,? FROM staff_users WHERE id=?`)
      .bind(crypto.randomUUID(),actor.staffId,canonicalJson({status:input.status}),now,staffId),
    createAuditEventStatement(database,{id:crypto.randomUUID(),aggregateType:'STAFF',aggregateId:staffId,eventType:'STAFF_ACCESS_STATUS_CHANGED',
      actor:{type:'STAFF',id:actor.staffId,roles:[...actor.roles]},requestId:null,idempotencyKey:null,
      previousState:{status:target.status,version:target.version},nextState:{status:input.status,version:target.version+1},createdAt:now}),
  );
  await database.batch(statements);
  return readStaffAccessEmployee(database,staffId);
}

async function normalizedMarkets(database:SqlDatabase,role:StaffRoleCode,values:readonly string[]):Promise<string[]>{
  if(role==='owner')return [];
  const markets=[...new Set(values.map((value)=>value.trim()).filter(Boolean))].sort();
  if(markets.length<1||markets.length>10)validation();
  const placeholders=markets.map(()=>'?').join(',');
  const row=await database.prepare(`SELECT COUNT(*) AS total FROM marketplace_registry WHERE code IN (${placeholders})`)
    .bind(...markets).first<{total:number}>();
  if(Number(row?.total??0)!==markets.length)validation();
  return markets;
}

async function resolveScopeKinds(
  database:SqlDatabase,role:StaffRoleCode,markets:readonly string[],excludeStaffId:string|null,
):Promise<Map<string,'PRIMARY'|'SUPPORT'>>{
  const result=new Map<string,'PRIMARY'|'SUPPORT'>();
  if(role==='owner')return result;
  for(const market of markets){
    const row=await database.prepare(`SELECT scope.staff_id FROM staff_marketplace_scopes scope
      JOIN staff_users staff ON staff.id=scope.staff_id
      WHERE scope.role_code=? AND scope.marketplace_code=? AND scope.status='ACTIVE'
        AND scope.scope_kind='PRIMARY' AND staff.status='ACTIVE'
        AND (? IS NULL OR scope.staff_id<>?) LIMIT 1`)
      .bind(role,market,excludeStaffId,excludeStaffId).first<{staff_id:string}>();
    result.set(market,row?'SUPPORT':'PRIMARY');
  }
  return result;
}
async function activeScopes(database:SqlDatabase,staffId:string):Promise<ScopeRow[]>{
  const rows=await database.prepare(`SELECT role_code,marketplace_code,scope_kind FROM staff_marketplace_scopes
    WHERE staff_id=? AND status='ACTIVE' ORDER BY marketplace_code`).bind(staffId).all<ScopeRow>();
  return rows.results;
}
async function assertEmailAvailable(database:SqlDatabase,email:string,excludeStaffId:string|null):Promise<void>{
  const row=await database.prepare(`SELECT staff_id FROM staff_email_identities WHERE normalized_email=? AND (? IS NULL OR staff_id<>?) LIMIT 1`)
    .bind(email,excludeStaffId,excludeStaffId).first<{staff_id:string}>(); if(row)stateConflict();
}
async function targetRow(database:SqlDatabase,staffId:string):Promise<TargetRow|null>{
  return database.prepare(`SELECT staff.id,staff.display_name,staff.status,staff.authorization_version,staff.session_version,staff.version,
    (SELECT role_code FROM staff_role_assignments WHERE staff_id=staff.id AND status='ACTIVE' LIMIT 1) AS role_code,
    (SELECT COUNT(*) FROM staff_role_assignments WHERE staff_id=staff.id AND status='ACTIVE') AS active_role_count,
    (SELECT normalized_email FROM staff_email_identities WHERE staff_id=staff.id AND status='ACTIVE' LIMIT 1) AS email
    FROM staff_users staff WHERE staff.id=?`).bind(staffId).first<TargetRow>();
}
async function activeOwnerCount(database:SqlDatabase):Promise<number>{const row=await database.prepare(`SELECT COUNT(*) AS total FROM staff_users staff JOIN staff_role_assignments role ON role.staff_id=staff.id AND role.status='ACTIVE' AND role.role_code='owner' WHERE staff.status='ACTIVE'`).first<{total:number}>();return Number(row?.total??0);}
function requireOwner(actor:AssignmentStaffAuthorization):void{if(!actor.roles.has('owner')||!actor.permissions.has('STAFF_MANAGE'))throw new StaffAccessManagementError('FORBIDDEN',403);}
function text(value:string,max:number):string{const v=value.normalize('NFKC').trim();if(v.length<1||v.length>max||/[\u0000-\u001f\u007f]/u.test(v))validation();return v;}
function validation():never{throw new StaffAccessManagementError('VALIDATION_ERROR',400)}
function stateConflict():never{throw new StaffAccessManagementError('STATE_CONFLICT',409)}
function versionConflict():never{throw new StaffAccessManagementError('VERSION_CONFLICT',409)}
function notFound():never{throw new StaffAccessManagementError('NOT_FOUND',404)}
function dependency():never{throw new StaffAccessManagementError('DEPENDENCY_UNAVAILABLE',503)}