import { afterEach,describe,expect,it } from 'vitest';
import type { ObjectStorageAdapter,ObjectStorageHead,ObjectStoragePutInput,ObjectStoragePutResult } from '@ygb/contracts';
import { SqliteDatabase } from '@ygb/testkit';
import {
  readFormalOrderBusinessCapabilities,
  requireFormalOrderAction,
} from './formal-order-policy';
import { prepareAdvancePrincipalSettlementStatements } from './buyer-refunds/advance-principal-settlement';
import { reconcileUnlinkedFileRetention } from './files/retention';
import { readFinancialReportingProjection } from './admin-business-dashboard/financial-projection';

let database:SqliteDatabase|null=null;
afterEach(()=>{database?.close();database=null;});

describe('Wave 15 architecture finalization — real behavior',()=>{
  it('central order policy blocks every gated action while abnormal and restores them after RESOLVED',async()=>{
    database=new SqliteDatabase(':memory:');
    database.exec(`
      CREATE TABLE formal_orders(id TEXT PRIMARY KEY);
      CREATE TABLE formal_order_operational_events(
        id TEXT PRIMARY KEY,formal_order_id TEXT NOT NULL,event_type TEXT NOT NULL,
        reason TEXT NOT NULL,actor_staff_id TEXT NOT NULL,created_at INTEGER NOT NULL
      );
      CREATE VIEW formal_order_effective_operational_state AS
      SELECT formal_order.id AS formal_order_id,
        COALESCE((SELECT CASE event.event_type WHEN 'RESOLVED' THEN 'NORMAL' ELSE event.event_type END
          FROM formal_order_operational_events event WHERE event.formal_order_id=formal_order.id
          ORDER BY event.created_at DESC,event.id DESC LIMIT 1),'NORMAL') AS operational_state
      FROM formal_orders formal_order;
      INSERT INTO formal_orders(id) VALUES('order-policy-1');
    `);
    const normal=await readFormalOrderBusinessCapabilities(database,'order-policy-1');
    expect(normal.operational_state).toBe('NORMAL');
    expect(Object.values(normal.actions).every((action)=>action.allowed)).toBe(true);

    database.exec(`INSERT INTO formal_order_operational_events VALUES(
      'event-cancel','order-policy-1','PLATFORM_CANCELLED','平台取消','staff-1',100
    );`);
    const cancelled=await readFormalOrderBusinessCapabilities(database,'order-policy-1');
    expect(cancelled.operational_state).toBe('PLATFORM_CANCELLED');
    expect(Object.values(cancelled.actions).every((action)=>!action.allowed)).toBe(true);
    await expect(requireFormalOrderAction(database,'order-policy-1','APPROVE_REVIEW'))
      .rejects.toMatchObject({
        code:'FORMAL_ORDER_ACTION_BLOCKED',state:'PLATFORM_CANCELLED',action:'APPROVE_REVIEW',
      });

    database.exec(`INSERT INTO formal_order_operational_events VALUES(
      'event-resolved','order-policy-1','RESOLVED','问题处理完成','staff-1',200
    );`);
    const resolved=await readFormalOrderBusinessCapabilities(database,'order-policy-1');
    expect(resolved.operational_state).toBe('NORMAL');
    expect(resolved.actions.CREATE_BUYER_REFUND.allowed).toBe(true);
    expect(resolved.actions.RECORD_ADVANCE_PRINCIPAL.allowed).toBe(true);
  });

  it('settles advance 600 against formal refund 500 and records only the excess 100 as overpayment',async()=>{
    database=new SqliteDatabase(':memory:');
    database.exec(`
      CREATE TABLE buyer_advance_principal_entries(
        id TEXT PRIMARY KEY,formal_order_id TEXT NOT NULL,entry_type TEXT NOT NULL,
        original_payment_entry_id TEXT,amount_cny_fen INTEGER NOT NULL,paid_at INTEGER,
        china_business_date TEXT NOT NULL,payment_channel TEXT NOT NULL,note TEXT,
        actor_staff_id TEXT NOT NULL,created_at INTEGER NOT NULL
      );
      CREATE TABLE buyer_advance_principal_settlements(
        id TEXT PRIMARY KEY,advance_payment_entry_id TEXT UNIQUE,buyer_refund_obligation_id TEXT,
        buyer_refund_payment_entry_id TEXT UNIQUE,settled_amount_cny_fen INTEGER,settled_at INTEGER
      );
      CREATE TABLE buyer_advance_principal_overpayments(
        id TEXT PRIMARY KEY,advance_payment_entry_id TEXT UNIQUE,buyer_refund_obligation_id TEXT,
        formal_order_id TEXT,excess_amount_cny_fen INTEGER,recognized_at INTEGER
      );
      CREATE TABLE buyer_refund_payment_entries(
        id TEXT PRIMARY KEY,obligation_id TEXT,entry_type TEXT,original_payment_entry_id TEXT,
        amount_cny_fen INTEGER,paid_at INTEGER,reversed_at INTEGER,china_business_date TEXT,
        payment_channel TEXT,recorded_by_staff_id TEXT,public_note TEXT,internal_note TEXT,
        idempotency_key TEXT,request_hash TEXT,created_at INTEGER
      );
      CREATE TABLE buyer_refund_events(
        id TEXT PRIMARY KEY,obligation_id TEXT,payment_entry_id TEXT,event_type TEXT,
        actor_type TEXT,actor_id TEXT,obligation_version INTEGER,amount_cny_fen INTEGER,
        net_paid_after_cny_fen INTEGER,metadata_json TEXT,idempotency_key TEXT,created_at INTEGER
      );
      INSERT INTO buyer_advance_principal_entries VALUES(
        'advance-payment-1','formal-order-1','PAYMENT',NULL,60000,1000,
        '2026-08-01','WECHAT','提前支付','staff-refund',1000
      );
    `);
    const prepared=await prepareAdvancePrincipalSettlementStatements(database,{
      obligationId:'refund-obligation-1',formalOrderId:'formal-order-1',dueAmountCnyFen:50000,now:2000,
    });
    expect(prepared.netPaidCnyFen).toBe(50000);
    expect(prepared.overpaymentCnyFen).toBe(10000);
    expect(prepared.settlementCount).toBe(1);
    expect(prepared.overpaymentCount).toBe(1);
    await database.batch(prepared.statements);
    const payment=await database.prepare(`SELECT amount_cny_fen FROM buyer_refund_payment_entries`).first<{amount_cny_fen:number}>();
    const excess=await database.prepare(`SELECT excess_amount_cny_fen FROM buyer_advance_principal_overpayments`).first<{excess_amount_cny_fen:number}>();
    expect(payment?.amount_cny_fen).toBe(50000);
    expect(excess?.excess_amount_cny_fen).toBe(10000);
  });

  it('retention deletes only old unlinked files and never touches an actively linked business file',async()=>{
    database=new SqliteDatabase(':memory:');
    seedRetentionSchema(database);
    seedVerifiedRetentionFile(database,'file-linked','intent-linked','objects/linked',1000);
    seedVerifiedRetentionFile(database,'file-orphan','intent-orphan','objects/orphan',1000);
    database.exec(`INSERT INTO file_entity_links VALUES('link-1','file-linked',NULL);`);
    const storage=new RecordingStorage();
    const now=40*86_400_000;
    const result=await reconcileUnlinkedFileRetention(database,storage,{now,limit:10});
    expect(result.planned).toBe(1);
    expect(result.deleted).toBe(1);
    expect(storage.deleted).toEqual(['objects/orphan']);
    const linked=await database.prepare(`SELECT status,verified_at FROM file_objects WHERE id='file-linked'`).first<{status:string;verified_at:number|null}>();
    const orphan=await database.prepare(`SELECT status,failure_code,verified_at FROM file_objects WHERE id='file-orphan'`).first<{status:string;failure_code:string;verified_at:number|null}>();
    expect(linked).toEqual({status:'VERIFIED',verified_at:1000});
    expect(orphan).toEqual({status:'DELETED',failure_code:'RETENTION_DELETED',verified_at:null});
  });

  it('retention keeps failed R2 deletes pending and schedules a bounded retry instead of lying that the file is gone',async()=>{
    database=new SqliteDatabase(':memory:');
    seedRetentionSchema(database);
    seedVerifiedRetentionFile(database,'file-retry','intent-retry','objects/retry',1000);
    const now=40*86_400_000;
    const result=await reconcileUnlinkedFileRetention(database,new FailingDeleteStorage(),{now,limit:10});
    expect(result.planned).toBe(1);
    expect(result.deleted).toBe(0);
    expect(result.deferred).toBe(1);
    const row=await database.prepare(`SELECT status,failure_code,delete_attempt_count,next_delete_at,verified_at FROM file_objects WHERE id='file-retry'`).first<any>();
    expect(row.status).toBe('DELETION_PENDING');
    expect(row.failure_code).toBe('RETENTION_DELETE_RETRY');
    expect(Number(row.delete_attempt_count)).toBe(1);
    expect(Number(row.next_delete_at)).toBeGreaterThan(now);
    expect(row.verified_at).toBeNull();
  });

  it('an active read intent postpones retention even when the file is old and unlinked',async()=>{
    database=new SqliteDatabase(':memory:');
    seedRetentionSchema(database);
    seedVerifiedRetentionFile(database,'file-reading','intent-reading','objects/reading',1000);
    const now=40*86_400_000;
    database.prepare(`INSERT INTO file_read_intents VALUES('file-reading','ISSUED',?)`).bind(now+60_000).run();
    const storage=new RecordingStorage();
    const result=await reconcileUnlinkedFileRetention(database,storage,{now,limit:10});
    expect(result.planned).toBe(0);
    expect(result.deleted).toBe(0);
    expect(storage.deleted).toEqual([]);
  });

  it('financial projection counts real buyer cash once when advance principal later becomes a refund ledger payment',async()=>{
    database=new SqliteDatabase(':memory:');
    seedFinancialProjectionSchema(database);
    const at=Date.UTC(2026,7,1,4,0,0);
    database.exec(`
      INSERT INTO seller_payments VALUES('seller-payment-1',100000,${at});
      INSERT INTO buyer_refund_payment_entries VALUES
        ('refund-normal','PAYMENT',50000,${at},NULL),
        ('refund-from-advance','PAYMENT',50000,${at},NULL);
      INSERT INTO buyer_advance_principal_entries VALUES('advance-1','PAYMENT',60000,${at},NULL);
      INSERT INTO buyer_advance_principal_settlements VALUES('advance-1','refund-from-advance');
      INSERT INTO seller_payable_balances VALUES(200000,100000,100000,${at});
      INSERT INTO buyer_refund_ledger_balances VALUES(50000,50000,${at});
      INSERT INTO internal_order_finance_positions VALUES('COMPLETED','2026-08-01','2026-08-01',30000,20000,${at});
      INSERT INTO formal_order_financial_adjustments VALUES('PROJECTED_GROSS_PROFIT',-5000,${at});
      INSERT INTO formal_order_financial_adjustments VALUES('COMPLETED_GROSS_PROFIT',2000,${at});
    `);
    const projection=await readFinancialReportingProjection(database,{fromDate:'2026-08-01',toDate:'2026-08-01'},at+1000);
    expect(projection.seller_cash_in_cny_fen).toBe('100000');
    expect(projection.buyer_cash_out_cny_fen).toBe('110000');
    expect(projection.net_cash_flow_cny_fen).toBe('-10000');
    expect(projection.projected_profit_cny_fen).toBe('25000');
    expect(projection.completed_profit_cny_fen).toBe('22000');
    expect(projection.seller_payable_outstanding_cny_fen).toBe('100000');
    expect(projection.buyer_refund_outstanding_cny_fen).toBe('0');
  });

  it('seller cash flow records payment on payment day and reversal on reversal day instead of rewriting history',async()=>{
    database=new SqliteDatabase(':memory:');
    seedFinancialProjectionSchema(database);
    const paidAt=Date.UTC(2026,7,1,4,0,0),reversedAt=Date.UTC(2026,7,2,4,0,0);
    database.exec(`
      INSERT INTO seller_payments VALUES('seller-payment-reversed',100000,${paidAt});
      INSERT INTO seller_payment_reversals VALUES('seller-payment-reversed',100000,${reversedAt});
    `);
    const paymentDay=await readFinancialReportingProjection(database,{fromDate:'2026-08-01',toDate:'2026-08-01'},reversedAt+1000);
    const reversalDay=await readFinancialReportingProjection(database,{fromDate:'2026-08-02',toDate:'2026-08-02'},reversedAt+1000);
    expect(paymentDay.seller_cash_in_cny_fen).toBe('100000');
    expect(reversalDay.seller_cash_in_cny_fen).toBe('-100000');
  });
});

