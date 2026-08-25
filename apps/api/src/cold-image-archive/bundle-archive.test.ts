import { afterEach, describe, expect, it } from 'vitest';
import type { FileActor } from '@ygb/contracts';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import { MockObjectStorage } from '../files/mock-object-storage';
import { createFileReadIntent, consumeFileReadIntent } from '../files/file-read-service';
import { runScheduledOperations } from '../scheduled-operations/runner';
import { recordOrderBusinessClosure, reopenOrderBusinessClosure } from './business-closure';
import { FakeDriveArchiveClient } from './fake-drive-client';
import { runArchiveBundleJob } from './archive-pipeline';
import { computeArchiveMetrics } from './metrics';
import {
  processArchiveQueueMessage,
  type ArchiveConsumerControls,
} from './queue-consumer';
import { requestBundleRestore, runRestoreCleanupScan, RESTORE_TEMPORARY_RETENTION_MS } from './restore';
import { bundleEligibilityAt } from './time';
import { runArchiveSelectorScan } from './selector';
import {
  coldArchiveOwner,
  seedColdArchiveFile,
  seedConfirmedColdArchiveOrder,
  settleColdArchivePrincipal,
} from '../../test-support/cold-archive-fixture';
import type { FileAuthorizationService } from '../files/authorization';

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7, 6, 5, 4, 3, 2]);
const fileActor: FileActor = { type: 'STAFF', id: 'cold-archive-owner', roles: ['owner'] };
const allow: FileAuthorizationService = {
  assertCanCreateUpload: () => {},
  assertCanUpload: () => {},
  assertCanCompleteUpload: () => {},
  assertCanLink: () => {},
  assertCanRead: () => {},
};

let database: SqliteDatabase | null = null;
afterEach(() => { database?.close(); database = null; });

interface SeededOrder {
  orderId: string;
  sellerOrganizationId: string;
  businessClosedAt: number;
  eligibilityAt: number;
  orderFileId: string;
  orderFileKey: string;
  proofFileId: string;
  proofFileKey: string;
}

async function seedClosedOrder(
  db: SqliteDatabase,
  r2: MockObjectStorage,
  suffix: string,
): Promise<SeededOrder> {
  const order = await seedConfirmedColdArchiveOrder(db, suffix);
  const orderFile = await seedColdArchiveFile(db, {
    suffix: `order-${suffix}`,
    formalOrderId: order.formalOrderId,
    bytes: png,
  });
  await r2.putObject({
    objectKey: orderFile.objectKey,
    bytes: png,
    contentType: 'image/png',
    metadata: {},
  });
  const settled = await settleColdArchivePrincipal(db, {
    suffix,
    formalOrderId: order.formalOrderId,
    sellerOrganizationId: order.sellerOrganizationId,
    proofBytes: jpg,
  });
  await r2.putObject({
    objectKey: settled.objectKey,
    bytes: jpg,
    contentType: 'image/png',
    metadata: {},
  });
  // Materialize hot R2 bytes for every order-linked evidence file the
  // fixture registered (the phase3g evidence bytes are fixture-internal, so
  // store deterministic filler and align the recorded hash with it).
  const linked = await db.prepare(
    `SELECT object.id AS file_id,object.object_key,object.uploaded_byte_size AS size
     FROM file_entity_links link
     JOIN file_objects object ON object.id=link.file_object_id
     JOIN formal_orders formal_order ON formal_order.id=?
     WHERE link.revoked_at IS NULL AND object.status='VERIFIED'
       AND ((link.entity_type='ORDER' AND (link.entity_id=formal_order.id OR link.entity_id=formal_order.order_evidence_version_id))
         OR (link.entity_type='ORDER_EVIDENCE_SUBMISSION' AND link.entity_id=(
           SELECT version.submission_id FROM order_evidence_versions version
           WHERE version.id=formal_order.order_evidence_version_id)))`,
  ).bind(order.formalOrderId).all<{ file_id: string; object_key: string; size: number }>();
  for (const row of linked.results) {
    if (await r2.headObject(row.object_key)) continue;
    const filler = new Uint8Array(new ArrayBuffer(row.size));
    for (let index = 0; index < row.size; index += 1) filler[index] = index % 251;
    const fillerSha = await import('@ygb/domain').then((m) => m.sha256Hex(filler));
    await r2.putObject({ objectKey: row.object_key, bytes: filler, contentType: 'image/png', metadata: {} });
    await db.prepare('UPDATE file_objects SET uploaded_sha256=? WHERE id=?').bind(fillerSha, row.file_id).run();
  }
  const closure = await recordOrderBusinessClosure(db, {
    formalOrderId: order.formalOrderId,
    expectedVersion: 0,
    notApplicable: ['review', 'buyer_refund', 'seller_service_fee'],
    reason: 'stage5 integration closure',
  }, {
    actor: coldArchiveOwner,
    idempotencyKey: `stage5-close-${suffix}`,
    now: settled.completedAt + 1,
  });
  return {
    orderId: order.formalOrderId,
    sellerOrganizationId: order.sellerOrganizationId,
    businessClosedAt: closure.business_closed_at,
    eligibilityAt: bundleEligibilityAt(closure.business_closed_at),
    orderFileId: orderFile.fileId,
    orderFileKey: orderFile.objectKey,
    proofFileId: settled.fileId,
    proofFileKey: settled.objectKey,
  };
}

