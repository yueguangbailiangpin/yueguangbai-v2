import { describe, expect, it } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import { MockObjectStorage } from '../files/mock-object-storage';
import { FakeDriveArchiveClient } from './fake-drive-client';
import { runArchiveBundleJob } from './archive-pipeline';
import { computeArchiveMetrics } from './metrics';
import { processArchiveQueueMessage, retryDelaySeconds } from './queue-consumer';
import { runArchiveSelectorScan, type SelectorScanState } from './selector';
import { sha256Hex } from '@ygb/domain';
import { recordOrderBusinessClosure } from './business-closure';
import {
  coldArchiveOwner,
  seedColdArchiveFile,
  seedConfirmedColdArchiveOrder,
  settleColdArchivePrincipal,
} from '../../test-support/cold-archive-fixture';

/**
 * Stage 5.7 capacity verification (D-054/5.7): 20,000 synthetic orders and
 * 100,000+ file manifest entries driven through the REAL selector, job and
 * manifest machinery against the real migration chain — only the byte
 * payloads are tiny. Proves: cursor pagination completes, bundles materialize
 * exactly once, job creation is deduped, one poisoned bundle cannot block the
 * rest, per-page work stays bounded (no O(N²)) and D1's 100-parameter-per-
 * statement limit is never approached (all inserts are single-row).
 */

const ORDER_COUNT = 20_000;
const FILES_PER_ORDER = 5;
const SCAN_PAGE = 200;
const FILLER = (() => {
  const bytes = new Uint8Array(new ArrayBuffer(16));
  for (let index = 0; index < bytes.byteLength; index += 1) bytes[index] = index;
  return bytes;
})();

