import { afterEach,describe,expect,it } from 'vitest';
import type { FileActor,ObjectStorageHead,ObjectStoragePutInput,ObjectStoragePutResult } from '@ygb/contracts';
import { createMigratedTestDatabase,type SqliteDatabase } from '@ygb/testkit';
import type { FileAuthorizationService } from '../files/authorization';
import { consumeFileReadIntent,createFileReadIntent } from '../files/file-read-service';
import { MockObjectStorage } from '../files/mock-object-storage';
import { runScheduledOperations } from '../scheduled-operations/runner';
import { reconcileDriveArchiveBatch,runDriveArchiveBatch } from './job';
import { MockDriveArchiveAdapter } from './mock-drive-adapter';
import { recordOrderBusinessClosure,reopenOrderBusinessClosure } from './business-closure';
import { rehydrateArchivedFile } from './rehydration';
import { archiveDueAt } from './time';
import { COLD_ARCHIVE_CONFIRMED_AT,coldArchiveOwner,seedConfirmedColdArchiveOrder,
  settleColdArchivePrincipal } from '../../test-support/cold-archive-fixture';

const png=new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
const fileActor:FileActor={type:'STAFF',id:'cold-archive-owner',roles:['owner']};
const allow:FileAuthorizationService={assertCanCreateUpload:()=>{},assertCanUpload:()=>{},assertCanCompleteUpload:()=>{},assertCanLink:()=>{},assertCanRead:()=>{}};
let database:SqliteDatabase|null=null;
afterEach(()=>{database?.close();database=null;});

