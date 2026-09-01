import { afterEach, describe, expect, it } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import { sha256Hex } from '@ygb/domain';
import { MockObjectStorage } from '../files/mock-object-storage';
import { createFakeDriveHttpServer } from '../test-support/fake-drive-http';
import {
  coldArchiveOwner,
  seedColdArchiveFile,
  seedConfirmedColdArchiveOrder,
  settleColdArchivePrincipal,
} from '../../test-support/cold-archive-fixture';
import { recordOrderBusinessClosure } from './business-closure';
import { ArchiveJobExecutionError, runArchiveBundleJob } from './archive-pipeline';
import { createGoogleDriveArchiveClient, createStaticAccessTokenProvider } from './drive-http-client';
import { runArchiveSelectorScan } from './selector';
import { bundleEligibilityAt } from './time';

/**
 * Stage 6.5 integration: the production Google Drive HTTP adapter drives the
 * REAL archive pipeline end to end against the local fake Drive wire server
 * and the mock R2 storage. Proves the port is genuinely wired (no
 * "not implemented" branch left), that hash/size/MIME verification failures
 * forbid hot-file deletion, and that a disabled upload switch makes zero
 * HTTP requests.
 */

const TOKEN = 'integration-drive-token';
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7, 6, 5, 4, 3, 2]);

let database: SqliteDatabase | null = null;
afterEach(() => { database?.close(); database = null; });

interface SeededOrder {
  orderId: string;
  eligibilityAt: number;
  orderFileKey: string;
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
    objectKey: orderFile.objectKey, bytes: png, contentType: 'image/png', metadata: {},
  });
  const settled = await settleColdArchivePrincipal(db, {
    suffix,
    formalOrderId: order.formalOrderId,
    sellerOrganizationId: order.sellerOrganizationId,
    proofBytes: jpg,
  });
  await r2.putObject({
    objectKey: settled.objectKey, bytes: jpg, contentType: 'image/png', metadata: {},
  });
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
    const fillerSha = await sha256Hex(filler);
    await r2.putObject({ objectKey: row.object_key, bytes: filler, contentType: 'image/png', metadata: {} });
    await db.prepare('UPDATE file_objects SET uploaded_sha256=? WHERE id=?').bind(fillerSha, row.file_id).run();
  }
  const closure = await recordOrderBusinessClosure(db, {
    formalOrderId: order.formalOrderId,
    expectedVersion: 0,
    notApplicable: ['review', 'buyer_refund', 'seller_service_fee'],
    reason: 'stage 6.5 drive http integration closure',
  }, {
    actor: coldArchiveOwner,
    idempotencyKey: `stage65-close-${suffix}`,
    now: settled.completedAt + 1,
  });
  return {
    orderId: order.formalOrderId,
    eligibilityAt: bundleEligibilityAt(closure.business_closed_at),
    orderFileKey: orderFile.objectKey,
    proofFileKey: settled.objectKey,
  };
}

async function materializeBundle(db: SqliteDatabase, seeded: SeededOrder): Promise<string> {
  await runArchiveSelectorScan(db, {
    now: seeded.eligibilityAt,
    state: { orderCursor: null, refundCursor: null, settlementCursor: null },
  });
  const bundle = await db.prepare(
    `SELECT id FROM archive_bundles WHERE bundle_type='ORDER' AND ref_id=? AND is_current=1`,
  ).bind(seeded.orderId).first<{ id: string }>();
  if (!bundle) throw new Error('bundle_not_created');
  return bundle.id;
}

/** Runs the job for EVERY bundle of the order (ORDER + settlement payment). */
async function runAllBundlesForOrder(
  db: SqliteDatabase,
  seeded: SeededOrder,
  deps: { storage: MockObjectStorage; drive: ReturnType<typeof createGoogleDriveArchiveClient> },
  controls: { driveUploadEnabled: boolean; hotDeleteEnabled: boolean; shadowCopyOnly: boolean },
): Promise<void> {
  const bundles = await db.prepare(
    'SELECT id FROM archive_bundles WHERE formal_order_id=? AND is_current=1',
  ).bind(seeded.orderId).all<{ id: string }>();
  for (const bundle of bundles.results) {
    await runArchiveBundleJob(db, { bundleId: bundle.id, now: seeded.eligibilityAt + 5 }, deps, controls);
  }
}

