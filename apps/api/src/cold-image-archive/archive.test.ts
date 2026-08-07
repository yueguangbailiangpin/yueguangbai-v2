import { afterEach,describe,expect,it } from 'vitest';
import type { FileActor } from '@ygb/contracts';
import { createMigratedTestDatabase,type SqliteDatabase } from '@ygb/testkit';
import type { FileAuthorizationService } from '../files/authorization';
import { consumeFileReadIntent,createFileReadIntent } from '../files/file-read-service';
import { MockObjectStorage } from '../files/mock-object-storage';
import { reconcileDriveArchiveBatch,runDriveArchiveBatch } from './job';
import { MockDriveArchiveAdapter } from './mock-drive-adapter';
import { recordOrderBusinessClosure,reopenOrderBusinessClosure } from './business-closure';
import { rehydrateArchivedFile } from './rehydration';

const png=new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1,2,3]);
const actor:FileActor={type:'STAFF',id:'archive-owner',roles:['owner']};
const allow:FileAuthorizationService={assertCanCreateUpload:()=>{},assertCanUpload:()=>{},assertCanCompleteUpload:()=>{},assertCanLink:()=>{},assertCanRead:()=>{}};
let database:SqliteDatabase|null=null;
afterEach(()=>{database?.close();database=null;});