function seedRetentionSchema(db:SqliteDatabase):void{
  db.exec(`
    CREATE TABLE file_upload_intents(id TEXT PRIMARY KEY,status TEXT NOT NULL);
    CREATE TABLE file_objects(
      id TEXT PRIMARY KEY,upload_intent_id TEXT NOT NULL,object_key TEXT NOT NULL,status TEXT NOT NULL,
      delete_attempt_count INTEGER NOT NULL DEFAULT 0,next_delete_at INTEGER,version INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,verified_at INTEGER,uploaded_byte_size INTEGER,detected_mime TEXT,
      uploaded_sha256 TEXT,uploaded_at INTEGER,upload_expires_at INTEGER NOT NULL,
      failure_code TEXT,deleted_at INTEGER
    );
    CREATE TABLE file_entity_links(id TEXT PRIMARY KEY,file_object_id TEXT NOT NULL,revoked_at INTEGER);
    CREATE TABLE file_read_intents(file_object_id TEXT NOT NULL,status TEXT NOT NULL,expires_at INTEGER NOT NULL);
    CREATE TABLE order_instruction_asset_items(id TEXT PRIMARY KEY,file_object_id TEXT,status TEXT);
  `);
}
function seedVerifiedRetentionFile(db:SqliteDatabase,id:string,intentId:string,key:string,at:number):void{
  db.prepare(`INSERT INTO file_upload_intents VALUES(?,'VERIFIED')`).bind(intentId).run();
  db.prepare(`INSERT INTO file_objects(
    id,upload_intent_id,object_key,status,delete_attempt_count,next_delete_at,version,
    updated_at,verified_at,uploaded_byte_size,detected_mime,uploaded_sha256,uploaded_at,
    upload_expires_at,failure_code,deleted_at
  ) VALUES(?,?,?,'VERIFIED',0,NULL,1,?,?,8,'image/png',?, ?, ?,NULL,NULL)`).bind(
    id,intentId,key,at,at,'a'.repeat(64),at,at+100_000,
  ).run();
}