describe('stage 6.5 production drive http adapter against the real pipeline', () => {
  it('archives a bundle end to end over the resumable protocol and deletes hot copies only after verification', async () => {
    database = createMigratedTestDatabase();
    const r2 = new MockObjectStorage();
    const server = createFakeDriveHttpServer({ accessToken: TOKEN });
    const drive = createGoogleDriveArchiveClient({
      folderId: 'integration-folder-1',
      tokenProvider: createStaticAccessTokenProvider(TOKEN),
      fetchImpl: server.fetch,
      requestTimeoutMs: 5_000,
    });
    const seeded = await seedClosedOrder(database, r2, 'full');
    const bundleId = await materializeBundle(database, seeded);
    await runAllBundlesForOrder(database, seeded, { storage: r2, drive },
      { driveUploadEnabled: true, hotDeleteEnabled: true, shadowCopyOnly: false });
    const bundle = await database.prepare(
      'SELECT state,zip_sha256,zip_byte_size,drive_file_id,drive_verified_at,archived_at FROM archive_bundles WHERE id=?',
    ).bind(bundleId).first<{
      state: string; zip_sha256: string; zip_byte_size: number;
      drive_file_id: string; drive_verified_at: number; archived_at: number;
    }>();
    expect(bundle!.state).toBe('ARCHIVED');
    expect(bundle!.drive_verified_at).not.toBeNull();
    expect(bundle!.archived_at).not.toBeNull();
    // The bytes on the "Drive" side hash exactly to the recorded zip digest.
    const uploaded = server.uploadedBytes(bundle!.drive_file_id)!;
    expect(uploaded.byteLength).toBe(bundle!.zip_byte_size);
    expect(await sha256Hex(uploaded)).toBe(bundle!.zip_sha256);
    // Hot copies are gone only after the verified read-back.
    expect(await r2.headObject(seeded.orderFileKey)).toBeNull();
    expect(await r2.headObject(seeded.proofFileKey)).toBeNull();
    // The wire saw the documented request sequence — one resumable session
    // and one stored file PER bundle (ORDER + settlement payment).
    expect(server.callCount('session_create')).toBe(2);
    expect(server.callCount('metadata')).toBeGreaterThanOrEqual(2);
    expect(server.callCount('media')).toBe(2);
    expect(server.state.createdFileCount).toBe(2);
    // No error summary anywhere carries the session URI or token.
    const failures = await database.prepare(
      `SELECT error_summary FROM archive_jobs WHERE error_summary IS NOT NULL`,
    ).all<{ error_summary: string }>();
    for (const row of failures.results) {
      expect(row.error_summary).not.toContain(server.sessionUploadId);
      expect(row.error_summary).not.toContain(TOKEN);
    }
  });

  it('forbids hot-file deletion when the Drive read-back hash mismatches', async () => {
    database = createMigratedTestDatabase();
    const r2 = new MockObjectStorage();
    const server = createFakeDriveHttpServer({ accessToken: TOKEN, corruptMediaByte: true });
    const drive = createGoogleDriveArchiveClient({
      folderId: 'integration-folder-1',
      tokenProvider: createStaticAccessTokenProvider(TOKEN),
      fetchImpl: server.fetch,
      requestTimeoutMs: 5_000,
    });
    const seeded = await seedClosedOrder(database, r2, 'corrupt');
    const bundleId = await materializeBundle(database, seeded);
    const failure = await runArchiveBundleJob(
      database,
      { bundleId, now: seeded.eligibilityAt + 5 },
      { storage: r2, drive },
      { driveUploadEnabled: true, hotDeleteEnabled: true, shadowCopyOnly: false },
    ).then(() => null, (error: unknown) => error);
    expect(failure).toBeInstanceOf(ArchiveJobExecutionError);
    expect((failure as ArchiveJobExecutionError).category).toBe('drive_verification_failed');
    // Fail closed: verification never completed, so every hot copy stays.
    const bundle = await database.prepare(
      'SELECT state,drive_file_id,drive_verified_at,archived_at FROM archive_bundles WHERE id=?',
    ).bind(bundleId).first<{ state: string; drive_file_id: string; drive_verified_at: number | null; archived_at: number | null }>();
    expect(bundle!.state).toBe('ONLINE');
    expect(bundle!.drive_verified_at).toBeNull();
    expect(bundle!.archived_at).toBeNull();
    expect(await r2.headObject(seeded.orderFileKey)).not.toBeNull();
    expect(await r2.headObject(seeded.proofFileKey)).not.toBeNull();
    // The temp ZIP object remains for the retry (immutable re-upload source).
    expect(bundle!.drive_file_id).not.toBeNull();
  });

  it('makes zero HTTP requests while the upload switch is off', async () => {
    database = createMigratedTestDatabase();
    const r2 = new MockObjectStorage();
    const server = createFakeDriveHttpServer({ accessToken: TOKEN });
    const drive = createGoogleDriveArchiveClient({
      folderId: 'integration-folder-1',
      tokenProvider: createStaticAccessTokenProvider(TOKEN),
      fetchImpl: server.fetch,
      requestTimeoutMs: 5_000,
    });
    const seeded = await seedClosedOrder(database, r2, 'switched-off');
    const bundleId = await materializeBundle(database, seeded);
    // The pipeline runs manifest + zip phases but must stop before ANY Drive
    // call when driveUploadEnabled is false (retryable dependency gap).
    const failure = await runArchiveBundleJob(
      database,
      { bundleId, now: seeded.eligibilityAt + 5 },
      { storage: r2, drive },
      { driveUploadEnabled: false, hotDeleteEnabled: true, shadowCopyOnly: false },
    ).then(() => null, (error: unknown) => error);
    expect(failure).toBeInstanceOf(ArchiveJobExecutionError);
    expect((failure as ArchiveJobExecutionError).category).toBe('dependency_unavailable');
    expect((failure as ArchiveJobExecutionError).retryable).toBe(true);
    expect(server.callCount()).toBe(0);
    const bundle = await database.prepare(
      'SELECT state,zip_sha256,drive_file_id FROM archive_bundles WHERE id=?',
    ).bind(bundleId).first<{ state: string; zip_sha256: string; drive_file_id: string | null }>();
    expect(bundle!.zip_sha256).not.toBeNull();
    expect(bundle!.drive_file_id).toBeNull();
    expect(bundle!.state).toBe('ONLINE');
  });
});