describe('Drive cold archive safety pipeline',()=>{
  it('resumes, verifies Drive read-back, then deletes R2 only behind both controls',async()=>{
    database=createMigratedTestDatabase();
    const r2=new MockObjectStorage(); const drive=new MockDriveArchiveAdapter();
    const fixture=await seed(database,r2,'resume');
    await enable(database,true);
    drive.interruptNextUpload();
    const first=await runDriveArchiveBatch(database,r2,drive,{now:2_000,limit:1,copyEnabled:true,proxyReadEnabled:true,r2DeleteEnabled:true});
    expect(first).toMatchObject({processed:1,succeeded:0,failed:0});
    expect(await state(database,fixture.fileId)).toMatchObject({status:'DRIVE_COPYING',resumable_session_key:`mock-session:${fixture.fileId}`});
    expect(await r2.headObject(fixture.key)).not.toBeNull();
    const second=await runDriveArchiveBatch(database,r2,drive,{now:2_001,limit:1,copyEnabled:true,proxyReadEnabled:true,r2DeleteEnabled:true});
    expect(second).toMatchObject({processed:1,succeeded:1,failed:0});
    expect(await state(database,fixture.fileId)).toMatchObject({status:'DRIVE_ARCHIVED'});
    expect(await r2.headObject(fixture.key)).toBeNull();
    await expect(database.prepare('UPDATE file_drive_archive_manifests SET sha256=? WHERE file_object_id=?')
      .bind('0'.repeat(64),fixture.fileId).run()).rejects.toThrow('file_drive_archive_manifests_are_immutable');
  });

  it('retains R2 on mismatch and on delete failure, then safely retries deletion',async()=>{
    database=createMigratedTestDatabase();
    const r2=new MockObjectStorage(); const drive=new MockDriveArchiveAdapter();
    const mismatch=await seed(database,r2,'mismatch'); await enable(database,true);
    drive.failNext('read');
    const failed=await runDriveArchiveBatch(database,r2,drive,{now:3_000,limit:1,copyEnabled:true,proxyReadEnabled:true,r2DeleteEnabled:true});
    expect(failed.failed).toBe(1);
    expect(await r2.headObject(mismatch.key)).not.toBeNull();
    expect(await state(database,mismatch.fileId)).toMatchObject({status:'DRIVE_COPYING',last_failure_category:'read_back_failed'});
    expect(await database.prepare(`SELECT observation_state FROM scheduled_operational_signals WHERE signal_type='file_failure'
      AND job_name='drive_archive'`).first()).toMatchObject({observation_state:'BREACH'});

    database.close(); database=createMigratedTestDatabase();
    const r2Delete=new MockObjectStorage(); const driveDelete=new MockDriveArchiveAdapter();
    const deletion=await seed(database,r2Delete,'delete'); await enable(database,true);
    r2Delete.failNext('delete',deletion.key);
    const deleteFailed=await runDriveArchiveBatch(database,r2Delete,driveDelete,{now:4_000,limit:1,copyEnabled:true,proxyReadEnabled:true,r2DeleteEnabled:true});
    expect(deleteFailed.failed).toBe(1);
    expect(await state(database,deletion.fileId)).toMatchObject({status:'R2_DELETE_PENDING',last_failure_category:'r2_delete_failed'});
    expect(await r2Delete.headObject(deletion.key)).not.toBeNull();
    const retried=await runDriveArchiveBatch(database,r2Delete,driveDelete,{now:64_001,limit:1,copyEnabled:true,proxyReadEnabled:true,r2DeleteEnabled:true});
    expect(retried.succeeded).toBe(1);
    expect(await r2Delete.headObject(deletion.key)).toBeNull();
  });

  it('proxies archived bytes after authorization and never contacts Drive on denial',async()=>{
    database=createMigratedTestDatabase();
    const r2=new MockObjectStorage(); const drive=new MockDriveArchiveAdapter();
    const fixture=await seed(database,r2,'read'); await enable(database,true);
    const intent=await createFileReadIntent(database,allow,{fileObjectId:fixture.fileId,expectedFileVersion:3,ttlMs:60_000},
      {actor,idempotencyKey:'archive-read-intent-1',now:1_500});
    if(!intent.accessToken) throw new Error('missing_read_token');
    await runDriveArchiveBatch(database,r2,drive,{now:2_000,limit:1,copyEnabled:true,proxyReadEnabled:true,r2DeleteEnabled:true});
    const content=await consumeFileReadIntent(database,r2,allow,{readIntentId:intent.readIntentId,accessToken:intent.accessToken},
      {actor,now:2_100},{adapter:drive,proxyReadEnabled:true});
    expect(content.bytes).toEqual(png);
    expect(JSON.stringify(content)).not.toMatch(/drive_file_id|object_key|mock-drive/u);

    const second=await createFileReadIntent(database,allow,{fileObjectId:fixture.fileId,expectedFileVersion:3,ttlMs:60_000},
      {actor,idempotencyKey:'archive-read-intent-2',now:2_200});
    if(!second.accessToken) throw new Error('missing_read_token');
    const reads=drive.readCalls;
    const deny:FileAuthorizationService={...allow,assertCanRead:()=>{throw new Error('denied');}};
    await expect(consumeFileReadIntent(database,r2,deny,{readIntentId:second.readIntentId,accessToken:second.accessToken},
      {actor,now:2_300},{adapter:drive,proxyReadEnabled:true})).rejects.toBeTruthy();
    expect(drive.readCalls).toBe(reads);
  });

  it('rejects an unproven completed component and keeps non-whitelisted files out',async()=>{
    database=createMigratedTestDatabase();
    database.exec('PRAGMA foreign_keys=OFF;');
    expect(()=>database!.exec(`INSERT INTO order_archive_closures(formal_order_id,review_state,buyer_refund_state,
      seller_principal_state,seller_service_fee_state,status,business_closed_at,archive_due_at,reopened_at,reason,
      version,created_at,updated_at) VALUES('unproven','COMPLETED','NOT_APPLICABLE','NOT_APPLICABLE',
      'NOT_APPLICABLE','CLOSED',1,2,NULL,NULL,1,1,1)`)).toThrow('order_archive_closure_source_mismatch');
    expect(()=>database!.exec(`INSERT INTO file_drive_archives(file_object_id,purpose,status,archive_due_at,version,created_at,updated_at)
      VALUES('not-file','SUPPORT_ATTACHMENT','R2_HOT',1,1,1,1)`)).toThrow();
  });

  it('requires explicit not-applicable decisions and preserves R2 in shadow mode',async()=>{
    database=createMigratedTestDatabase();
    database.exec('PRAGMA foreign_keys=OFF;');
    await seedFormalOrder(database,'closure-order',1_000);
    await expect(recordOrderBusinessClosure(database,{formalOrderId:'closure-order',now:2_000}))
      .rejects.toThrow('not_explicitly_applicable');
    const closure=await recordOrderBusinessClosure(database,{formalOrderId:'closure-order',now:2_000,
      notApplicable:['review','buyer_refund','seller_principal','seller_service_fee']});
    expect(closure.businessClosedAt).toBe(2_000);
    await reopenOrderBusinessClosure(database,{formalOrderId:'closure-order',expectedVersion:1,
      reason:'业务更正后重新打开',now:2_100});
    expect(await database.prepare(`SELECT status,reopened_at FROM order_archive_closures
      WHERE formal_order_id='closure-order'`).first()).toEqual({status:'REOPENED',reopened_at:2_100});

    database.close(); database=createMigratedTestDatabase();
    const r2=new MockObjectStorage(); const drive=new MockDriveArchiveAdapter();
    const fixture=await seed(database,r2,'shadow'); await enable(database,false);
    const result=await runDriveArchiveBatch(database,r2,drive,{now:5_000,limit:1,copyEnabled:true,
      proxyReadEnabled:true,r2DeleteEnabled:false});
    expect(result.succeeded).toBe(1);
    expect(await state(database,fixture.fileId)).toMatchObject({status:'DRIVE_VERIFIED'});
    expect(await r2.headObject(fixture.key)).not.toBeNull();
  });

  it('rechecks Drive and the D1 kill switch immediately before deleting R2',async()=>{
    database=createMigratedTestDatabase();
    const r2=new MockObjectStorage();const drive=new MockDriveArchiveAdapter();
    const fixture=await seed(database,r2,'pre-delete');await enable(database,false);
    await runDriveArchiveBatch(database,r2,drive,{now:5_500,limit:1,copyEnabled:true,
      proxyReadEnabled:true,r2DeleteEnabled:true});
    expect(await state(database,fixture.fileId)).toMatchObject({status:'DRIVE_VERIFIED'});
    await enable(database,true);
    drive.failNext('read');
    const failed=await runDriveArchiveBatch(database,r2,drive,{now:5_501,limit:1,copyEnabled:true,
      proxyReadEnabled:true,r2DeleteEnabled:true});
    expect(failed.failed).toBe(1);
    expect(await state(database,fixture.fileId)).toMatchObject({status:'R2_DELETE_PENDING',last_failure_category:'read_back_failed'});
    expect(await r2.headObject(fixture.key)).not.toBeNull();
  });

  it('uses a file lease so concurrent runners upload only once',async()=>{
    database=createMigratedTestDatabase();
    const r2=new MockObjectStorage(); const drive=new MockDriveArchiveAdapter();
    await seed(database,r2,'concurrent'); await enable(database,false);
    const results=await Promise.all([
      runDriveArchiveBatch(database,r2,drive,{now:6_000,limit:1,copyEnabled:true,proxyReadEnabled:false,r2DeleteEnabled:false}),
      runDriveArchiveBatch(database,r2,drive,{now:6_000,limit:1,copyEnabled:true,proxyReadEnabled:false,r2DeleteEnabled:false}),
    ]);
    expect(results.reduce((sum,value)=>sum+value.succeeded,0)).toBe(1);
    expect(drive.uploadCalls).toBe(1);
  });

  it('dry-run reports backlog without Drive, R2 or D1 mutation',async()=>{
    database=createMigratedTestDatabase();
    const r2=new MockObjectStorage(); const drive=new MockDriveArchiveAdapter();
    const fixture=await seed(database,r2,'dryrun'); await enable(database,false);
    const result=await runDriveArchiveBatch(database,r2,drive,{now:6_500,limit:1,copyEnabled:true,
      proxyReadEnabled:false,r2DeleteEnabled:false,dryRun:true});
    expect(result).toEqual({processed:0,succeeded:0,failed:0,backlog:1});
    expect(await state(database,fixture.fileId)).toBeNull();
    expect(drive.uploadCalls).toBe(0);
    expect(await r2.headObject(fixture.key)).not.toBeNull();
  });

  it('rehydrates from the immutable manifest before an R2-only rollback',async()=>{
    database=createMigratedTestDatabase();
    const r2=new MockObjectStorage(); const drive=new MockDriveArchiveAdapter();
    const fixture=await seed(database,r2,'rehydrate'); await enable(database,true);
    await runDriveArchiveBatch(database,r2,drive,{now:7_000,limit:1,copyEnabled:true,proxyReadEnabled:true,r2DeleteEnabled:true});
    const archived=await database.prepare('SELECT version FROM file_drive_archives WHERE file_object_id=?')
      .bind(fixture.fileId).first<{version:number}>();
    if(!archived) throw new Error('missing_archive');
    const result=await rehydrateArchivedFile(database,r2,drive,{fileObjectId:fixture.fileId,expectedArchiveVersion:archived.version},
      {staffId:'phase3h-test-owner',roles:new Set(['owner']),permissions:new Set(['SCHEDULED_OPERATIONS_RUN']),
        idempotencyKey:'archive-rehydrate-1',now:8_000});
    expect(result).toMatchObject({rehydrated:true,replayed:false});
    expect((await r2.headObject(fixture.key))?.checksumSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(drive.files.size).toBe(1);
    expect(await rehydrateArchivedFile(database,r2,drive,{fileObjectId:fixture.fileId,expectedArchiveVersion:archived.version},
      {staffId:'phase3h-test-owner',roles:new Set(['owner']),permissions:new Set(['SCHEDULED_OPERATIONS_RUN']),
        idempotencyKey:'archive-rehydrate-1',now:8_001})).toMatchObject({rehydrated:true,replayed:true});
    await expect(rehydrateArchivedFile(database,r2,drive,{fileObjectId:'different-file',expectedArchiveVersion:archived.version},
      {staffId:'phase3h-test-owner',roles:new Set(['owner']),permissions:new Set(['SCHEDULED_OPERATIONS_RUN']),
        idempotencyKey:'archive-rehydrate-1',now:8_002})).rejects.toThrow('idempotency_conflict');
  });

  it('records healthy and failed permanent-archive reconciliation without deleting Drive',async()=>{
    database=createMigratedTestDatabase();
    const r2=new MockObjectStorage();const drive=new MockDriveArchiveAdapter();
    const fixture=await seed(database,r2,'reconcile');await enable(database,true);
    await runDriveArchiveBatch(database,r2,drive,{now:9_000,limit:1,copyEnabled:true,proxyReadEnabled:true,r2DeleteEnabled:true});
    expect(await reconcileDriveArchiveBatch(database,drive,{now:10_000,limit:1})).toEqual({processed:1,succeeded:1,failed:0});
    drive.tamper(`mock-drive:${fixture.fileId}`,{bytes:new Uint8Array([1,2,3]),byteSize:3});
    expect(await reconcileDriveArchiveBatch(database,drive,{now:11_000,limit:1})).toEqual({processed:1,succeeded:0,failed:1});
    const results=await database.prepare(`SELECT result FROM file_drive_archive_reconciliations
      WHERE file_object_id=? ORDER BY checked_at`).bind(fixture.fileId).all();
    expect(results.results).toEqual([{result:'HEALTHY'},{result:'FAILED'}]);
    expect(drive.files.size).toBe(1);
  });
});

async function seed(db:SqliteDatabase,r2:MockObjectStorage,suffix:string):Promise<{fileId:string;key:string}> {
  db.exec('PRAGMA foreign_keys=OFF; DROP TRIGGER IF EXISTS trg_order_archive_closure_insert_guard;');
  const fileId=`archive-file-${suffix}`; const orderId=`archive-order-${suffix}`;
  const key=`files/v1/2026/08/order-evidence/${suffix.padEnd(64,'a')}`;
  const stored=await r2.putObject({objectKey:key,bytes:png,contentType:'image/png',metadata:{}});
  await db.prepare(`INSERT INTO file_upload_intents(id,owner_actor_type,owner_actor_id,purpose,visibility,status,
    requested_file_count,manifest_hash,version,expires_at,failure_code,created_at,updated_at,completed_at)
    VALUES(?,'STAFF','archive-owner','ORDER_EVIDENCE','INTERNAL_ONLY','ISSUED',1,?,1,999999,NULL,1,1,NULL)`)
    .bind(`archive-intent-${suffix}`,'a'.repeat(64)).run();
  await db.prepare(`INSERT INTO file_objects(id,upload_intent_id,slot_no,purpose,visibility,object_key,client_file_name,
    extension,declared_mime,expected_byte_size,status,upload_token_hash,upload_expires_at,uploaded_byte_size,
    detected_mime,uploaded_sha256,failure_code,delete_attempt_count,next_delete_at,version,created_at,updated_at,
    uploaded_at,verified_at,deleted_at) VALUES(?, ?,1,'ORDER_EVIDENCE','INTERNAL_ONLY',?,'evidence.png',
    'png','image/png',?,'RESERVED',?,999999,NULL,NULL,NULL,NULL,0,NULL,1,1,1,NULL,NULL,NULL)`)
    .bind(fileId,`archive-intent-${suffix}`,key,png.byteLength,'b'.repeat(64)).run();
  await db.prepare(`UPDATE file_upload_intents SET status='VERIFIED',version=2,updated_at=3,completed_at=3 WHERE id=?`)
    .bind(`archive-intent-${suffix}`).run();
  await db.prepare(`UPDATE file_objects SET status='VERIFIED',uploaded_byte_size=?,detected_mime='image/png',
    uploaded_sha256=?,version=3,updated_at=3,uploaded_at=2,verified_at=3 WHERE id=?`)
    .bind(png.byteLength,stored.checksumSha256,fileId).run();
  await db.prepare(`INSERT INTO file_entity_links(id,file_object_id,entity_type,entity_id,purpose,visibility,
    linked_by_actor_type,linked_by_actor_id,created_at,authorization_mode,expires_at,revoked_at)
    VALUES(?,?,'ORDER',?,'ORDER_EVIDENCE','INTERNAL_ONLY','STAFF','archive-owner',4,'LEGACY_VISIBILITY',NULL,NULL)`)
    .bind(`archive-link-${suffix}`,fileId,orderId).run();
  await db.prepare(`INSERT INTO order_archive_closures(formal_order_id,review_state,buyer_refund_state,
    seller_principal_state,seller_service_fee_state,status,business_closed_at,archive_due_at,reopened_at,reason,
    version,created_at,updated_at) VALUES(?,'NOT_APPLICABLE','NOT_APPLICABLE','NOT_APPLICABLE','NOT_APPLICABLE',
    'CLOSED',10,100,NULL,NULL,1,10,10)`).bind(orderId).run();
  return {fileId,key};
}
async function seedFormalOrder(db:SqliteDatabase,id:string,confirmedAt:number):Promise<void>{
  db.exec(`DROP TRIGGER IF EXISTS trg_formal_order_source_guard;
    DROP TRIGGER IF EXISTS trg_formal_order_instruction_guard;
    DROP TRIGGER IF EXISTS trg_formal_order_financial_self_pay_guard;`);
  await db.prepare(`INSERT INTO formal_orders(
    id,order_evidence_submission_id,order_evidence_version_id,reservation_id,demand_batch_id,
    buyer_customer_id,buyer_customer_no,seller_organization_id,store_id,marketplace_code,
    product_id,product_version_id,product_version_no,asin_display,asin_normalized,product_name_snapshot,
    review_type,amazon_order_number_raw,amazon_order_number_normalized,final_paid_jpy,status,version,
    confirmed_by_staff_id,confirmed_at,confirmed_business_date,created_at
  ) VALUES(?,?,?,?,?,?,?,?,?,'JP',?,?,?,?,?,?,'TEXT',?, ?,100,'CONFIRMED',1,?,?, '2026-01-01',?)`)
    .bind(id,`${id}-submission`,`${id}-evidence`,`${id}-reservation`,`${id}-demand`,`${id}-buyer`,'BUYER-1',
      `${id}-seller`,`${id}-store`,`${id}-product`,`${id}-version`,1,'B012345678','B012345678','测试产品',
      '123-1234567-1234567','123-1234567-1234567','phase3h-test-owner',confirmedAt,confirmedAt).run();
}
async function enable(db:SqliteDatabase,deleteEnabled:boolean):Promise<void> { await db.prepare(`UPDATE drive_archive_controls SET copy_enabled=1,
  proxy_read_enabled=1,r2_delete_enabled=?,version=version+1,updated_at=updated_at+1`).bind(deleteEnabled?1:0).run(); }
async function state(db:SqliteDatabase,fileId:string):Promise<Record<string,unknown>|null>{return db.prepare(`SELECT status,
  resumable_session_key,last_failure_category,drive_file_id,verified_at,r2_deleted_at FROM file_drive_archives WHERE file_object_id=?`)
  .bind(fileId).first<Record<string,unknown>>();}
