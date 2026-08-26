import { afterEach, describe, expect, it } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import { sha256Hex } from '@ygb/domain';
import { MockObjectStorage } from '../../../apps/api/src/files/mock-object-storage';
import { FakeDriveArchiveClient } from '../../../apps/api/src/cold-image-archive/fake-drive-client';
import { runArchiveBundleJob } from '../../../apps/api/src/cold-image-archive/archive-pipeline';
import { recordOrderBusinessClosure } from '../../../apps/api/src/cold-image-archive/business-closure';
import { runArchiveSelectorScan, fetchUnitFileFacts, type SelectorScanState } from '../../../apps/api/src/cold-image-archive/selector';
import {
  coldArchiveOwner,
  seedColdArchiveFile,
  seedConfirmedColdArchiveOrder,
  settleColdArchivePrincipal,
} from '../../../apps/api/test-support/cold-archive-fixture';
import {
  HISTORICAL_CSV_HEADERS,
} from './index';
import { runHistoricalImport } from './pipeline';

/**
 * Stage 6 ↔ stage 5 integration (task 6.8): the COLD_ARCHIVE_ELIGIBLE rows an
 * import produces are constrained by the 0025 closure trigger, and historical
 * file plans never enter the hot archive bundle path — the stage 5 selector
 * only ever reads live file_objects/file_entity_links facts.
 */

let database: SqliteDatabase | null = null;
afterEach(() => { database?.close(); database = null; });

function csvRow(overrides: Record<string, string> = {}): string {
  return HISTORICAL_CSV_HEADERS.map((header) => overrides[header] ?? '').join(',');
}

function buildCsv(rows: string[]): string {
  return `${[...HISTORICAL_CSV_HEADERS].join(',')}\n${rows.join('\n')}\n`;
}

const FULLY_CLOSED_OLD_ROW: Record<string, string> = {
  '下单日期': '2024-06-10',
  '更新状态': '已完成',
  '客户编号': 'C001',
  '买家微信': 'wx-hist-a',
  '店铺名字': '归档集成店铺',
  'ASIN': 'B0ARC0001',
  '订单价格': '1980',
  '聊天截图': 'img/arc-chat.png',
  '订单截图': 'img/arc-order.png',
  '订单号': '123-7777777-7000001',
  '提交评论日期': '2024-06-20',
  '通过日期': '2024-06-25',
  '评论通过截图': 'img/arc-review.png',
  '补fb日期': '2024-06-26',
  '补fb截图': 'img/arc-fb.png',
  '评论状态': '已通过',
  '返款状态': '已返款',
  '返款汇率': '0.058',
  '返款时间': '2024-07-01',
  '返款截图': 'img/arc-refund.png',
  '服务费金额': '25',
  '卖家返金汇率': '0.053',
  '结算日期': '2024-07-10',
  '买家返金金额': '95.5',
  '卖家返金金额': '90',
  '汇率差': '0.005',
  '利润': '5.5',
};

function seedHistIdentity(db: SqliteDatabase): void {
  db.exec(`
    INSERT INTO customer_identity_subjects(id,subject_type,created_at)
    VALUES('hist-arc-subject','BUYER_CUSTOMER',1000);
    INSERT INTO buyer_customers(id,identity_subject_id,marketplace_code,buyer_channel_id,buyer_customer_no,
      buyer_sequence,display_name,access_status,identity_review_status,
      version,created_at,updated_at,activated_at,disabled_at)
    VALUES('hist-arc-buyer','hist-arc-subject','AMAZON_JP','buyer-channel-wechat-b','20240610B0001',
      1,'归档集成买家','ACTIVE','CLEAR',1,1000,1000,1000,NULL);
    INSERT INTO wechat_identity_claims(id,identity_subject_id,display_wechat,normalized_wechat,
      status,version,acquired_at,created_at,updated_at)
    VALUES('hist-arc-claim','hist-arc-subject','wx-hist-a','wx-hist-a','ACTIVE',1,1000,1000,1000);
    INSERT INTO seller_organizations(id,marketplace_code,seller_code,origin_channel_id,current_channel_id,
      seller_sequence,organization_name,status,version,created_at,updated_at,activated_at,disabled_at,next_member_number)
    VALUES('hist-arc-seller','AMAZON_JP','hist-arc-1','seller-channel-ido-mango','seller-channel-ido-mango',9701,
      '归档集成卖家','ACTIVE',1,1000,1000,1000,NULL,2);
    INSERT INTO seller_stores(id,organization_id,marketplace_code,display_name,normalized_name,status,
      version,created_at,updated_at,disabled_at)
    VALUES('hist-arc-store','hist-arc-seller','AMAZON_JP','归档集成店铺','归档集成店铺','ACTIVE',1,1000,1000,NULL);
  `);
}

