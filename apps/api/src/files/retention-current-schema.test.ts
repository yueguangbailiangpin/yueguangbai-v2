import { afterEach,describe,expect,it } from 'vitest';
import type { ObjectStorageAdapter,ObjectStorageHead,ObjectStoragePutInput,ObjectStoragePutResult } from '@ygb/contracts';
import { createMigratedTestDatabase,type SqliteDatabase } from '@ygb/testkit';
import { reconcileUnlinkedFileRetention } from './retention';

let database:SqliteDatabase|null=null;
afterEach(()=>{database?.close();database=null;});

describe('file retention on current migrated schema',()=>{
  it('moves a durable old unlinked VERIFIED object through DELETION_PENDING to DELETED without violating schema invariants',async()=>{
    database=createMigratedTestDatabase();
    const createdAt=1_000,verifiedAt=2_000,expiresAt=10_000_000_000_000;
    await database.prepare(`INSERT INTO file_upload_intents(
      id,owner_actor_type,owner_actor_id,purpose,visibility,status,
      requested_file_count,manifest_hash,version,expires_at,failure_code,
      created_at,updated_at,completed_at
    ) VALUES('retention-intent-current','STAFF','retention-staff','BUYER_REFUND_PROOF',
      'INTERNAL_ONLY','ISSUED',1,?,1,?,NULL,?,?,NULL)`).bind(
      'a'.repeat(64),expiresAt,createdAt,createdAt,
    ).run();
    await database.prepare(`INSERT INTO file_objects(
      id,upload_intent_id,slot_no,purpose,visibility,object_key,client_file_name,
      extension,declared_mime,expected_byte_size,status,upload_token_hash,
      upload_expires_at,uploaded_byte_size,detected_mime,uploaded_sha256,
      failure_code,delete_attempt_count,next_delete_at,version,created_at,updated_at,
      uploaded_at,verified_at,deleted_at
    ) VALUES('retention-file-current','retention-intent-current',1,'BUYER_REFUND_PROOF',
      'INTERNAL_ONLY',?,'proof.png','png','image/png',8,'RESERVED',?,?,
      NULL,NULL,NULL,NULL,0,NULL,1,?,?,NULL,NULL,NULL)`).bind(
      'files/v1/2026/08/retention-unlinked-aaaaaaaaaaaaaaaaaaaa',
      'b'.repeat(64),expiresAt,createdAt,createdAt,
    ).run();
    await database.prepare(`UPDATE file_upload_intents
      SET status='VERIFIED',version=2,updated_at=?,completed_at=?
      WHERE id='retention-intent-current'`).bind(verifiedAt,verifiedAt).run();
    await database.prepare(`UPDATE file_objects
      SET status='VERIFIED',version=2,uploaded_byte_size=8,detected_mime='image/png',
        uploaded_sha256=?,uploaded_at=?,verified_at=?,updated_at=?
      WHERE id='retention-file-current'`).bind(
      'c'.repeat(64),verifiedAt-1,verifiedAt,verifiedAt,
    ).run();

    const storage=new CurrentSchemaStorage();
    const now=verifiedAt+31*86_400_000;
    const result=await reconcileUnlinkedFileRetention(database,storage,{now,limit:10});
    expect(result.planned).toBe(1);
    expect(result.deleted).toBe(1);
    expect(storage.deleted).toEqual([
      'files/v1/2026/08/retention-unlinked-aaaaaaaaaaaaaaaaaaaa',
    ]);
    const row=await database.prepare(`SELECT status,verified_at,next_delete_at,
      delete_attempt_count,failure_code,deleted_at FROM file_objects
      WHERE id='retention-file-current'`).first<any>();
    expect(row.status).toBe('DELETED');
    expect(row.verified_at).toBeNull();
    expect(row.next_delete_at).toBeNull();
    expect(Number(row.delete_attempt_count)).toBe(1);
    expect(row.failure_code).toBe('RETENTION_DELETED');
    expect(Number(row.deleted_at)).toBe(now);
    expect(await database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});

class CurrentSchemaStorage implements ObjectStorageAdapter{
  readonly deleted:string[]=[];
  async putObject(_input:ObjectStoragePutInput):Promise<ObjectStoragePutResult>{throw new Error('not_used');}
  async headObject(_objectKey:string):Promise<ObjectStorageHead|null>{return null;}
  async readPrefix(_objectKey:string,_maximumBytes:number):Promise<Uint8Array<ArrayBuffer>>{return new Uint8Array();}
  async readObject(_objectKey:string):Promise<Uint8Array<ArrayBuffer>>{return new Uint8Array();}
  async deleteObject(objectKey:string):Promise<void>{this.deleted.push(objectKey);}
}