function seedFinancialProjectionSchema(db:SqliteDatabase):void{
  db.exec(`
    CREATE TABLE seller_payments(id TEXT PRIMARY KEY,amount_cny_fen INTEGER,paid_at INTEGER);
    CREATE TABLE seller_payment_reversals(payment_id TEXT PRIMARY KEY,amount_cny_fen INTEGER,reversed_at INTEGER);
    CREATE TABLE buyer_refund_payment_entries(id TEXT PRIMARY KEY,entry_type TEXT,amount_cny_fen INTEGER,paid_at INTEGER,reversed_at INTEGER);
    CREATE TABLE buyer_advance_principal_settlements(advance_payment_entry_id TEXT,buyer_refund_payment_entry_id TEXT);
    CREATE TABLE buyer_advance_principal_entries(id TEXT PRIMARY KEY,entry_type TEXT,amount_cny_fen INTEGER,paid_at INTEGER,reversed_at INTEGER);
    CREATE TABLE seller_payable_balances(amount_cny_fen INTEGER,paid_amount_cny_fen INTEGER,outstanding_amount_cny_fen INTEGER,due_at INTEGER);
    CREATE TABLE buyer_refund_ledger_balances(due_amount_cny_fen INTEGER,net_paid_cny_fen INTEGER,created_at INTEGER);
    CREATE TABLE internal_order_finance_positions(finance_status TEXT,confirmed_business_date TEXT,review_approved_business_date TEXT,projected_gross_profit_cny_fen INTEGER,completed_gross_profit_cny_fen INTEGER,confirmed_at INTEGER);
    CREATE TABLE formal_order_financial_adjustments(adjustment_scope TEXT,amount_cny_fen INTEGER,created_at INTEGER);
  `);
}

class RecordingStorage implements ObjectStorageAdapter{
  readonly deleted:string[]=[];
  async putObject(_input:ObjectStoragePutInput):Promise<ObjectStoragePutResult>{throw new Error('not_used');}
  async headObject(_objectKey:string):Promise<ObjectStorageHead|null>{return null;}
  async readPrefix(_objectKey:string,_maximumBytes:number):Promise<Uint8Array<ArrayBuffer>>{return new Uint8Array();}
  async readObject(_objectKey:string):Promise<Uint8Array<ArrayBuffer>>{return new Uint8Array();}
  async deleteObject(objectKey:string):Promise<void>{this.deleted.push(objectKey);}
}
class FailingDeleteStorage extends RecordingStorage{
  override async deleteObject(_objectKey:string):Promise<void>{throw new Error('simulated_r2_failure');}
}
