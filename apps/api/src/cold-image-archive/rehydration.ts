import type { DriveArchiveAdapter,FileDriveRehydrationResultDto,ObjectStorageAdapter,SqlDatabase,SqlStatement,SupportedFileMime } from '@ygb/contracts';
import { detectSupportedMime,hashCanonicalJson,sha256Hex } from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import { acquireIdempotency,assertIdempotencyCompletionStatement,completeIdempotencyStatement,
  IdempotencyError,markIdempotencyFailed,type IdempotencyClaim } from '../foundation/idempotency';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { ColdArchiveCommandError } from './business-closure';

interface Source {drive_file_id:string;version:number;byte_size:number;mime_type:SupportedFileMime;sha256:string;object_key:string}
interface Attempt {id:string;status:'STARTED'|'COMPLETED'|'FAILED';version:number;attempt_count:number;request_hash:string;
  expected_archive_version:number;file_object_id:string}

export async function rehydrateArchivedFile(
  database:SqlDatabase,r2:ObjectStorageAdapter,drive:DriveArchiveAdapter,
  input:{fileObjectId:string;expectedArchiveVersion:number},
  command:{actor:AssignmentStaffAuthorization;idempotencyKey:string;requestId?:string|null;now?:number;afterClaimed?:()=>Promise<void>},
):Promise<FileDriveRehydrationResultDto>{
  requireOwner(command.actor);const fileObjectId=safe(input.fileObjectId,120);const expectedArchiveVersion=positive(input.expectedArchiveVersion);
  const now=timestamp(command.now??Date.now());const requestHash=await hashCanonicalJson({action:'REHYDRATE_DRIVE_ARCHIVE',
    file_object_id:fileObjectId,expected_archive_version:expectedArchiveVersion});
  const acquired=await acquireIdempotency<FileDriveRehydrationResultDto>(database,{actorType:'STAFF',actorId:command.actor.staffId,
    action:'REHYDRATE_DRIVE_ARCHIVE',targetType:'FILE_OBJECT',targetId:fileObjectId,idempotencyKey:command.idempotencyKey,
    requestHash},{now}).catch(translateIdempotency);
  if(acquired.kind==='REPLAY')return {...acquired.response,replayed:true};
  let attempt:Attempt|null=null;
  try{
    await command.afterClaimed?.();
    const source=await database.prepare(`SELECT archive.drive_file_id,archive.version,manifest.byte_size,
      manifest.mime_type,manifest.sha256,object.object_key FROM file_drive_archives archive
      JOIN file_drive_archive_manifests manifest ON manifest.file_object_id=archive.file_object_id
      JOIN file_objects object ON object.id=archive.file_object_id
      WHERE archive.file_object_id=? AND archive.status='DRIVE_ARCHIVED'`).bind(fileObjectId).first<Source>();
    if(!source)throw new ColdArchiveCommandError('NOT_FOUND',404);
    if(source.version!==expectedArchiveVersion)throw new ColdArchiveCommandError('VERSION_CONFLICT',409);
    const id=await hashCanonicalJson({kind:'FILE_DRIVE_REHYDRATION',staff_id:command.actor.staffId,
      idempotency_key:acquired.claim.idempotencyKey});
    attempt=await database.prepare(`SELECT id,status,version,attempt_count,request_hash,expected_archive_version,
      file_object_id FROM file_drive_rehydrations WHERE requested_by_staff_id=? AND idempotency_key=?`)
      .bind(command.actor.staffId,acquired.claim.idempotencyKey).first<Attempt>();
    if(attempt&&(attempt.request_hash!==requestHash||attempt.file_object_id!==fileObjectId
      ||attempt.expected_archive_version!==expectedArchiveVersion))throw new ColdArchiveCommandError('IDEMPOTENCY_CONFLICT',409);
    if(!attempt){
      attempt={id,status:'STARTED',version:1,attempt_count:1,request_hash:requestHash,
        expected_archive_version:expectedArchiveVersion,file_object_id:fileObjectId};
      await database.batch(startStatements(database,{attempt,source,actor:command.actor,claim:acquired.claim,
        requestId:command.requestId??null,now,insert:true}));
    }else{
      if(attempt.status==='COMPLETED')throw new ColdArchiveCommandError('DEPENDENCY_UNAVAILABLE',503);
      const previousVersion=attempt.version;
      attempt={...attempt,status:'STARTED',version:previousVersion+1,attempt_count:attempt.attempt_count+1};
      await database.batch(startStatements(database,{attempt,source,actor:command.actor,claim:acquired.claim,
        requestId:command.requestId??null,now,insert:false,previousVersion}));
    }
    const read=await drive.readFile(source.drive_file_id);await verifyBytes(read.bytes,source.mime_type,source.byte_size,source.sha256);
    const existing=await r2.headObject(source.object_key);
    if(existing){
      if(existing.byteSize!==source.byte_size||existing.contentType!==source.mime_type
        ||existing.checksumSha256!==source.sha256)throw new ColdArchiveCommandError('STATE_CONFLICT',409);
    }else{
      await r2.putObject({objectKey:source.object_key,bytes:read.bytes,contentType:source.mime_type,
        metadata:{file_object_id:fileObjectId,sha256:source.sha256,rehydrated:'true'}});
    }
    const head=await r2.headObject(source.object_key);
    if(!head||head.byteSize!==source.byte_size||head.contentType!==source.mime_type||head.checksumSha256!==source.sha256)
      throw new Error('archive_rehydration_r2_mismatch');
    const response:FileDriveRehydrationResultDto={file_object_id:fileObjectId,status:'COMPLETED',
      archive_version:expectedArchiveVersion,replayed:false};
    await database.batch([
      database.prepare(`UPDATE file_drive_rehydrations SET status='COMPLETED',version=version+1,updated_at=MAX(?,updated_at+1),
        completed_at=? WHERE id=? AND status='STARTED' AND version=?`).bind(now,now,attempt.id,attempt.version),
      changedOnce(database),archiveEvent(database,fileObjectId,'REHYDRATION_COMPLETED',expectedArchiveVersion,null,now),
      audit(database,{eventType:'DRIVE_ARCHIVE_REHYDRATION_COMPLETED',fileObjectId,actor:command.actor,
        requestId:command.requestId??null,idempotencyKey:acquired.claim.idempotencyKey,archiveVersion:expectedArchiveVersion,now}),
      completeIdempotencyStatement(database,acquired.claim,response,{resultReferences:{file_object_id:fileObjectId,
        archive_version:expectedArchiveVersion},now}),
      database.prepare(`INSERT INTO transaction_assertions(assertion_value) SELECT CASE WHEN EXISTS(
        SELECT 1 FROM file_drive_rehydrations WHERE id=? AND status='COMPLETED' AND version=?
      ) THEN 1 ELSE 0 END`).bind(attempt.id,attempt.version+1),assertIdempotencyCompletionStatement(database,acquired.claim),
    ]);
    return response;
  }catch(error){
    const normalized=normalize(error);
    if(attempt?.status==='STARTED')await failAttempt(database,{attempt,actor:command.actor,claim:acquired.claim,
      requestId:command.requestId??null,fileObjectId,archiveVersion:expectedArchiveVersion,category:normalized.code,now}).catch(()=>undefined);
    else await markIdempotencyFailed(database,acquired.claim,normalized.code,now).catch(()=>false);
    throw normalized;
  }
}

