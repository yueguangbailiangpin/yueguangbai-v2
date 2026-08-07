import type { DriveArchiveAdapter, ObjectStorageAdapter, SqlDatabase, SupportedFileMime } from '@ygb/contracts';
import { detectSupportedMime, sha256Hex } from '@ygb/domain';

export async function rehydrateArchivedFile(
  database:SqlDatabase,
  r2:ObjectStorageAdapter,
  drive:DriveArchiveAdapter,
  input:{fileObjectId:string;expectedArchiveVersion:number},
  command:{staffId:string;roles:ReadonlySet<string>;permissions:ReadonlySet<string>;idempotencyKey:string;requestId?:string|null;now?:number},
):Promise<{fileObjectId:string;rehydrated:boolean;replayed:boolean}> {
  const now=command.now??Date.now();
  if(!command.roles.has('owner')||!command.permissions.has('SCHEDULED_OPERATIONS_RUN')) throw new Error('archive_rehydration_forbidden');
  if(!safe(input.fileObjectId,120)||!Number.isSafeInteger(input.expectedArchiveVersion)||input.expectedArchiveVersion<1
    ||!safe(command.staffId,200)||!safe(command.idempotencyKey,128)||command.idempotencyKey.length<8
    ||!Number.isSafeInteger(now)||now<0) throw new Error('invalid_archive_rehydration');
  const replay=await database.prepare(`SELECT file_object_id,status FROM file_drive_rehydrations
    WHERE requested_by_staff_id=? AND idempotency_key=?`).bind(command.staffId,command.idempotencyKey)
    .first<{file_object_id:string;status:string}>();
  if(replay) {
    if(replay.file_object_id!==input.fileObjectId) throw new Error('archive_rehydration_idempotency_conflict');
    return {fileObjectId:input.fileObjectId,rehydrated:replay.status==='COMPLETED',replayed:true};
  }
  const source=await database.prepare(`
    SELECT archive.drive_file_id,archive.version,manifest.byte_size,manifest.mime_type,manifest.sha256,object.object_key
    FROM file_drive_archives archive
    JOIN file_drive_archive_manifests manifest ON manifest.file_object_id=archive.file_object_id
    JOIN file_objects object ON object.id=archive.file_object_id
    WHERE archive.file_object_id=? AND archive.status='DRIVE_ARCHIVED'
  `).bind(input.fileObjectId).first<{drive_file_id:string;version:number;byte_size:number;mime_type:SupportedFileMime;sha256:string;object_key:string}>();
  if(!source||source.version!==input.expectedArchiveVersion) throw new Error('archive_rehydration_conflict');
  const id=crypto.randomUUID();
  await database.prepare(`INSERT INTO file_drive_rehydrations(id,file_object_id,target_object_key,status,
    expected_sha256,failure_category,requested_by_staff_id,request_id,idempotency_key,created_at,completed_at)
    VALUES(?,?,?,'STARTED',?,NULL,?,?,?, ?,NULL)`).bind(id,input.fileObjectId,source.object_key,source.sha256,
      command.staffId,command.requestId??null,command.idempotencyKey,now).run();
  try {
    const read=await drive.readFile(source.drive_file_id);
    await verify(read.bytes,source.mime_type,source.byte_size,source.sha256);
    await r2.putObject({objectKey:source.object_key,bytes:read.bytes,contentType:source.mime_type,
      metadata:{file_object_id:input.fileObjectId,sha256:source.sha256,rehydrated:'true'}});
    const head=await r2.headObject(source.object_key);
    if(!head||head.byteSize!==source.byte_size||head.contentType!==source.mime_type||head.checksumSha256!==source.sha256) {
      throw new Error('archive_rehydration_r2_mismatch');
    }
    await database.batch([
      database.prepare(`UPDATE file_drive_rehydrations SET status='COMPLETED',completed_at=?
        WHERE id=? AND status='STARTED'`).bind(now,id),
      database.prepare(`INSERT INTO file_drive_archive_events(id,file_object_id,event_type,previous_status,next_status,
        archive_version,failure_category,metadata_json,created_at) VALUES(?,?,'REHYDRATION_COMPLETED',
        'DRIVE_ARCHIVED','DRIVE_ARCHIVED',?,NULL,'{}',?)`).bind(crypto.randomUUID(),input.fileObjectId,source.version,now),
      database.prepare(`INSERT INTO transaction_assertions(assertion_value) SELECT CASE WHEN EXISTS(
        SELECT 1 FROM file_drive_rehydrations WHERE id=? AND status='COMPLETED') THEN 1 ELSE 0 END`).bind(id),
    ]);
    return {fileObjectId:input.fileObjectId,rehydrated:true,replayed:false};
  } catch(error) {
    await database.prepare(`UPDATE file_drive_rehydrations SET status='FAILED',failure_category='rehydration_failed',completed_at=?
      WHERE id=? AND status='STARTED'`).bind(now,id).run().catch(()=>undefined);
    throw error;
  }
}
async function verify(bytes:Uint8Array<ArrayBuffer>,mime:SupportedFileMime,size:number,hash:string):Promise<void>{
  if(bytes.byteLength!==size||detectSupportedMime(bytes)!==mime||await sha256Hex(bytes)!==hash) throw new Error('archive_rehydration_manifest_mismatch');
}
function safe(value:string,max:number):boolean{return value.length>=1&&value.length<=max&&!/[\u0000-\u001f\u007f]/u.test(value);}