async function enableControls(
  db: SqliteDatabase,
  mode: { selector?: boolean; driveUpload?: boolean; hotDelete?: boolean; restoreWorker?: boolean; shadow?: boolean },
): Promise<void> {
  await db.prepare(
    `UPDATE archive_runtime_controls SET selector_enabled=?,drive_upload_enabled=?,hot_delete_enabled=?,
     restore_worker_enabled=?,shadow_copy_only=?,version=version+1,updated_at=? WHERE singleton_id=1`,
  ).bind(
    mode.selector === false ? 0 : 1,
    mode.driveUpload === true ? 1 : 0,
    mode.hotDelete === true ? 1 : 0,
    mode.restoreWorker === true ? 1 : 0,
    mode.shadow === false ? 0 : 1,
    Date.now(),
  ).run();
}

function consumerControls(overrides: Partial<ArchiveConsumerControls> = {}): ArchiveConsumerControls {
  return {
    driveUploadEnabled: true,
    hotDeleteEnabled: false,
    shadowCopyOnly: true,
    restoreWorkerEnabled: true,
    ...overrides,
  };
}

async function selectorBundle(db: SqliteDatabase, orderId: string): Promise<{ id: string; version: number; state: string } | null> {
  return db.prepare('SELECT id,bundle_version AS version,state FROM archive_bundles WHERE bundle_type=\'ORDER\' AND ref_id=? AND is_current=1')
    .bind(orderId).first();
}

