import { afterEach, describe, expect, it } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import { reconcileInstructionAssetOrphans } from './asset-reconciliation';

let db: SqliteDatabase | null = null;
afterEach(() => { db?.close(); db=null; });
const actor = { staffId:'system-scheduler',displayName:'System Scheduler',staffStatus:'ACTIVE' as const,authorizationVersion:1,roles:new Set(['owner'] as const),permissions:new Set(['ORDER_INSTRUCTION_MANAGE'] as const),memberTeamIds:[],leaderTeamIds:[] };
function seed(id:string, active=false): void {
  const key=`files/v1/${'a'.repeat(40-id.length)}${id}`;
  db!.exec('PRAGMA foreign_keys=OFF; DROP TRIGGER IF EXISTS trg_file_objects_intent_guard; DROP TRIGGER IF EXISTS trg_file_entity_links_verified_guard');
  db!.exec(`INSERT INTO file_objects(id,upload_intent_id,slot_no,purpose,visibility,object_key,client_file_name,extension,declared_mime,expected_byte_size,status,upload_token_hash,upload_expires_at,uploaded_byte_size,detected_mime,uploaded_sha256,failure_code,delete_attempt_count,next_delete_at,version,created_at,updated_at,uploaded_at,verified_at,deleted_at) VALUES('${id}','intent-${id}',1,'ORDER_EVIDENCE','INTERNAL_ONLY','${key}','abc.png','png','image/png',1,'DELETION_PENDING','${'b'.repeat(64)}',1,1,'image/png','${'c'.repeat(64)}','ORPHAN',0,1,1,1,1,1,NULL,NULL); INSERT INTO order_instruction_asset_batches(id,instruction_id,reservation_id,product_version_id,status,idempotency_digest,render_profile,item_count,ready_count,failed_count,generator_version,failure_code,version,created_by_staff_id,created_at,updated_at,ready_at,consumed_at,cancelled_at) VALUES('batch-${id}','i-${id}','r-${id}','p-${id}','FAILED','${'d'.repeat(64)}','x',1,0,1,NULL,'FAILED',1,'staff-x',1,1,NULL,NULL,NULL); INSERT INTO order_instruction_asset_items(id,asset_batch_id,keyword_position,keyword_hmac_digest,file_object_id,image_mime,width,height,sha256,generator_version,status,error_code,created_at,updated_at) VALUES('item-${id}','batch-${id}',1,'${'e'.repeat(64)}','${id}','image/png',1,1,'${'f'.repeat(64)}','x','ORPHANED','ORPHAN',1,1);`);
  if(active) db!.exec(`INSERT INTO file_entity_links(id,file_object_id,entity_type,entity_id,purpose,authorization_mode,visibility,linked_by_actor_type,linked_by_actor_id,created_at,revoked_at) VALUES('link-${id}','${id}','ORDER','e','ORDER_EVIDENCE','EXPLICIT_AUDIENCES','INTERNAL_ONLY','SYSTEM','test',1,NULL)`);
  db!.exec('PRAGMA foreign_keys=ON');
}
describe('asset orphan reconciliation',()=>{
  it('dry-run previews eligible candidates without storage or database effects',async()=>{ db=createMigratedTestDatabase(); seed('obj-a'); let deletes=0; const storage={deleteObject:async()=>{deletes++}} as any; const r=await reconcileInstructionAssetOrphans(db,storage,{limit:1,dryRun:true},{actor,idempotencyKey:'dry-run-key',now:2}); expect(r).toMatchObject({scanned:1,deleted:0,dry_run:true,backlog_count:1}); expect(deletes).toBe(0); expect((await db.prepare("SELECT status FROM file_objects WHERE id='obj-a'").first())?.['status']).toBe('DELETION_PENDING'); });
  it('excludes active links',async()=>{ db=createMigratedTestDatabase(); seed('obj-b',true); const r=await reconcileInstructionAssetOrphans(db,{deleteObject:async()=>undefined} as any,{dryRun:true},{actor,idempotencyKey:'active-link-key',now:2}); expect(r.backlog_count).toBe(0); });
  it('defers on storage delete failure without deleting the object',async()=>{ db=createMigratedTestDatabase(); seed('obj-c'); const r=await reconcileInstructionAssetOrphans(db,{deleteObject:async()=>{throw new Error('fail')}} as any,{limit:1},{actor,idempotencyKey:'failure-key',now:2}); expect(r.deferred).toBe(1); expect((await db.prepare("SELECT status FROM file_objects WHERE id='obj-c'").first())?.['status']).toBe('DELETION_PENDING'); });
  it('resumes equal-time candidates by item id, then resets the round for earlier work',async()=>{
    db=createMigratedTestDatabase(); seed('obj-d'); seed('obj-e');
    const calls:string[]=[]; const storage={deleteObject:async(key:string)=>{calls.push(key)}} as any;
    const first=await reconcileInstructionAssetOrphans(db,storage,{limit:1},{actor,idempotencyKey:'cursor-one',now:2});
    expect(first.deleted).toBe(1); expect(first.next_cursor?.item_id).toBe('item-obj-d');
    const second=await reconcileInstructionAssetOrphans(db,storage,{limit:1,cursor:first.next_cursor},{actor,idempotencyKey:'cursor-two',now:2});
    expect(second.deleted).toBe(1); expect(second.next_cursor).toBeNull();
    expect(calls).toHaveLength(2); expect(new Set(calls).size).toBe(2);
    expect((await db.prepare("SELECT COUNT(*) AS count FROM file_objects WHERE id IN ('obj-d','obj-e') AND status='DELETED'").first())?.['count']).toBe(2);
    seed('obj-0');
    const reset=await reconcileInstructionAssetOrphans(db,storage,{limit:1},{actor,idempotencyKey:'cursor-reset',now:2});
    expect(reset.deleted).toBe(1); expect(calls).toHaveLength(3);
  });
  it('does not delete an already-cleaned object again on duplicate reconciliation',async()=>{ db=createMigratedTestDatabase(); seed('obj-once'); let deletes=0; const storage={deleteObject:async()=>{deletes++}} as any; await reconcileInstructionAssetOrphans(db,storage,{limit:1},{actor,idempotencyKey:'once-first',now:2}); await reconcileInstructionAssetOrphans(db,storage,{limit:1},{actor,idempotencyKey:'once-second',now:2}); expect(deletes).toBe(1); });
});