describe('Drive cold archive safety pipeline with enforced production constraints',()=>{
  it('closes only after real seller principal settlement and uses source completion time, not a late command',async()=>{
    database=createMigratedTestDatabase();
    const order=await seedConfirmedColdArchiveOrder(database,'boundary');
    await expect(recordOrderBusinessClosure(database,{formalOrderId:order.formalOrderId,expectedVersion:0,
      notApplicable:['review','buyer_refund','seller_principal','seller_service_fee'],reason:'不适用项确认'},
      {actor:coldArchiveOwner,idempotencyKey:'cold-close-too-early',now:COLD_ARCHIVE_CONFIRMED_AT+1})).rejects.toMatchObject({code:'STATE_CONFLICT'});
    const settled=await settleColdArchivePrincipal(database,{suffix:'boundary',...order,proofBytes:png});
    const lateCommand=Date.UTC(2027,0,31,16,0,0);
    const closure=await recordOrderBusinessClosure(database,{formalOrderId:order.formalOrderId,expectedVersion:0,
      notApplicable:['review','buyer_refund','seller_service_fee'],reason:'评论、返款和服务费明确不适用'},
      {actor:coldArchiveOwner,idempotencyKey:'cold-close-boundary',now:lateCommand});
    expect(closure.business_closed_at).toBe(settled.completedAt);
    expect(closure.archive_due_at).toBe(archiveDueAt(settled.completedAt));
    expect(closure.archive_due_at).toBeLessThan(lateCommand+183*86_400_000);
    const replay=await recordOrderBusinessClosure(database,{formalOrderId:order.formalOrderId,expectedVersion:0,
      notApplicable:['review','buyer_refund','seller_service_fee'],reason:'评论、返款和服务费明确不适用'},
      {actor:coldArchiveOwner,idempotencyKey:'cold-close-boundary',now:lateCommand+1});
    expect(replay.replayed).toBe(true);
  });

  it('resumes, verifies Drive read-back, and deletes R2 only after every gate',async()=>{
    database=createMigratedTestDatabase();const r2=new MockObjectStorage();const drive=new MockDriveArchiveAdapter();
    const fixture=await seed(database,r2,'resume');await enable(database,true);drive.interruptNextUpload();
    const first=await run(database,r2,drive,fixture.dueAt);
    expect(first).toMatchObject({processed:1,succeeded:0,failed:0});
    expect(await state(database,fixture.fileId)).toMatchObject({status:'DRIVE_COPYING',resumable_session_key:`mock-session:${fixture.fileId}`});
    expect(await r2.headObject(fixture.key)).not.toBeNull();
    const second=await run(database,r2,drive,fixture.dueAt+1);
    expect(second.succeeded).toBe(1);expect(await state(database,fixture.fileId)).toMatchObject({status:'DRIVE_ARCHIVED'});
    expect(await r2.headObject(fixture.key)).toBeNull();
    const events=await database.prepare(`SELECT event_type,archive_version FROM file_drive_archive_events
      WHERE file_object_id=? ORDER BY created_at,event_type`).bind(fixture.fileId).all();
    expect(events.results.map((row)=>row['event_type'])).toEqual(expect.arrayContaining([
      'ELIGIBILITY_RECORDED','COPY_STARTED','COPY_RESUMED','DRIVE_UPLOAD_RECORDED','DRIVE_VERIFIED','R2_DELETE_REQUESTED','DRIVE_ARCHIVED']));
  });

  it('retains R2 on Drive or delete failure and resumes safely',async()=>{
    database=createMigratedTestDatabase();let r2=new MockObjectStorage();let drive=new MockDriveArchiveAdapter();
    let fixture=await seed(database,r2,'read-failure');await enable(database,true);drive.failNext('read');
    expect((await run(database,r2,drive,fixture.dueAt)).failed).toBe(1);
    expect(await r2.headObject(fixture.key)).not.toBeNull();
    expect(await state(database,fixture.fileId)).toMatchObject({status:'DRIVE_COPYING',last_failure_category:'read_back_failed'});
    database.close();database=createMigratedTestDatabase();r2=new MockObjectStorage();drive=new MockDriveArchiveAdapter();
    fixture=await seed(database,r2,'delete-failure');await enable(database,true);r2.failNext('delete',fixture.key);
    expect((await run(database,r2,drive,fixture.dueAt)).failed).toBe(1);
    expect(await state(database,fixture.fileId)).toMatchObject({status:'R2_DELETE_PENDING',last_failure_category:'r2_delete_failed'});
    expect(await r2.headObject(fixture.key)).not.toBeNull();
    expect((await run(database,r2,drive,fixture.dueAt+60_001)).succeeded).toBe(1);
    expect(await r2.headObject(fixture.key)).toBeNull();
  });

  it('rolls back verified state and Manifest when its audit event insertion fails',async()=>{
    database=createMigratedTestDatabase();const r2=new MockObjectStorage();const drive=new MockDriveArchiveAdapter();
    const fixture=await seed(database,r2,'atomic');await enable(database,false);
    database.exec(`CREATE TRIGGER test_fail_verified_event BEFORE INSERT ON file_drive_archive_events
      WHEN NEW.event_type='DRIVE_VERIFIED' BEGIN SELECT RAISE(ABORT,'injected_event_failure'); END;`);
    expect((await run(database,r2,drive,fixture.dueAt)).failed).toBe(1);
    expect(await state(database,fixture.fileId)).toMatchObject({status:'DRIVE_COPYING'});
    expect(await database.prepare(`SELECT COUNT(*) AS count FROM file_drive_archive_events
      WHERE file_object_id=? AND event_type='DRIVE_VERIFIED'`).bind(fixture.fileId).first()).toEqual({count:0});
    expect(await database.prepare(`SELECT COUNT(*) AS count FROM file_drive_archive_manifests
      WHERE file_object_id=?`).bind(fixture.fileId).first()).toEqual({count:0});
    expect(drive.uploadCalls).toBe(1);expect(await r2.headObject(fixture.key)).not.toBeNull();
  });

  it('proxies authorized archived bytes, validates both manifest and source, and never reads Drive on denial',async()=>{
    database=createMigratedTestDatabase();const r2=new MockObjectStorage();const drive=new MockDriveArchiveAdapter();
    const fixture=await seed(database,r2,'read');await enable(database,true);
    const link=await database.prepare(`SELECT id FROM file_entity_links WHERE file_object_id=? AND entity_type='SELLER_SETTLEMENT'`)
      .bind(fixture.fileId).first<{id:string}>();if(!link)throw new Error('missing_settlement_link');
    const intent=await createFileReadIntent(database,allow,{fileObjectId:fixture.fileId,fileEntityLinkId:link.id,expectedFileVersion:2,ttlMs:60_000},
      {actor:fileActor,principal:{type:'STAFF_SESSION',staffId:'cold-archive-owner'},idempotencyKey:'cold-read-intent-1',now:fixture.dueAt-1});
    if(!intent.accessToken)throw new Error('missing_read_token');await run(database,r2,drive,fixture.dueAt);
    const content=await consumeFileReadIntent(database,r2,allow,{readIntentId:intent.readIntentId,accessToken:intent.accessToken},
      {actor:fileActor,principal:{type:'STAFF_SESSION',staffId:'cold-archive-owner'},now:fixture.dueAt+1},{adapter:drive,proxyReadEnabled:true});
    expect(content.bytes).toEqual(png);expect(JSON.stringify(content)).not.toMatch(/drive_file_id|object_key|mock-drive/u);
    const second=await createFileReadIntent(database,allow,{fileObjectId:fixture.fileId,fileEntityLinkId:link.id,expectedFileVersion:2,ttlMs:60_000},
      {actor:fileActor,principal:{type:'STAFF_SESSION',staffId:'cold-archive-owner'},idempotencyKey:'cold-read-intent-2',now:fixture.dueAt+2});
    if(!second.accessToken)throw new Error('missing_read_token');const reads=drive.readCalls;
    await database.prepare(`INSERT INTO staff_permission_overrides(staff_id,permission_code,effect,reason,status,
      assigned_by_staff_id,assigned_at,revoked_at,created_at,updated_at)
      VALUES('cold-archive-owner','SELLER_SETTLEMENT_VIEW','DENY','测试个人拒绝','ACTIVE',NULL,?,NULL,?,?)`)
      .bind(fixture.dueAt+2,fixture.dueAt+2,fixture.dueAt+2).run();
    await expect(consumeFileReadIntent(database,r2,allow,{readIntentId:second.readIntentId,accessToken:second.accessToken},
      {actor:fileActor,principal:{type:'STAFF_SESSION',staffId:'cold-archive-owner'},now:fixture.dueAt+3},{adapter:drive,proxyReadEnabled:true})).rejects.toBeTruthy();
    expect(drive.readCalls).toBe(reads);
  });

  it('uses a lease so concurrent runners upload once and supports shadow mode',async()=>{
    database=createMigratedTestDatabase();const r2=new MockObjectStorage();const drive=new MockDriveArchiveAdapter();
    const fixture=await seed(database,r2,'concurrent');await enable(database,false);
    const results=await Promise.all([run(database,r2,drive,fixture.dueAt,false),run(database,r2,drive,fixture.dueAt,false)]);
    expect(results.reduce((sum,value)=>sum+value.succeeded,0)).toBe(1);expect(drive.uploadCalls).toBe(1);
    expect(await state(database,fixture.fileId)).toMatchObject({status:'DRIVE_VERIFIED'});
    expect(await r2.headObject(fixture.key)).not.toBeNull();
  });

  it('rechecks closure immediately before deletion and preserves R2 after reopen',async()=>{
    database=createMigratedTestDatabase();const r2=new MockObjectStorage();const drive=new MockDriveArchiveAdapter();
    const fixture=await seed(database,r2,'delete-recheck');await enable(database,false);
    await run(database,r2,drive,fixture.dueAt,false);
    expect(await state(database,fixture.fileId)).toMatchObject({status:'DRIVE_VERIFIED'});
    await reopenOrderBusinessClosure(database,{formalOrderId:fixture.orderId,expectedVersion:1,reason:'删除前业务更正'},
      {actor:coldArchiveOwner,idempotencyKey:'cold-reopen-delete-recheck',now:fixture.dueAt});
    await enable(database,true);
    expect((await run(database,r2,drive,fixture.dueAt+1)).succeeded).toBe(0);
    expect(await state(database,fixture.fileId)).toMatchObject({status:'DRIVE_VERIFIED'});
    expect(await r2.headObject(fixture.key)).not.toBeNull();
  });

  it('executes the scheduler runner dry-run with zero Drive, R2, archive, manifest, or reconciliation writes',async()=>{
    database=createMigratedTestDatabase();const r2=new CountingStorage();const drive=new MockDriveArchiveAdapter();
    const fixture=await seed(database,r2,'dryrun');await enable(database,true);r2.reset();
    const result=await runScheduledOperations(database,{enabled:true,only:'drive_archive',dryRun:true,storage:r2,
      driveAdapter:drive,driveArchiveEnabled:true,driveArchiveCopyEnabled:true,driveArchiveProxyReadEnabled:true,
      driveArchiveR2DeleteEnabled:true,now:fixture.dueAt});
    expect(result[0]).toMatchObject({processed_count:0,succeeded_count:0,failed_count:0});
    expect(result[0]!.backlog_count).toBeGreaterThan(0);
    expect({uploads:drive.uploadCalls,reads:drive.readCalls,...r2.calls}).toEqual({uploads:0,reads:0,put:0,head:0,read:0,delete:0});
    const facts=await database.prepare(`SELECT
      (SELECT COUNT(*) FROM file_drive_archives) AS archives,
      (SELECT COUNT(*) FROM file_drive_archive_manifests) AS manifests,
      (SELECT COUNT(*) FROM file_drive_archive_reconciliations) AS reconciliations`).first();
    expect(facts).toEqual({archives:0,manifests:0,reconciliations:0});
  });

  it('rehydrates owner-only with request hash/version idempotency and a recoverable R2 commit',async()=>{
    database=createMigratedTestDatabase();const r2=new MockObjectStorage();const drive=new MockDriveArchiveAdapter();
    const fixture=await seed(database,r2,'rehydrate');await enable(database,true);await run(database,r2,drive,fixture.dueAt);
    const archived=await database.prepare(`SELECT version FROM file_drive_archives WHERE file_object_id=?`)
      .bind(fixture.fileId).first<{version:number}>();if(!archived)throw new Error('missing_archive');
    const result=await rehydrateArchivedFile(database,r2,drive,{fileObjectId:fixture.fileId,expectedArchiveVersion:archived.version},
      {actor:coldArchiveOwner,idempotencyKey:'cold-rehydrate-1',now:fixture.dueAt+1});
    expect(result).toMatchObject({status:'COMPLETED',replayed:false});expect(await r2.headObject(fixture.key)).not.toBeNull();
    expect(await rehydrateArchivedFile(database,r2,drive,{fileObjectId:fixture.fileId,expectedArchiveVersion:archived.version},
      {actor:coldArchiveOwner,idempotencyKey:'cold-rehydrate-1',now:fixture.dueAt+2})).toMatchObject({replayed:true});
    await expect(rehydrateArchivedFile(database,r2,drive,{fileObjectId:fixture.fileId,expectedArchiveVersion:archived.version+1},
      {actor:coldArchiveOwner,idempotencyKey:'cold-rehydrate-1',now:fixture.dueAt+3})).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
    expect(await database.prepare(`SELECT COUNT(*) AS count FROM audit_events WHERE aggregate_type='FILE_DRIVE_REHYDRATION'`)
      .first()).toEqual({count:2});
  });

  it('reports in-progress concurrent rehydration and retries the same failed request safely',async()=>{
    database=createMigratedTestDatabase();const r2=new MockObjectStorage();const drive=new MockDriveArchiveAdapter();
    const fixture=await seed(database,r2,'rehydrate-concurrent');await enable(database,true);await run(database,r2,drive,fixture.dueAt);
    const archived=await database.prepare(`SELECT version FROM file_drive_archives WHERE file_object_id=?`)
      .bind(fixture.fileId).first<{version:number}>();if(!archived)throw new Error('missing_archive');
    let release!:()=>void;const gate=new Promise<void>((resolve)=>{release=resolve;});let claimed!:()=>void;
    const reached=new Promise<void>((resolve)=>{claimed=resolve;});
    const first=rehydrateArchivedFile(database,r2,drive,{fileObjectId:fixture.fileId,expectedArchiveVersion:archived.version},
      {actor:coldArchiveOwner,idempotencyKey:'cold-rehydrate-concurrent',now:fixture.dueAt+1,
        afterClaimed:async()=>{claimed();await gate;}});
    await reached;
    await expect(rehydrateArchivedFile(database,r2,drive,{fileObjectId:fixture.fileId,expectedArchiveVersion:archived.version},
      {actor:coldArchiveOwner,idempotencyKey:'cold-rehydrate-concurrent',now:fixture.dueAt+1}))
      .rejects.toMatchObject({code:'REQUEST_IN_PROGRESS'});
    release();await expect(first).resolves.toMatchObject({status:'COMPLETED'});

    const secondFixture=await seed(database,r2,'rehydrate-retry');await run(database,r2,drive,secondFixture.dueAt);
    const secondArchived=await database.prepare(`SELECT version FROM file_drive_archives WHERE file_object_id=?`)
      .bind(secondFixture.fileId).first<{version:number}>();if(!secondArchived)throw new Error('missing_archive');
    drive.failNext('read');
    await expect(rehydrateArchivedFile(database,r2,drive,{fileObjectId:secondFixture.fileId,expectedArchiveVersion:secondArchived.version},
      {actor:coldArchiveOwner,idempotencyKey:'cold-rehydrate-retry',now:secondFixture.dueAt+1}))
      .rejects.toMatchObject({code:'DEPENDENCY_UNAVAILABLE'});
    await expect(rehydrateArchivedFile(database,r2,drive,{fileObjectId:secondFixture.fileId,expectedArchiveVersion:secondArchived.version},
      {actor:coldArchiveOwner,idempotencyKey:'cold-rehydrate-retry',now:secondFixture.dueAt+2}))
      .resolves.toMatchObject({status:'COMPLETED'});
    expect(await database.prepare(`SELECT status,attempt_count FROM file_drive_rehydrations WHERE file_object_id=?`)
      .bind(secondFixture.fileId).first()).toEqual({status:'COMPLETED',attempt_count:2});
  });

  it('reconciles within a deadline and records Drive failures without deleting the permanent copy',async()=>{
    database=createMigratedTestDatabase();const r2=new MockObjectStorage();const drive=new MockDriveArchiveAdapter();
    const fixture=await seed(database,r2,'reconcile');await enable(database,true);await run(database,r2,drive,fixture.dueAt);
    expect(await reconcileDriveArchiveBatch(database,drive,{now:fixture.dueAt+1,limit:1})).toEqual({processed:1,succeeded:1,failed:0});
    expect(await reconcileDriveArchiveBatch(database,drive,{now:fixture.dueAt+2,limit:1,deadlineReached:()=>true}))
      .toEqual({processed:0,succeeded:0,failed:0});
    drive.tamper(`mock-drive:${fixture.fileId}`,{bytes:new Uint8Array([1,2,3]),byteSize:3});
    expect(await reconcileDriveArchiveBatch(database,drive,{now:fixture.dueAt+3,limit:1})).toEqual({processed:1,succeeded:0,failed:1});
    expect(drive.files.size).toBe(1);
  });

  it('reopens only versioned closed facts and blocks reopen after permanent archive',async()=>{
    database=createMigratedTestDatabase();const r2=new MockObjectStorage();const drive=new MockDriveArchiveAdapter();
    const fixture=await seed(database,r2,'reopen');
    const reopened=await reopenOrderBusinessClosure(database,{formalOrderId:fixture.orderId,expectedVersion:1,reason:'业务更正'},
      {actor:coldArchiveOwner,idempotencyKey:'cold-reopen-before',now:fixture.dueAt-1});
    expect(reopened.status).toBe('REOPENED');
    await recordOrderBusinessClosure(database,{formalOrderId:fixture.orderId,expectedVersion:2,
      notApplicable:['review','buyer_refund','seller_service_fee'],reason:'更正后重新关闭'},
      {actor:coldArchiveOwner,idempotencyKey:'cold-reclose-before',now:fixture.dueAt-1});
    await enable(database,true);await run(database,r2,drive,fixture.dueAt);
    await expect(reopenOrderBusinessClosure(database,{formalOrderId:fixture.orderId,expectedVersion:3,reason:'归档后错误重开'},
      {actor:coldArchiveOwner,idempotencyKey:'cold-reopen-after',now:fixture.dueAt+1})).rejects.toMatchObject({code:'STATE_CONFLICT'});
  });
});