describe('stage 5 cold archive bundle pipeline', () => {
  it('gates eligibility on six UTC calendar months, not 180 days', async () => {
    database = createMigratedTestDatabase();
    const r2 = new MockObjectStorage();
    const seeded = await seedClosedOrder(database, r2, 'boundary');
    // Six natural months is never 180 days: 1 Aug → 1 Feb next year is 184 days.
    expect(seeded.eligibilityAt - seeded.businessClosedAt).toBeGreaterThan(180 * 86_400_000);
    await enableControls(database, {});
    const before = await runArchiveSelectorScan(database, {
      now: seeded.eligibilityAt - 1,
      state: { orderCursor: null, refundCursor: null, settlementCursor: null },
    });
    expect(before.bundlesCreated).toBe(0);
    const at = await runArchiveSelectorScan(database, {
      now: seeded.eligibilityAt,
      state: { orderCursor: null, refundCursor: null, settlementCursor: null },
    });
    // The ORDER bundle and the settlement-payment bundle both become due at
    // the same closing timestamp.
    expect(at.bundlesCreated).toBe(2);
    expect(at.jobsCreated).toBe(2);
    const bundle = await selectorBundle(database, seeded.orderId);
    expect(bundle).toMatchObject({ state: 'ONLINE' });
    // Fail closed: an order without a closure never becomes a bundle.
    const again = await runArchiveSelectorScan(database, {
      now: seeded.eligibilityAt + 1,
      state: { orderCursor: null, refundCursor: null, settlementCursor: null },
    });
    expect(again.bundlesCreated).toBe(0);
    expect(again.jobsCreated).toBe(0);
  });

  it('shadow-copies by default: fake Drive upload + verified read-back, no deletion, stays ONLINE', async () => {
    database = createMigratedTestDatabase();
    const r2 = new MockObjectStorage();
    const drive = new FakeDriveArchiveClient();
    const seeded = await seedClosedOrder(database, r2, 'shadow');
    await enableControls(database, {});
    await runArchiveSelectorScan(database, {
      now: seeded.eligibilityAt,
      state: { orderCursor: null, refundCursor: null, settlementCursor: null },
    });
    const bundle = (await selectorBundle(database, seeded.orderId))!;
    const outcome = await runArchiveBundleJob(
      database,
      { bundleId: bundle!['id'], now: seeded.eligibilityAt + 5 },
      { storage: r2, drive },
      { driveUploadEnabled: true, hotDeleteEnabled: false, shadowCopyOnly: true },
    );
    expect(outcome.outcome).toBe('SHADOW_COMPLETED');
    const row = await database.prepare(
      'SELECT state,sealed_at,manifest_sha256,manifest_file_count,zip_sha256,zip_byte_size,drive_file_id,drive_verified_at,shadow_completed_at,archived_at FROM archive_bundles WHERE id=?',
    ).bind(bundle!['id']).first();
    expect(row).toMatchObject({
      state: 'ONLINE',
      sealed_at: expect.any(Number),
      manifest_file_count: 2,
      drive_file_id: expect.stringMatching(/^fake-drive-file:/),
      drive_verified_at: expect.any(Number),
      shadow_completed_at: expect.any(Number),
      archived_at: null,
    });
    // Projected release is recorded but nothing was actually released.
    expect(await r2.headObject(seeded.orderFileKey)).not.toBeNull();
    const metrics = await computeArchiveMetrics(database, { now: seeded.eligibilityAt + 6 });
    expect(metrics.shadow_copy_projected_files).toBe(2);
    expect(metrics.shadow_copy_projected_bytes).toBeGreaterThan(png.byteLength);
    // Manifest entries carry the sealed facts and unguessable names.
    const entries = await database.prepare(
      'SELECT safe_name,sha256,byte_size,source_etag FROM archive_bundle_files WHERE bundle_id=? ORDER BY entry_index',
    ).bind(bundle!['id']).all();
    expect(entries.results).toHaveLength(2);
    expect(entries.results[0]).toMatchObject({ sha256: await import('@ygb/domain').then((m) => m.sha256Hex(png)), byte_size: png.byteLength });
    expect(entries.results[0]!['safe_name']).toMatch(/^0000-[0-9a-f]{16}\.png$/);
    expect(entries.results[1]!['source_etag']).toMatch(/^mock-/);
  });

  it('archives fully only after verified upload, then deletes hot copies and blocks reopen', async () => {
    database = createMigratedTestDatabase();
    const r2 = new MockObjectStorage();
    const drive = new FakeDriveArchiveClient();
    const seeded = await seedClosedOrder(database, r2, 'full');
    await enableControls(database, { driveUpload: true, hotDelete: true, shadow: false });
    await runArchiveSelectorScan(database, {
      now: seeded.eligibilityAt,
      state: { orderCursor: null, refundCursor: null, settlementCursor: null },
    });
    const bundle = (await selectorBundle(database, seeded.orderId))!;
    const outcome = await runArchiveBundleJob(
      database,
      { bundleId: bundle!['id'], now: seeded.eligibilityAt + 5 },
      { storage: r2, drive },
      { driveUploadEnabled: true, hotDeleteEnabled: true, shadowCopyOnly: false },
    );
    expect(outcome.outcome).toBe('SUCCEEDED');
    const row = await database.prepare(
      'SELECT state,archived_at,hot_files_total,hot_files_deleted,hot_delete_completed_at FROM archive_bundles WHERE id=?',
    ).bind(bundle!['id']).first();
    expect(row).toMatchObject({
      state: 'ARCHIVED',
      archived_at: expect.any(Number),
      hot_files_total: 2,
      hot_files_deleted: 2,
      hot_delete_completed_at: expect.any(Number),
    });
    expect(await r2.headObject(seeded.orderFileKey)).toBeNull();
    const job = await database.prepare('SELECT state,finished_at FROM archive_jobs WHERE bundle_id=?').bind(bundle!['id']).first();
    expect(job).toMatchObject({ state: 'SUCCEEDED', finished_at: expect.any(Number) });
    const events = await database.prepare(
      'SELECT event_type FROM archive_bundle_events WHERE bundle_id=? ORDER BY created_at',
    ).bind(bundle!['id']).all();
    expect(events.results.map((row2) => row2['event_type'])).toEqual(expect.arrayContaining([
      'BUNDLE_CREATED', 'MANIFEST_SEALED', 'ZIP_STREAMED', 'DRIVE_UPLOAD_STARTED',
      'DRIVE_UPLOADED', 'DRIVE_READBACK_VERIFIED', 'HOT_FILE_DELETED', 'HOT_DELETE_COMPLETED', 'ARCHIVE_FINALIZED',
    ]));
    // Once archived facts are deleted the order closure can no longer reopen.
    await expect(reopenOrderBusinessClosure(database, {
      formalOrderId: seeded.orderId,
      expectedVersion: 1,
      reason: '归档后尝试重开',
    }, { actor: coldArchiveOwner, idempotencyKey: 'stage5-reopen-blocked', now: seeded.eligibilityAt + 10 }))
      .rejects.toMatchObject({ code: 'STATE_CONFLICT' });
  });

  it('keeps hot copies when Drive read-back verification fails', async () => {
    database = createMigratedTestDatabase();
    const r2 = new MockObjectStorage();
    const drive = new FakeDriveArchiveClient();
    const seeded = await seedClosedOrder(database, r2, 'verify-fail');
    await enableControls(database, { driveUpload: true, hotDelete: true, shadow: false });
    await runArchiveSelectorScan(database, {
      now: seeded.eligibilityAt,
      state: { orderCursor: null, refundCursor: null, settlementCursor: null },
    });
    const bundle = (await selectorBundle(database, seeded.orderId))!;
    drive.failNextOperation('metadata', 'invalid_response');
    await expect(runArchiveBundleJob(
      database,
      { bundleId: bundle!['id'], now: seeded.eligibilityAt + 5 },
      { storage: r2, drive },
      { driveUploadEnabled: true, hotDeleteEnabled: true, shadowCopyOnly: false },
    )).rejects.toMatchObject({ category: 'drive_verification_failed' });
    expect(await r2.headObject(seeded.orderFileKey)).not.toBeNull();
    const row = await database.prepare('SELECT state,archived_at FROM archive_bundles WHERE id=?').bind(bundle!['id']).first();
    expect(row).toMatchObject({ state: 'ONLINE', archived_at: null });
  });

  it('dead-letters a bundle whose R2 hot copy disappears before sealing', async () => {
    database = createMigratedTestDatabase();
    const r2 = new MockObjectStorage();
    const drive = new FakeDriveArchiveClient();
    const seeded = await seedClosedOrder(database, r2, 'poison');
    await enableControls(database, { driveUpload: true, hotDelete: true, shadow: false });
    await runArchiveSelectorScan(database, {
      now: seeded.eligibilityAt,
      state: { orderCursor: null, refundCursor: null, settlementCursor: null },
    });
    const bundle = (await selectorBundle(database, seeded.orderId))!;
    await r2.deleteObject(seeded.orderFileKey);
    const jobRow = await database.prepare('SELECT id FROM archive_jobs WHERE bundle_id=?').bind(bundle!['id']).first();
    const disposition = await processArchiveQueueMessage(
      database,
      { bundle_id: bundle!['id'], bundle_version: 1, job_type: 'ARCHIVE_BUNDLE', trace_id: jobRow!['id'] },
      { now: seeded.eligibilityAt + 5 },
      { storage: r2, drive },
      consumerControls({ hotDeleteEnabled: true, shadowCopyOnly: false }),
    );
    expect(disposition.action).toBe('DEAD_LETTER_ACK');
    const job = await database.prepare('SELECT state,error_category FROM archive_jobs WHERE bundle_id=?').bind(bundle!['id']).first();
    expect(job).toMatchObject({ state: 'DEAD_LETTERED', error_category: 'file_integrity_mismatch' });
  });

  it('is idempotent under duplicate queue delivery and resumes an expired lease', async () => {
    database = createMigratedTestDatabase();
    const r2 = new MockObjectStorage();
    const drive = new FakeDriveArchiveClient();
    const seeded = await seedClosedOrder(database, r2, 'dup');
    await enableControls(database, { driveUpload: true, hotDelete: true, shadow: false });
    await runArchiveSelectorScan(database, {
      now: seeded.eligibilityAt,
      state: { orderCursor: null, refundCursor: null, settlementCursor: null },
    });
    const bundle = (await selectorBundle(database, seeded.orderId))!;
    const jobRow = await database.prepare('SELECT id,trace_id FROM archive_jobs WHERE bundle_id=?').bind(bundle!['id']).first();
    const message = { bundle_id: bundle!['id'], bundle_version: 1, job_type: 'ARCHIVE_BUNDLE' as const, trace_id: jobRow!['trace_id'] };
    // Simulate a crashed consumer: the job sits LEASED with an expired lease.
    await database.prepare(
      `UPDATE archive_jobs SET state='LEASED',lease_token='stale',lease_expires_at=? WHERE bundle_id=?`,
    ).bind(seeded.eligibilityAt - 1, bundle!['id']).run();
    const first = await processArchiveQueueMessage(database, message, { now: seeded.eligibilityAt + 5 }, { storage: r2, drive }, consumerControls({ hotDeleteEnabled: true, shadowCopyOnly: false }));
    expect(first.action).toBe('ACK');
    const duplicate = await processArchiveQueueMessage(database, message, { now: seeded.eligibilityAt + 6 }, { storage: r2, drive }, consumerControls({ hotDeleteEnabled: true, shadowCopyOnly: false }));
    expect(duplicate.action).toBe('ACK');
    expect(drive.storedFileCount()).toBe(1);
    expect(drive.uploads).toHaveLength(1);
    const job = await database.prepare('SELECT state FROM archive_jobs WHERE bundle_id=?').bind(bundle!['id']).first();
    expect(job!['state']).toBe('SUCCEEDED');
  });

  it('retries a rate-limited Drive upload with exponential backoff delay', async () => {
    database = createMigratedTestDatabase();
    const r2 = new MockObjectStorage();
    const drive = new FakeDriveArchiveClient();
    const seeded = await seedClosedOrder(database, r2, 'backoff');
    await enableControls(database, { driveUpload: true });
    await runArchiveSelectorScan(database, {
      now: seeded.eligibilityAt,
      state: { orderCursor: null, refundCursor: null, settlementCursor: null },
    });
    const bundle = (await selectorBundle(database, seeded.orderId))!;
    const jobRow = await database.prepare('SELECT trace_id FROM archive_jobs WHERE bundle_id=?').bind(bundle!['id']).first();
    drive.failNextOperation('create', 'rate_limited');
    const disposition = await processArchiveQueueMessage(
      database,
      { bundle_id: bundle!['id'], bundle_version: 1, job_type: 'ARCHIVE_BUNDLE', trace_id: jobRow!['trace_id'] },
      { now: seeded.eligibilityAt + 5 },
      { storage: r2, drive },
      consumerControls(),
    );
    expect(disposition.action).toBe('RETRY');
    expect(disposition.delaySeconds).toBeGreaterThanOrEqual(60);
    expect(disposition.delaySeconds).toBeLessThanOrEqual(3600 + 30);
    const job = await database.prepare('SELECT state,error_category,next_retry_at FROM archive_jobs WHERE bundle_id=?').bind(bundle!['id']).first();
    expect(job).toMatchObject({ state: 'FAILED_RETRYABLE', error_category: 'drive_rate_limited' });
    expect(job!['next_retry_at']).toBeGreaterThan(seeded.eligibilityAt + 5);
    expect(await r2.headObject(seeded.orderFileKey)).not.toBeNull();
  });

  it('supersedes a shadow-completed bundle when new evidence appears', async () => {
    database = createMigratedTestDatabase();
    const r2 = new MockObjectStorage();
    const drive = new FakeDriveArchiveClient();
    const seeded = await seedClosedOrder(database, r2, 'supersede');
    await enableControls(database, {});
    await runArchiveSelectorScan(database, {
      now: seeded.eligibilityAt,
      state: { orderCursor: null, refundCursor: null, settlementCursor: null },
    });
    const first = (await selectorBundle(database, seeded.orderId))!;
    await runArchiveBundleJob(database, { bundleId: first!['id'], now: seeded.eligibilityAt + 5 }, { storage: r2, drive }, { driveUploadEnabled: true, hotDeleteEnabled: false, shadowCopyOnly: true });
    // New order evidence arrives AFTER the shadow pass.
    const late = await seedColdArchiveFile(database, {
      suffix: `late-${seeded.orderId}`,
      formalOrderId: seeded.orderId,
      bytes: jpg,
    });
    await r2.putObject({ objectKey: late.objectKey, bytes: jpg, contentType: 'image/png', metadata: {} });
    const scan = await runArchiveSelectorScan(database, {
      now: seeded.eligibilityAt + 10,
      state: { orderCursor: null, refundCursor: null, settlementCursor: null },
    });
    expect(scan.bundlesSuperseded).toBe(1);
    const rows = await database.prepare(
      'SELECT bundle_version,is_current,superseded_by_version FROM archive_bundles WHERE bundle_type=\'ORDER\' AND ref_id=? ORDER BY bundle_version',
    ).bind(seeded.orderId).all();
    expect(rows.results.map((row) => [row['bundle_version'], row['is_current']])).toEqual([[1, 0], [2, 1]]);
    expect(rows.results[0]!['superseded_by_version']).toBe(2);
  });

  it('restores staff-only into temporary R2 with original audience, then cleans up after 7 days', async () => {
    database = createMigratedTestDatabase();
    const r2 = new MockObjectStorage();
    const drive = new FakeDriveArchiveClient();
    const seeded = await seedClosedOrder(database, r2, 'restore');
    await enableControls(database, { driveUpload: true, hotDelete: true, shadow: false, restoreWorker: true });
    await runArchiveSelectorScan(database, {
      now: seeded.eligibilityAt,
      state: { orderCursor: null, refundCursor: null, settlementCursor: null },
    });
    const bundle = (await selectorBundle(database, seeded.orderId))!;
    await runArchiveBundleJob(database, { bundleId: bundle!['id'], now: seeded.eligibilityAt + 5 }, { storage: r2, drive }, { driveUploadEnabled: true, hotDeleteEnabled: true, shadowCopyOnly: false });
    expect(await r2.headObject(seeded.orderFileKey)).toBeNull();

    // Placeholder: every audience, including Staff, gets 410 FILE_ARCHIVED.
    await expect(createFileReadIntent(database, allow, {
      fileObjectId: seeded.orderFileId,
      expectedFileVersion: 2,
    }, { actor: fileActor, principal: { type: 'STAFF_SESSION', staffId: 'cold-archive-owner' }, idempotencyKey: 'stage5-read-archived', now: seeded.eligibilityAt + 6 }))
      .rejects.toMatchObject({ code: 'FILE_ARCHIVED', status: 410 });

    // Non-owner staff cannot request a restore.
    const notOwner = { ...coldArchiveOwner, staffId: 'stage5-not-owner', roles: new Set(['buyer_refund' as const]) };
    await expect(requestBundleRestore(database, { bundleId: bundle!['id'] }, {
      actor: notOwner as never,
      idempotencyKey: 'stage5-restore-forbidden',
      now: seeded.eligibilityAt + 7,
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const request = await requestBundleRestore(database, { bundleId: bundle!['id'] }, {
      actor: coldArchiveOwner,
      idempotencyKey: 'stage5-restore-ok',
      now: seeded.eligibilityAt + 8,
    });
    expect(request).toMatchObject({
      state: 'REQUESTED',
      restore_expires_at: seeded.eligibilityAt + 8 + RESTORE_TEMPORARY_RETENTION_MS,
      replayed: false,
    });
    const replay = await requestBundleRestore(database, { bundleId: bundle!['id'] }, {
      actor: coldArchiveOwner,
      idempotencyKey: 'stage5-restore-ok',
      now: seeded.eligibilityAt + 9,
    });
    expect(replay.replayed).toBe(true);

    const restoreJob = await database.prepare('SELECT trace_id FROM archive_jobs WHERE bundle_id=? AND job_type=\'RESTORE_BUNDLE\'').bind(bundle!['id']).first();
    const disposition = await processArchiveQueueMessage(
      database,
      { bundle_id: bundle!['id'], bundle_version: 1, job_type: 'RESTORE_BUNDLE', trace_id: restoreJob!['trace_id'] },
      { now: seeded.eligibilityAt + 10 },
      { storage: r2, drive },
      consumerControls({ restoreWorkerEnabled: true }),
    );
    expect(disposition.action).toBe('ACK');
    const restoredBundle = await database.prepare(
      'SELECT state,restore_expires_at FROM archive_bundles WHERE id=?',
    ).bind(bundle!['id']).first();
    expect(restoredBundle).toMatchObject({
      state: 'RESTORED_TEMPORARILY',
      restore_expires_at: seeded.eligibilityAt + 8 + RESTORE_TEMPORARY_RETENTION_MS,
    });
    const members = await database.prepare('SELECT temp_object_key,byte_size FROM archive_restore_members').all();
    expect(members.results).toHaveLength(2);
    expect(members.results.map((member) => member['byte_size'])).toEqual(expect.arrayContaining([png.byteLength]));
    expect(await r2.headObject(String(members.results[0]!['temp_object_key']))).not.toBeNull();

    // Original bytes now flow through the ordinary read-intent path again.
    const intent = await createFileReadIntent(database, allow, {
      fileObjectId: seeded.orderFileId,
      expectedFileVersion: 2,
    }, { actor: fileActor, principal: { type: 'STAFF_SESSION', staffId: 'cold-archive-owner' }, idempotencyKey: 'stage5-read-restored', now: seeded.eligibilityAt + 11 });
    const content = await consumeFileReadIntent(database, r2, allow, {
      readIntentId: intent.readIntentId,
      accessToken: intent.accessToken!,
    }, { actor: fileActor, principal: { type: 'STAFF_SESSION', staffId: 'cold-archive-owner' }, now: seeded.eligibilityAt + 12 });
    expect(content.bytes ?? content.stream).toBeTruthy();
    if (content.bytes) expect(content.bytes).toEqual(png);

    // Audit trail records the staff restore request.
    const audit = await database.prepare(
      `SELECT COUNT(*) AS count FROM audit_events WHERE aggregate_type='ARCHIVE_BUNDLE' AND event_type='ARCHIVE_RESTORE_REQUESTED'`,
    ).first();
    expect(audit!['count']).toBeGreaterThan(0);

    // Seven days later: cleanup returns the bundle to ARCHIVED and removes
    // every temporary object; the Drive original is untouched.
    const driveFilesBefore = drive.storedFileCount();
    const cleanupNow = request.restore_expires_at + 1;
    const cleanup = await runRestoreCleanupScan(database, { now: cleanupNow, limit: 10 }, { storage: r2 });
    expect(cleanup.cleaned).toBe(1);
    for (const member of members.results) {
      expect(await r2.headObject(String(member['temp_object_key']))).toBeNull();
    }
    expect(drive.storedFileCount()).toBe(driveFilesBefore);
    const afterCleanup = await database.prepare(
      'SELECT state,restore_expires_at FROM archive_bundles WHERE id=?',
    ).bind(bundle!['id']).first();
    expect(afterCleanup).toMatchObject({ state: 'ARCHIVED', restore_expires_at: null });
    const restoreRow = await database.prepare('SELECT state,cleaned_at FROM archive_restores WHERE id=?').bind(request.restore_id).first();
    expect(restoreRow).toMatchObject({ state: 'CLEANED', cleaned_at: expect.any(Number) });
    await expect(createFileReadIntent(database, allow, {
      fileObjectId: seeded.orderFileId,
      expectedFileVersion: 2,
    }, { actor: fileActor, principal: { type: 'STAFF_SESSION', staffId: 'cold-archive-owner' }, idempotencyKey: 'stage5-read-expired', now: cleanupNow + 1 }))
      .rejects.toMatchObject({ code: 'FILE_ARCHIVED' });
  });

  it('drives the whole flow through the scheduled runner with switches honored', async () => {
    database = createMigratedTestDatabase();
    const r2 = new MockObjectStorage();
    const drive = new FakeDriveArchiveClient();
    const seeded = await seedClosedOrder(database, r2, 'runner');
    await enableControls(database, { driveUpload: true, hotDelete: true, shadow: false });
    const runs = await runScheduledOperations(database, {
      enabled: true,
      only: 'drive_archive',
      storage: r2,
      archive: {
        client: drive,
        queue: null,
        selectorEnabled: true,
        driveUploadEnabled: true,
        hotDeleteEnabled: true,
        restoreWorkerEnabled: true,
      },
      now: seeded.eligibilityAt,
    });
    const bundle = await selectorBundle(database, seeded.orderId);
    expect(bundle).toMatchObject({ state: 'ARCHIVED' });
    expect(runs[0]).toMatchObject({ job_name: 'drive_archive', outcome: 'SUCCEEDED' });
    expect(await r2.headObject(seeded.orderFileKey)).toBeNull();
    const metrics = await computeArchiveMetrics(database, { now: seeded.eligibilityAt + 1 });
    expect(metrics.archive_succeeded_total).toBe(2);
    expect(metrics.eligible_backlog_bundles).toBe(0);
    expect(metrics.last_success_at).not.toBeNull();
  });

  it('does nothing when the selector switch is off', async () => {
    database = createMigratedTestDatabase();
    const r2 = new MockObjectStorage();
    const drive = new FakeDriveArchiveClient();
    const seeded = await seedClosedOrder(database, r2, 'off');
    // Controls remain at the seeded all-off defaults.
    const runs = await runScheduledOperations(database, {
      enabled: true,
      only: 'drive_archive',
      storage: r2,
      archive: {
        client: drive,
        queue: null,
        selectorEnabled: false,
        driveUploadEnabled: false,
        hotDeleteEnabled: false,
        restoreWorkerEnabled: false,
      },
      now: seeded.eligibilityAt,
    });
    expect(runs[0]).toMatchObject({ job_name: 'drive_archive', outcome: 'DISABLED' });
    expect(await selectorBundle(database, seeded.orderId)).toBeNull();
    expect(await r2.headObject(seeded.orderFileKey)).not.toBeNull();
  });

  it('keeps the settlement-proof bundle separate and archives it on its own', async () => {
    database = createMigratedTestDatabase();
    const r2 = new MockObjectStorage();
    const drive = new FakeDriveArchiveClient();
    const seeded = await seedClosedOrder(database, r2, 'settlement');
    await enableControls(database, { driveUpload: true, hotDelete: true, shadow: false });
    await runArchiveSelectorScan(database, {
      now: seeded.eligibilityAt,
      state: { orderCursor: null, refundCursor: null, settlementCursor: null },
    });
    const settlementBundle = await database.prepare(
      'SELECT id,state FROM archive_bundles WHERE bundle_type=\'SELLER_SETTLEMENT_PAYMENT\' AND is_current=1',
    ).first();
    expect(settlementBundle).toMatchObject({ state: 'ONLINE' });
    const outcome = await runArchiveBundleJob(
      database,
      { bundleId: String(settlementBundle!['id']), now: seeded.eligibilityAt + 5 },
      { storage: r2, drive },
      { driveUploadEnabled: true, hotDeleteEnabled: true, shadowCopyOnly: false },
    );
    expect(outcome.outcome).toBe('SUCCEEDED');
    expect(await r2.headObject(seeded.proofFileKey)).toBeNull();
    expect(await r2.headObject(seeded.orderFileKey)).not.toBeNull();
  });

  it('never widens audience: a buyer outside the order still cannot read after restore', async () => {
    database = createMigratedTestDatabase();
    const r2 = new MockObjectStorage();
    const drive = new FakeDriveArchiveClient();
    const seeded = await seedClosedOrder(database, r2, 'audience');
    await enableControls(database, { driveUpload: true, hotDelete: true, shadow: false, restoreWorker: true });
    await runArchiveSelectorScan(database, {
      now: seeded.eligibilityAt,
      state: { orderCursor: null, refundCursor: null, settlementCursor: null },
    });
    const bundle = (await selectorBundle(database, seeded.orderId))!;
    await runArchiveBundleJob(database, { bundleId: bundle!['id'], now: seeded.eligibilityAt + 5 }, { storage: r2, drive }, { driveUploadEnabled: true, hotDeleteEnabled: true, shadowCopyOnly: false });
    await requestBundleRestore(database, { bundleId: bundle!['id'] }, {
      actor: coldArchiveOwner, idempotencyKey: 'stage5-aud-restore', now: seeded.eligibilityAt + 6,
    });
    const restoreJob = await database.prepare('SELECT trace_id FROM archive_jobs WHERE bundle_id=? AND job_type=\'RESTORE_BUNDLE\'').bind(bundle!['id']).first();
    await processArchiveQueueMessage(
      database,
      { bundle_id: bundle!['id'], bundle_version: 1, job_type: 'RESTORE_BUNDLE', trace_id: restoreJob!['trace_id'] },
      { now: seeded.eligibilityAt + 7 },
      { storage: r2, drive },
      consumerControls({ restoreWorkerEnabled: true }),
    );
    // Authorization denial (deny-all service) still fails even though the
    // temporary copy exists — the restore never widens visibility.
    const deny: FileAuthorizationService = {
      assertCanCreateUpload: () => { throw new Error('nope'); },
      assertCanUpload: () => { throw new Error('nope'); },
      assertCanCompleteUpload: () => { throw new Error('nope'); },
      assertCanLink: () => { throw new Error('nope'); },
      assertCanRead: () => { throw new Error('denied_audience'); },
    };
    await expect(createFileReadIntent(database, deny, {
      fileObjectId: seeded.orderFileId,
      expectedFileVersion: 2,
    }, { actor: fileActor, principal: { type: 'STAFF_SESSION', staffId: 'someone-else' }, idempotencyKey: 'stage5-deny', now: seeded.eligibilityAt + 8 }))
      .rejects.toBeTruthy();
  });
});