describe('stage 5 integration for historical imports', () => {
  it('0025 trigger rejects COLD classification when closure facts are incomplete', () => {
    const db = createMigratedTestDatabase();
    database = db;
    db.exec(`
      INSERT INTO historical_import_batches(id,source_system,source_files_json,source_files_sha256,
        parser_version,mapping_version,mode,status,source_row_count,valid_row_count,quarantined_row_count,
        imported_row_count,created_at,updated_at)
      VALUES('hist-arc-batch-000001','HISTORICAL_ORDER_CSV','[]','${'a'.repeat(64)}','v1','m1','APPLY_LOCAL',
        'RUNNING',0,0,0,0,1000,1000);
      INSERT INTO historical_orders(id,import_batch_id,source_system,source_row_key,source_order_id,
        marketplace_code,ordered_on,refunded_on,row_sha256,created_at)
      VALUES('hist-arc-order-open-1','hist-arc-batch-000001','HISTORICAL_ORDER_CSV','source-row-key-1','123-7777777-7000099',
        'AMAZON_JP','2024-06-10',NULL,'${'b'.repeat(64)}',1000);
    `);
    expect(() => db.exec(`
      INSERT INTO historical_order_files(id,import_batch_id,historical_order_id,source_row_key,purpose,
        audience,source_column,classification,created_at)
      VALUES('hist-arc-file-bad-01','hist-arc-batch-000001','hist-arc-order-open-1','source-row-key-1','ORDER_EVIDENCE',
        'INTERNAL_ONLY','订单截图','COLD_ARCHIVE_ELIGIBLE',1000);
    `)).toThrow('historical_file_cold_requires_complete_closure');
    // The same insert succeeds once the closure facts are complete — the
    // trigger constrains cold eligibility, not the table itself.
    db.exec(`
      INSERT INTO historical_orders(id,import_batch_id,source_system,source_row_key,source_order_id,
        marketplace_code,ordered_on,review_approved_on,refunded_on,settled_on,row_sha256,created_at)
      VALUES('hist-arc-order-closed-1','hist-arc-batch-000001','HISTORICAL_ORDER_CSV','source-row-key-2','123-7777777-7000098',
        'AMAZON_JP','2024-06-10','2024-06-25','2024-07-01','2024-07-10','${'c'.repeat(64)}',1000);
    `);
    expect(() => db.exec(`
      INSERT INTO historical_order_files(id,import_batch_id,historical_order_id,source_row_key,purpose,
        audience,source_column,classification,created_at)
      VALUES('hist-arc-file-ok-001','hist-arc-batch-000001','hist-arc-order-closed-1','source-row-key-2','ORDER_EVIDENCE',
        'INTERNAL_ONLY','订单截图','COLD_ARCHIVE_ELIGIBLE',1000);
    `)).not.toThrow();
  });

  it('keeps imported historical files out of the hot archive bundle path', async () => {
    const db = createMigratedTestDatabase();
    database = db;
    seedHistIdentity(database);
    const inventory = new Map([
      ['img/arc-chat.png', { sha256: 'f'.repeat(64), mime: 'image/png', byteSize: 100 }],
      ['img/arc-order.png', { sha256: 'e'.repeat(64), mime: 'image/png', byteSize: 120 }],
      ['img/arc-review.png', { sha256: 'd'.repeat(64), mime: 'image/jpeg', byteSize: 90 }],
      ['img/arc-fb.png', { sha256: 'c'.repeat(64), mime: 'image/jpeg', byteSize: 70 }],
      ['img/arc-refund.png', { sha256: 'b'.repeat(64), mime: 'image/jpeg', byteSize: 80 }],
    ]);
    const csv = buildCsv([
      csvRow(FULLY_CLOSED_OLD_ROW),
      csvRow({ ...FULLY_CLOSED_OLD_ROW, '订单号': '123-7777777-7000002' }),
    ]);
    const now = Date.UTC(2026, 7, 26);
    const imported = await runHistoricalImport(database, {
      sourceSystem: 'HISTORICAL_ORDER_CSV',
      files: [{ name: 'master.csv', text: csv }],
      imageInventory: inventory,
    }, { mode: 'APPLY_LOCAL', now });
    expect(imported.applied_orders).toBe(2);
    const coldRows = await database.prepare(
      `SELECT COUNT(*) AS count FROM historical_order_files WHERE classification='COLD_ARCHIVE_ELIGIBLE'`,
    ).first<{ count: number }>();
    expect(coldRows!.count).toBe(10);

    // A REAL confirmed, closed formal order with its own file drives exactly
    // one bundle through the stage 5 selector — the historical COLD rows on
    // the same database never join that path.
    const base = await seedConfirmedColdArchiveOrder(database, 'hist-arc-base');
    const filler = new Uint8Array(16);
    const r2 = new MockObjectStorage();
    const baseFile = await seedColdArchiveFile(database, {
      suffix: 'hist-arc-base-order', formalOrderId: base.formalOrderId, bytes: filler,
    });
    await r2.putObject({ objectKey: baseFile.objectKey, bytes: filler, contentType: 'image/png', metadata: {} });
    const settled = await settleColdArchivePrincipal(database, {
      suffix: 'hist-arc-base', formalOrderId: base.formalOrderId,
      sellerOrganizationId: base.sellerOrganizationId, proofBytes: filler,
    });
    await r2.putObject({ objectKey: settled.objectKey, bytes: filler, contentType: 'image/png', metadata: {} });
    const closure = await recordOrderBusinessClosure(database, {
      formalOrderId: base.formalOrderId,
      expectedVersion: 0,
      notApplicable: ['review', 'buyer_refund', 'seller_service_fee'],
      reason: 'historical integration closure',
    }, { actor: coldArchiveOwner, idempotencyKey: 'hist-arc-close', now: settled.completedAt + 1 });
    const virtualNow = closure.business_closed_at + 400 * 86_400_000;
    await database.prepare(
      `UPDATE archive_runtime_controls SET selector_enabled=1,drive_upload_enabled=1,version=version+1,updated_at=? WHERE singleton_id=1`,
    ).bind(now).run();

    let state: SelectorScanState = { orderCursor: null, refundCursor: null, settlementCursor: null };
    let bundlesCreated = 0;
    for (;;) {
      const outcome = await runArchiveSelectorScan(database, { now: virtualNow, limit: 100, state });
      bundlesCreated += outcome.bundlesCreated;
      state = outcome.state;
      if (state.orderCursor === null && state.refundCursor === null && state.settlementCursor === null) break;
    }
    // ORDER bundle for the formal order plus its settlement bundle — nothing
    // for the two imported historical orders.
    expect(bundlesCreated).toBe(2);
    const bundleRows = await database.prepare(
      `SELECT id,bundle_type,ref_id,formal_order_id,eligibility_at FROM archive_bundles ORDER BY bundle_type`,
    ).all<{ id: string; bundle_type: string; ref_id: string; formal_order_id: string; eligibility_at: number }>();
    const orderBundle = bundleRows.results.find((row) => row.bundle_type === 'ORDER')!;

    // Drive the ORDER bundle through the real manifest/ZIP/fake-Drive path;
    // its manifest files must be exactly the live file_objects facts — the
    // historical COLD rows stay metadata plans and never appear.
    const unitFacts = await fetchUnitFileFacts(database, {
      bundle_type: 'ORDER',
      ref_id: orderBundle.ref_id,
      formal_order_id: orderBundle.formal_order_id,
      last_closed_at: orderBundle.eligibility_at,
    });
    for (const fact of unitFacts) {
      // Arrange: fixtures carry placeholder digests for some files — align
      // the declared sha/size with the bytes actually materialized so the
      // ZIP writer's integrity checks reflect a consistent hot copy.
      const bytes = filler;
      const sha = await sha256Hex(bytes);
      await database.prepare(
        'UPDATE file_objects SET uploaded_sha256=?,uploaded_byte_size=? WHERE id=?',
      ).bind(sha, bytes.byteLength, fact.file_object_id).run();
      const fileRow = await database.prepare('SELECT object_key FROM file_objects WHERE id=?')
        .bind(fact.file_object_id).first<{ object_key: string }>();
      await r2.putObject({
        objectKey: fileRow!.object_key,
        bytes,
        contentType: 'image/png',
        metadata: {},
      });
    }
    await runArchiveBundleJob(database, { bundleId: orderBundle.id, now: virtualNow },
      { storage: r2, drive: new FakeDriveArchiveClient() },
      { driveUploadEnabled: true, hotDeleteEnabled: false, shadowCopyOnly: true });
    const manifestFiles = await database.prepare(
      'SELECT file_object_id FROM archive_bundle_files WHERE bundle_id=?',
    ).bind(orderBundle.id).all<{ file_object_id: string }>();
    // The manifest is exactly the live file_objects facts of the formal
    // order — the historical plans have no file_object_id and never appear.
    expect([...manifestFiles.results].sort((a, b) => a.file_object_id.localeCompare(b.file_object_id))
      .map((row) => row.file_object_id)).toEqual(
      [...unitFacts].sort((a, b) => a.file_object_id.localeCompare(b.file_object_id))
        .map((fact) => fact.file_object_id));
    expect(manifestFiles.results.map((row) => row.file_object_id)).toContain(baseFile.fileId);
    const stillCold = await database.prepare(
      `SELECT COUNT(*) AS count FROM historical_order_files WHERE classification='COLD_ARCHIVE_ELIGIBLE'`,
    ).first<{ count: number }>();
    expect(stillCold!.count).toBe(10);
    const bundleFileOverlap = await database.prepare(
      `SELECT COUNT(*) AS count FROM archive_bundle_files`,
    ).first<{ count: number }>();
    expect(bundleFileOverlap!.count).toBe(unitFacts.length);
  });
});