async function seedCapacityDataset(db: SqliteDatabase, r2: MockObjectStorage): Promise<{ eligibleOrders: number; virtualNow: number }> {
  // One REAL confirmed+closed order via the production fixtures; every other
  // order is a row-clone of it (guards revalidate each cloned row), with
  // business_closed_at spread so ~97.5% are past the six-month gate.
  const base = await seedConfirmedColdArchiveOrder(db, 'cap-base');
  const baseFile = await seedColdArchiveFile(db, {
    suffix: 'cap-base-order',
    formalOrderId: base.formalOrderId,
    bytes: FILLER,
  });
  await r2.putObject({ objectKey: baseFile.objectKey, bytes: FILLER, contentType: 'image/png', metadata: {} });
  const settled = await settleColdArchivePrincipal(db, {
    suffix: 'cap-base',
    formalOrderId: base.formalOrderId,
    sellerOrganizationId: base.sellerOrganizationId,
    proofBytes: FILLER,
  });
  await r2.putObject({ objectKey: settled.objectKey, bytes: FILLER, contentType: 'image/png', metadata: {} });
  const closure = await recordOrderBusinessClosure(db, {
    formalOrderId: base.formalOrderId,
    expectedVersion: 0,
    notApplicable: ['review', 'buyer_refund', 'seller_service_fee'],
    reason: 'capacity base closure',
  }, { actor: coldArchiveOwner, idempotencyKey: 'cap-close-base', now: settled.completedAt + 1 });

  const closedAt = closure.business_closed_at;
  const fillerSha = await sha256Hex(FILLER);
  // Virtual clock 400 days after the real closure: every cloned closure keeps
  // business_closed_at >= the real completion facts (trigger requirement)
  // while still sitting past the six-month eligibility gate.
  const virtualNow = closedAt + 400 * 86_400_000;
  const recentClose = closedAt + 390 * 86_400_000;

  // Synthetic-row cloning bypasses the production write guards that tie a
  // formal order to its one-time reservation/evidence chain — this database
  // exists only to stress the archive selector/manifest machinery, so the
  // clone source guards are dropped for seeding (assertions below still run
  // against the full archive trigger set).
  db.exec(`
    DROP TRIGGER trg_formal_order_source_guard;
    DROP TRIGGER trg_formal_order_instruction_guard;
    DROP TRIGGER trg_formal_order_non_jp_local_date_required;
    DROP TRIGGER trg_reservation_self_pay_snapshot_insert_guard;
    DROP TRIGGER trg_order_evidence_submission_reservation_guard;
    DROP TRIGGER trg_order_evidence_version_submission_guard;
    DROP TRIGGER trg_order_evidence_instruction_snapshot_guard;
    DROP TRIGGER trg_order_evidence_duplicate_signal_after_version;
    DROP TRIGGER trg_order_evidence_marketplace_money_legacy_insert;
    DROP TRIGGER trg_file_objects_intent_guard;
    DROP TRIGGER trg_file_objects_verified_guard;
    DROP TRIGGER trg_file_entity_links_verified_guard;
  `);
  await db.exec('BEGIN');
  // Clone machinery: derive INSERT ... SELECT from the live table shape via
  // PRAGMA table_info so the verifier never guesses column names.
  const columnsOf = (table: string): string[] =>
    (db.raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[])
      .map((row) => row.name);
  const cloneStatement = (table: string, replacements: Record<string, string>, sourceWhere: string) => {
    const columns = columnsOf(table);
    const selectList = columns.map((column) => replacements[column] ?? column).join(', ');
    const columnList = columns.join(', ');
    return db.raw.prepare(
      `INSERT INTO ${table}(${columnList}) SELECT ${selectList} FROM ${table} WHERE ${sourceWhere}`,
    );
  };
  const orderInsert = cloneStatement('formal_orders', {
    id: '?',
    reservation_id: '?',
    order_evidence_submission_id: '?',
    order_evidence_version_id: '?',
  }, 'id=?');
  const closureInsert = cloneStatement('order_archive_closures', {
    formal_order_id: '?',
    // Synthetic orders carry no financial rows: every component is recorded
    // as NOT_APPLICABLE so the closure guard's NOT-EXISTS checks pass.
    review_state: "'NOT_APPLICABLE'",
    buyer_refund_state: "'NOT_APPLICABLE'",
    seller_principal_state: "'NOT_APPLICABLE'",
    seller_service_fee_state: "'NOT_APPLICABLE'",
    business_closed_at: '?',
    archive_due_at: '?',
    close_idempotency_key: "'cap-close-'||?",
    created_at: '?',
    updated_at: '?',
  }, 'formal_order_id=?');
  const subjectInsert = cloneStatement('customer_identity_subjects', { id: '?' }, 'id=?');
  const buyerInsert = cloneStatement('buyer_customers', {
    id: '?',
    identity_subject_id: '?',
    buyer_sequence: '1000000+?',
    buyer_customer_no: "'CAP-'||?",
  }, 'id=?');
  const reservationInsert = cloneStatement('product_reservations', {
    id: '?',
    buyer_customer_id: '?',
  }, 'id=?');
  const submissionInsert = cloneStatement('order_evidence_submissions', {
    id: '?',
    reservation_id: '?',
    buyer_customer_id: '?',
  }, 'id=?');
  const versionInsert = cloneStatement('order_evidence_versions', {
    id: '?',
    submission_id: '?',
    reservation_id: '?',
    buyer_customer_id: '?',
  }, 'id=?');
  const baseBuyer = await db.prepare(
    'SELECT buyer_customer_id FROM formal_orders WHERE id=?',
  ).bind(base.formalOrderId).first<{ buyer_customer_id: string }>();
  const baseSubject = await db.prepare(
    'SELECT identity_subject_id FROM buyer_customers WHERE id=?',
  ).bind(baseBuyer!.buyer_customer_id).first<{ identity_subject_id: string }>();
  const baseIntent = await db.prepare(
    'SELECT upload_intent_id FROM file_objects WHERE id=?',
  ).bind(baseFile.fileId).first<{ upload_intent_id: string }>();
  const intentInsert = cloneStatement('file_upload_intents', {
    id: '?',
    manifest_hash: "'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'",
  }, 'id=?');
  const fileInsert = cloneStatement('file_objects', {
    id: '?',
    upload_intent_id: '?',
    object_key: '?',
    uploaded_sha256: '?',
  }, 'id=?');
  const linkInsert = cloneStatement('file_entity_links', {
    id: '?',
    file_object_id: '?',
    entity_id: '?',
  }, "file_object_id=? AND entity_type='ORDER'");

  const baseReservation = await db.prepare(
    'SELECT reservation_id FROM formal_orders WHERE id=?',
  ).bind(base.formalOrderId).first<{ reservation_id: string }>();
  const baseSubmission = await db.prepare(
    'SELECT order_evidence_submission_id FROM formal_orders WHERE id=?',
  ).bind(base.formalOrderId).first<{ order_evidence_submission_id: string }>();
  const baseVersion = await db.prepare(
    'SELECT order_evidence_version_id FROM formal_orders WHERE id=?',
  ).bind(base.formalOrderId).first<{ order_evidence_version_id: string }>();
  for (let index = 1; index < ORDER_COUNT; index += 1) {
    const orderId = `cap-order-${index}`;
    const buyerId = `cap-buyer-${index}`;
    const reservationId = `cap-reservation-${index}`;
    const submissionId = `cap-submission-${index}`;
    const versionId = `cap-version-${index}`;
    // 97.5% deep-past (eligible), 2.5% very recent (must NOT become bundles).
    const closed = index % 40 === 0 ? recentClose : closedAt;
    const steps: [string, () => unknown][] = [
      ['subject', () => subjectInsert.run(`cap-subject-${index}`, baseSubject!.identity_subject_id)],
      ['buyer', () => buyerInsert.run(buyerId, `cap-subject-${index}`, index, String(index), baseBuyer!.buyer_customer_id)],
      ['reservation', () => reservationInsert.run(reservationId, buyerId, baseReservation!.reservation_id)],
      ['submission', () => submissionInsert.run(submissionId, reservationId, buyerId, baseSubmission!.order_evidence_submission_id)],
      ['version', () => versionInsert.run(versionId, submissionId, reservationId, buyerId, baseVersion!.order_evidence_version_id)],
      ['order', () => orderInsert.run(orderId, submissionId, versionId, reservationId, base.formalOrderId)],
      ['closure', () => closureInsert.run(orderId, closed, closed, String(index), closed, closed, base.formalOrderId)],
    ];
    for (const [label, step] of steps) {
      try {
        step();
      } catch (seedError) {
        throw new Error(`clone seed failed at ${label}#${index}: ${seedError instanceof Error ? seedError.message : seedError}`);
      }
    }
  }
  for (let index = 0; index < ORDER_COUNT; index += 1) {
    const orderId = index === 0 ? base.formalOrderId : `cap-order-${index}`;
    for (let fileIndex = 0; fileIndex < FILES_PER_ORDER; fileIndex += 1) {
      // The base order's real file keeps its original row; clones get 5 new.
      if (index === 0 && fileIndex === 0) continue;
      const fileId = `cap-file-${index}-${fileIndex}`;
      const objectKey = `files/v1/2026/08/order-evidence/capacity-${String(index).padStart(6, '0')}-${fileIndex}xxxxxxxxxxxxxxxx`;
      for (const [label, step] of [
        ['intent', () => intentInsert.run(`cap-intent-${index}-${fileIndex}`, baseIntent!.upload_intent_id)],
        ['file', () => fileInsert.run(fileId, `cap-intent-${index}-${fileIndex}`, objectKey, fillerSha, baseFile.fileId)],
        ['link', () => linkInsert.run(`cap-link-${index}-${fileIndex}`, fileId, orderId, baseFile.fileId)],
      ] as [string, () => unknown][]) {
        try {
          step();
        } catch (seedError) {
          throw new Error(`file clone failed at ${label}#${index}-${fileIndex}: ${seedError instanceof Error ? seedError.message : seedError}`);
        }
      }
      // Hot payloads are materialized lazily only for the sampled bundles.
    }
  }
  await db.exec('COMMIT');
  const eligible = await db.raw.prepare(
    `SELECT COUNT(*) AS count FROM order_archive_closures
     WHERE status='CLOSED' AND business_closed_at<=?`,
  ).get(virtualNow - 183 * 86_400_000);
  return {
    eligibleOrders: Number((eligible as { count: number }).count),
    virtualNow,
  };
}