async function seed(db:SqliteDatabase,r2:MockObjectStorage,suffix:string){
  const order=await seedConfirmedColdArchiveOrder(db,suffix);
  const settled=await settleColdArchivePrincipal(db,{suffix,...order,proofBytes:png});
  const closure=await recordOrderBusinessClosure(db,{formalOrderId:order.formalOrderId,expectedVersion:0,
    notApplicable:['review','buyer_refund','seller_service_fee'],reason:'本订单三项明确不适用'},
    {actor:coldArchiveOwner,idempotencyKey:`cold-close-${suffix}`,now:settled.completedAt+1000});
  await r2.putObject({objectKey:settled.objectKey,bytes:png,contentType:'image/png',metadata:{}});
  return {fileId:settled.fileId,key:settled.objectKey,dueAt:closure.archive_due_at,orderId:order.formalOrderId};
}
async function enable(db:SqliteDatabase,deleteEnabled:boolean){await db.prepare(`UPDATE drive_archive_controls SET copy_enabled=1,
  proxy_read_enabled=1,r2_delete_enabled=?,version=version+1,updated_at=updated_at+1`).bind(deleteEnabled?1:0).run();}
async function state(db:SqliteDatabase,fileId:string){return db.prepare(`SELECT status,resumable_session_key,last_failure_category,
  drive_file_id,verified_at,r2_deleted_at FROM file_drive_archives WHERE file_object_id=?`).bind(fileId).first<Record<string,unknown>>();}
function run(db:SqliteDatabase,r2:MockObjectStorage,drive:MockDriveArchiveAdapter,now:number,deleteEnabled=true){return runDriveArchiveBatch(db,r2,drive,
  {now,limit:1,copyEnabled:true,proxyReadEnabled:true,r2DeleteEnabled:deleteEnabled});}

class CountingStorage extends MockObjectStorage{
  calls={put:0,head:0,read:0,delete:0};reset(){this.calls={put:0,head:0,read:0,delete:0};}
  override async putObject(input:ObjectStoragePutInput):Promise<ObjectStoragePutResult>{this.calls.put+=1;return super.putObject(input);}
  override async headObject(key:string):Promise<ObjectStorageHead|null>{this.calls.head+=1;return super.headObject(key);}
  override async readObject(key:string):Promise<Uint8Array<ArrayBuffer>>{this.calls.read+=1;return super.readObject(key);}
  override async deleteObject(key:string):Promise<void>{this.calls.delete+=1;return super.deleteObject(key);}
}
