import { afterEach,describe,expect,it } from 'vitest';
import { Hono } from 'hono';
import { createMigratedTestDatabase,type SqliteDatabase } from '@ygb/testkit';
import type { AppEnv } from '../app';
import { MockObjectStorage } from '../files/mock-object-storage';
import { runDriveArchiveBatch } from './job';
import { MockDriveArchiveAdapter } from './mock-drive-adapter';
import { registerColdImageArchiveRoutes } from './routes';
import { recordOrderBusinessClosure } from './business-closure';
import { COLD_ARCHIVE_CONFIRMED_AT,coldArchiveOwner,seedConfirmedColdArchiveOrder,settleColdArchivePrincipal }
  from '../../test-support/cold-archive-fixture';

const png=new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
let database:SqliteDatabase|null=null;
afterEach(()=>{database?.close();database=null;});

describe('Staff cold archive command routes',()=>{
  it('enforces ACTIVE owner plus effective permission and records a versioned audited closure',async()=>{
    database=createMigratedTestDatabase();const order=await seedConfirmedColdArchiveOrder(database,'route-close');
    await settleColdArchivePrincipal(database,{suffix:'route-close',...order,proofBytes:png});
    const denied=app({...coldArchiveOwner,permissions:new Set(['ORDER_CONFIRM'])});
    const forbidden=await denied.request(`https://local/api/staff/operations/archive/orders/${order.formalOrderId}/close`,{
      method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'route-close-denied'},
      body:JSON.stringify({expected_version:0,not_applicable:['review','buyer_refund','seller_service_fee'],reason:'明确不适用'})},
      {DB:database});
    expect(forbidden.status).toBe(403);
    expect(await database.prepare(`SELECT COUNT(*) AS count FROM order_archive_closures`).first()).toEqual({count:0});
    const response=await app(coldArchiveOwner).request(`https://local/api/staff/operations/archive/orders/${order.formalOrderId}/close`,{
      method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'route-close-owner'},
      body:JSON.stringify({expected_version:0,not_applicable:['review','buyer_refund','seller_service_fee'],reason:'明确不适用'})},
      {DB:database});
    expect(response.status).toBe(200);expect(await response.json()).toMatchObject({data:{closure:{status:'CLOSED',version:1}}});
    expect(await database.prepare(`SELECT COUNT(*) AS count FROM audit_events WHERE event_type='ORDER_ARCHIVE_CLOSED'`).first())
      .toEqual({count:1});
  });

  it('wires owner-only rehydration through the runtime adapter and returns no provider identifier',async()=>{
    database=createMigratedTestDatabase();const storage=new MockObjectStorage();const drive=new MockDriveArchiveAdapter();
    const order=await seedConfirmedColdArchiveOrder(database,'route-rehydrate');
    const settled=await settleColdArchivePrincipal(database,{suffix:'route-rehydrate',...order,proofBytes:png});
    const closure=await recordOrderBusinessClosure(database,{formalOrderId:order.formalOrderId,expectedVersion:0,
      notApplicable:['review','buyer_refund','seller_service_fee'],reason:'明确不适用'},
      {actor:coldArchiveOwner,idempotencyKey:'route-close-rehydrate',now:settled.completedAt+1});
    await storage.putObject({objectKey:settled.objectKey,bytes:png,contentType:'image/png',metadata:{}});
    await database.prepare(`UPDATE drive_archive_controls SET copy_enabled=1,proxy_read_enabled=1,r2_delete_enabled=1,
      version=version+1,updated_at=updated_at+1`).run();
    await runDriveArchiveBatch(database,storage,drive,{now:closure.archive_due_at,limit:1,copyEnabled:true,
      proxyReadEnabled:true,r2DeleteEnabled:true});
    const archived=await database.prepare(`SELECT version FROM file_drive_archives WHERE file_object_id=?`)
      .bind(settled.fileId).first<{version:number}>();if(!archived)throw new Error('missing_archive');
    const response=await app(coldArchiveOwner).request(`https://local/api/staff/operations/archive/files/${settled.fileId}/rehydrate`,{
      method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'route-rehydrate-owner'},
      body:JSON.stringify({expected_archive_version:archived.version})},{DB:database,FILE_OBJECT_STORAGE:storage,
        DRIVE_ARCHIVE_ADAPTER:drive,DRIVE_ARCHIVE_ENABLED:'true'});
    expect(response.status).toBe(200);const body=await response.json();
    expect(body).toMatchObject({data:{rehydration:{status:'COMPLETED',file_object_id:settled.fileId}}});
    expect(JSON.stringify(body)).not.toMatch(/drive_file_id|object_key|mock-drive/u);
  });

  it('rejects missing, extra, and mistyped fields on every privileged write route',async()=>{
    database=createMigratedTestDatabase();const value=app(coldArchiveOwner);
    const cases=[
      ['/api/staff/operations/archive/orders/order-contract/close',
        [{expected_version:0,not_applicable:[]},{expected_version:0,not_applicable:[],reason:'测试',extra:true},
          {expected_version:'0',not_applicable:[],reason:'测试'}]],
      ['/api/staff/operations/archive/orders/order-contract/reopen',
        [{expected_version:1},{expected_version:1,reason:'测试',extra:true},{expected_version:'1',reason:'测试'}]],
      ['/api/staff/operations/archive/files/file-contract/rehydrate',
        [{},{expected_archive_version:1,extra:true},{expected_archive_version:'1'}]],
    ] as const;
    let index=0;
    for(const [path,bodies] of cases){for(const body of bodies){index+=1;
      const response=await value.request(`https://local${path}`,{method:'POST',headers:{'Content-Type':'application/json',
        'Idempotency-Key':`route-contract-${index}`},body:JSON.stringify(body)},{DB:database});
      expect(response.status,`${path}: ${JSON.stringify(body)}`).toBe(400);
      expect(await response.json()).toMatchObject({error:{code:'VALIDATION_ERROR'}});
    }}
  });
});

function app(actor:typeof coldArchiveOwner){const value=new Hono<AppEnv>();value.use('*',async(context,next)=>{
  context.set('requestId','cold-route-request');context.set('errorLogged',false);context.set('staffAuthorization',actor);await next();});
  registerColdImageArchiveRoutes(value);return value;}