function startStatements(database:SqlDatabase,input:{attempt:Attempt;source:Source;actor:AssignmentStaffAuthorization;
  claim:IdempotencyClaim;requestId:string|null;now:number;insert:boolean;previousVersion?:number}):SqlStatement[]{
  const mutation=input.insert?database.prepare(`INSERT INTO file_drive_rehydrations(id,file_object_id,target_object_key,status,
    expected_sha256,expected_archive_version,request_hash,failure_category,requested_by_staff_id,request_id,idempotency_key,
    attempt_count,version,created_at,updated_at,completed_at) VALUES(?,?,?,'STARTED',?,?,?,NULL,?,?,?,?,1,?,?,NULL)`)
    .bind(input.attempt.id,input.attempt.file_object_id,input.source.object_key,input.source.sha256,input.source.version,
      input.attempt.request_hash,input.actor.staffId,input.requestId,input.claim.idempotencyKey,input.attempt.attempt_count,input.now,input.now)
    :database.prepare(`UPDATE file_drive_rehydrations SET status='STARTED',failure_category=NULL,completed_at=NULL,
      attempt_count=attempt_count+1,version=version+1,updated_at=MAX(?,updated_at+1)
      WHERE id=? AND status IN ('STARTED','FAILED') AND version=?`).bind(input.now,input.attempt.id,input.previousVersion);
  return [mutation,changedOnce(database),archiveEvent(database,input.attempt.file_object_id,'REHYDRATION_STARTED',
    input.source.version,null,input.now),audit(database,{eventType:'DRIVE_ARCHIVE_REHYDRATION_STARTED',
      fileObjectId:input.attempt.file_object_id,actor:input.actor,requestId:input.requestId,
      idempotencyKey:input.claim.idempotencyKey,archiveVersion:input.source.version,now:input.now}),
    database.prepare(`INSERT INTO transaction_assertions(assertion_value) SELECT CASE WHEN EXISTS(
      SELECT 1 FROM file_drive_rehydrations WHERE id=? AND status='STARTED' AND version=? AND attempt_count=?
    ) THEN 1 ELSE 0 END`).bind(input.attempt.id,input.attempt.version,input.attempt.attempt_count)];
}
async function failAttempt(database:SqlDatabase,input:{attempt:Attempt;actor:AssignmentStaffAuthorization;claim:IdempotencyClaim;
  requestId:string|null;fileObjectId:string;archiveVersion:number;category:string;now:number}):Promise<void>{
  await database.batch([database.prepare(`UPDATE file_drive_rehydrations SET status='FAILED',failure_category=?,
    completed_at=?,version=version+1,updated_at=MAX(?,updated_at+1) WHERE id=? AND status='STARTED' AND version=?`)
    .bind(input.category,input.now,input.now,input.attempt.id,input.attempt.version),changedOnce(database),
    archiveEvent(database,input.fileObjectId,'REHYDRATION_FAILED',input.archiveVersion,input.category,input.now),
    audit(database,{eventType:'DRIVE_ARCHIVE_REHYDRATION_FAILED',fileObjectId:input.fileObjectId,actor:input.actor,
      requestId:input.requestId,idempotencyKey:input.claim.idempotencyKey,archiveVersion:input.archiveVersion,
      failureCategory:input.category,now:input.now}),database.prepare(`UPDATE command_idempotency_records SET status='FAILED',
      response_json=NULL,result_references_json=NULL,error_code=?,updated_at=? WHERE actor_type=? AND actor_id=?
      AND idempotency_key=? AND action=? AND target_type=? AND target_id=? AND request_hash=? AND status='PROCESSING'
      AND lease_token=?`).bind(input.category,input.now,input.claim.actorType,input.claim.actorId,input.claim.idempotencyKey,
        input.claim.action,input.claim.targetType,input.claim.targetId,input.claim.requestHash,input.claim.leaseToken),changedOnce(database),
    database.prepare(`INSERT INTO transaction_assertions(assertion_value) SELECT CASE WHEN EXISTS(
      SELECT 1 FROM file_drive_rehydrations WHERE id=? AND status='FAILED' AND version=?
    ) THEN 1 ELSE 0 END`).bind(input.attempt.id,input.attempt.version+1)]);
}
function archiveEvent(database:SqlDatabase,fileId:string,eventType:string,archiveVersion:number,failure:string|null,now:number):SqlStatement{
  return database.prepare(`INSERT INTO file_drive_archive_events(id,file_object_id,event_type,previous_status,next_status,
    archive_version,failure_category,metadata_json,created_at) VALUES(?,? ,?,'DRIVE_ARCHIVED','DRIVE_ARCHIVED',?,?, '{}',?)`)
    .bind(crypto.randomUUID(),fileId,eventType,archiveVersion,failure,now);
}
function audit(database:SqlDatabase,input:{eventType:string;fileObjectId:string;actor:AssignmentStaffAuthorization;
  requestId:string|null;idempotencyKey:string;archiveVersion:number;failureCategory?:string;now:number}):SqlStatement{
  return createAuditEventStatement(database,{id:crypto.randomUUID(),aggregateType:'FILE_DRIVE_REHYDRATION',
    aggregateId:input.fileObjectId,eventType:input.eventType,actor:{type:'STAFF',id:input.actor.staffId,
      roles:[...input.actor.roles]},requestId:input.requestId,idempotencyKey:input.idempotencyKey,
    nextState:{file_object_id:input.fileObjectId,archive_version:input.archiveVersion,
      ...(input.failureCategory?{failure_category:input.failureCategory}:{})},createdAt:input.now});
}
async function verifyBytes(bytes:Uint8Array<ArrayBuffer>,mime:SupportedFileMime,size:number,hash:string):Promise<void>{
  if(bytes.byteLength!==size||detectSupportedMime(bytes)!==mime||await sha256Hex(bytes)!==hash)throw new Error('archive_rehydration_manifest_mismatch');
}
function changedOnce(database:SqlDatabase):SqlStatement{return database.prepare(`INSERT INTO transaction_assertions(assertion_value)
  SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END`);}