describe('cold archive capacity (stage 5.7)', () => {
  it('materializes 20k orders / 100k files through the real selector without duplication', { timeout: 590_000 }, async () => {
    const startedAt = Date.now();
    const db = createMigratedTestDatabase();
    const r2 = new MockObjectStorage();
    const { eligibleOrders, virtualNow } = await seedCapacityDataset(db, r2);
    expect(eligibleOrders).toBeGreaterThan(ORDER_COUNT * 0.9);

    await db.prepare(
      `UPDATE archive_runtime_controls SET selector_enabled=1,drive_upload_enabled=1,version=version+1,updated_at=? WHERE singleton_id=1`,
    ).bind(Date.now()).run();

    // Paged scans until the cursor state is exhausted (resumable by design).
    let state: SelectorScanState = { orderCursor: null, refundCursor: null, settlementCursor: null };
    let scans = 0;
    let bundlesCreated = 0;
    let jobsCreated = 0;
    let firstPageMs = -1;
    let lastPageMs = -1;
    for (;;) {
      const pageStart = Date.now();
      const outcome = await runArchiveSelectorScan(db, { now: virtualNow, limit: SCAN_PAGE, state });
      const elapsed = Date.now() - pageStart;
      if (firstPageMs < 0) firstPageMs = elapsed;
      lastPageMs = elapsed;
      bundlesCreated += outcome.bundlesCreated;
      jobsCreated += outcome.jobsCreated;
      state = outcome.state;
      scans += 1;
      const done = state.orderCursor === null && state.refundCursor === null && state.settlementCursor === null;
      if (done || scans > 400) break;
    }
    expect(scans).toBeLessThanOrEqual(400);

    // A full second sweep must create nothing new: idempotent materialization.
    let secondCreated = 0;
    let sweepState: SelectorScanState = { orderCursor: null, refundCursor: null, settlementCursor: null };
    for (;;) {
      const outcome = await runArchiveSelectorScan(db, { now: virtualNow, limit: SCAN_PAGE, state: sweepState });
      secondCreated += outcome.bundlesCreated;
      sweepState = outcome.state;
      if (sweepState.orderCursor === null && sweepState.refundCursor === null && sweepState.settlementCursor === null) break;
    }
    expect(secondCreated).toBe(0);

    const bundleCount = await db.raw.prepare(
      `SELECT COUNT(*) AS count, COUNT(DISTINCT id) AS distinct_ids FROM archive_bundles`,
    ).get() as { count: number; distinct_ids: number };
    const jobCount = await db.raw.prepare(
      `SELECT COUNT(*) AS count, COUNT(DISTINCT dedupe_key) AS distinct_keys FROM archive_jobs`,
    ).get() as { count: number; distinct_keys: number };
    // ORDER bundles for eligible orders (+ the base) plus one settlement
    // bundle for the base order's payment.
    expect(bundleCount.count).toBe(bundlesCreated);
    expect(bundleCount.count).toBe(bundleCount.distinct_ids);
    expect(jobCount.count).toBe(jobCount.distinct_keys);
    expect(jobCount.count).toBe(bundleCount.count);
    // 2.5% of clones close too recently to be eligible; the rest all land.
    expect(bundleCount.count).toBeGreaterThanOrEqual(Math.floor(ORDER_COUNT * 0.95));

    const metrics = await computeArchiveMetrics(db, { now: virtualNow });
    expect(metrics.eligible_backlog_bundles).toBe(bundleCount.count);
    expect(metrics.jobs_pending).toBe(bundleCount.count);

    // Manifest capacity: seal + stream a sample through the REAL pipeline
    // (fake Drive, mock R2) — 5 files per bundle, hot bytes materialized for
    // the sample only (the other ~100k files stay metadata-only).
    const sample = await db.prepare(
      `SELECT id FROM archive_bundles WHERE bundle_type='ORDER' AND is_current=1 ORDER BY id LIMIT 7`,
    ).all<{ id: string }>();
    const drive = new FakeDriveArchiveClient();
    const materialize = async (bundleId: string): Promise<void> => {
      // Sealing has not run yet for these bundles, so take the object keys
      // from the live file facts the seal will snapshot.
      const files = await db.prepare(
        `SELECT fo.object_key FROM file_entity_links l
         JOIN file_objects fo ON fo.id=l.file_object_id
         JOIN archive_bundles b ON b.id=?
         WHERE l.revoked_at IS NULL AND l.entity_type='ORDER' AND l.entity_id=b.ref_id
           AND fo.status='VERIFIED'`,
      ).bind(bundleId).all<{ object_key: string }>();
      for (const file of files.results) {
        if (await r2.headObject(file.object_key)) continue;
        await r2.putObject({ objectKey: file.object_key, bytes: FILLER, contentType: 'image/png', metadata: {} });
      }
    };
    for (const row of sample.results.slice(0, 5)) {
      await materialize(row.id);
      const outcome = await runArchiveBundleJob(db, { bundleId: row.id, now: virtualNow }, { storage: r2, drive },
        { driveUploadEnabled: true, hotDeleteEnabled: false, shadowCopyOnly: true });
      expect(outcome.outcome).toBe('SHADOW_COMPLETED');
      const sealed = await db.prepare('SELECT manifest_file_count,manifest_total_bytes FROM archive_bundles WHERE id=?')
        .bind(row.id).first<{ manifest_file_count: number; manifest_total_bytes: number }>();
      expect(sealed!.manifest_file_count).toBe(FILES_PER_ORDER);
      expect(sealed!.manifest_total_bytes).toBe(FILES_PER_ORDER * FILLER.byteLength);
    }

    // Poison isolation: one integrity-broken bundle dead-letters while its
    // neighbor succeeds through the queue path in the same run.
    const poisonId = sample.results[5]!.id;
    const neighborId = sample.results[6]!.id;
    await materialize(neighborId);
    const poisonJob = await db.prepare('SELECT trace_id FROM archive_jobs WHERE bundle_id=?').bind(poisonId).first<{ trace_id: string }>();
    const poisonDisposition = await processArchiveQueueMessage(
      db,
      { bundle_id: poisonId, bundle_version: 1, job_type: 'ARCHIVE_BUNDLE', trace_id: poisonJob!.trace_id },
      { now: virtualNow },
      { storage: r2, drive },
      { driveUploadEnabled: true, hotDeleteEnabled: false, shadowCopyOnly: true, restoreWorkerEnabled: true },
    );
    expect(poisonDisposition.action).toBe('DEAD_LETTER_ACK');
    const neighborJob = await db.prepare('SELECT trace_id FROM archive_jobs WHERE bundle_id=?').bind(neighborId).first<{ trace_id: string }>();
    const neighborDisposition = await processArchiveQueueMessage(
      db,
      { bundle_id: neighborId, bundle_version: 1, job_type: 'ARCHIVE_BUNDLE', trace_id: neighborJob!.trace_id },
      { now: virtualNow },
      { storage: r2, drive },
      { driveUploadEnabled: true, hotDeleteEnabled: false, shadowCopyOnly: true, restoreWorkerEnabled: true },
    );
    expect(neighborDisposition.action).toBe('ACK');
    const neighborState = await db.prepare('SELECT state FROM archive_bundles WHERE id=?').bind(neighborId).first<{ state: string }>();
    expect(neighborState!.state).toBe('ONLINE');

    // Bounded per-page work: the last page must not be dramatically slower
    // than the first (a >15x drift would smell like an O(N²) join).
    expect(lastPageMs).toBeLessThan(Math.max(firstPageMs * 15, 2500));

    // Exponential backoff sanity for queue retries at this scale.
    expect(retryDelaySeconds(1)).toBeGreaterThanOrEqual(60);
    expect(retryDelaySeconds(9)).toBeLessThanOrEqual(3600 + 30);

    const summary = {
      orders: ORDER_COUNT,
      bundles: bundleCount.count,
      jobs: jobCount.count,
      scans,
      first_page_ms: firstPageMs,
      last_page_ms: lastPageMs,
      total_ms: Date.now() - startedAt,
      eligible_backlog_files: metrics.eligible_backlog_files,
    };
    console.log('[archive-capacity]', JSON.stringify(summary));
    db.close();
  });
});