function requireOwner(actor:AssignmentStaffAuthorization):void{if(actor.staffStatus!=='ACTIVE'||!actor.roles.has('owner')
  ||!actor.permissions.has('SCHEDULED_OPERATIONS_RUN'))throw new ColdArchiveCommandError('FORBIDDEN',403);}
function safe(value:string,max:number):string{if(typeof value!=='string'||value.length<1||value.length>max||/[\u0000-\u001f\u007f]/u.test(value))throw new ColdArchiveCommandError('VALIDATION_ERROR',400);return value;}
function positive(value:number):number{if(!Number.isSafeInteger(value)||value<1)throw new ColdArchiveCommandError('VALIDATION_ERROR',400);return value;}
function timestamp(value:number):number{if(!Number.isSafeInteger(value)||value<0)throw new ColdArchiveCommandError('VALIDATION_ERROR',400);return value;}
function translateIdempotency(error:unknown):never{throw normalize(error);}
function normalize(error:unknown):ColdArchiveCommandError{if(error instanceof ColdArchiveCommandError)return error;if(error instanceof IdempotencyError){if(error.code==='IDEMPOTENCY_CONFLICT')return new ColdArchiveCommandError('IDEMPOTENCY_CONFLICT',409);if(error.code==='REQUEST_IN_PROGRESS')return new ColdArchiveCommandError('REQUEST_IN_PROGRESS',409);if(error.code==='VALIDATION_ERROR')return new ColdArchiveCommandError('VALIDATION_ERROR',400);}return new ColdArchiveCommandError('DEPENDENCY_UNAVAILABLE',503);}
