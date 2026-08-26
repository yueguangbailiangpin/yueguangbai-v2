import type { SqlDatabase } from '@ygb/contracts';
import { bundleEligibilityAt } from './time';

/**
 * Archive selector (D-055): the scheduled scanner only DISCOVERS due archive
 * units, materializes bundle rows and creates deduped jobs. All heavy work
 * (manifest sealing, ZIP, Drive, deletes) belongs to the queue consumer.
 *
 * Eligibility fails closed on every axis: the unit's own closing facts must be
 * complete (refund PAID, settlement fully evented), the parent formal order
 * must have a CLOSED business closure, and eligibility is six UTC calendar
 * months after the LATEST of those closing times — never a flat 180 days.
 */

export type ArchiveBundleTypeName = 'ORDER' | 'BUYER_REFUND_PAYMENT' | 'SELLER_SETTLEMENT_PAYMENT';

export interface SelectorUnit {
  bundle_type: ArchiveBundleTypeName;
  ref_id: string;
  formal_order_id: string;
  last_closed_at: number;
}

export interface SelectorScanState {
  orderCursor: string | null;
  refundCursor: string | null;
  settlementCursor: string | null;
}

export interface SelectorScanOutcome {
  state: SelectorScanState;
  unitsExamined: number;
  bundlesCreated: number;
  jobsCreated: number;
  bundlesSuperseded: number;
  skippedRestoreActive: number;
  skippedNoFiles: number;
  candidatesRemaining: number;
}

export function parseSelectorScanState(value: string | null | undefined): SelectorScanState | null {
  if (!value) return { orderCursor: null, refundCursor: null, settlementCursor: null };
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (Object.keys(parsed).length !== 3) return null;
    return {
      orderCursor: typeof parsed['orderCursor'] === 'string' ? parsed['orderCursor'] : null,
      refundCursor: typeof parsed['refundCursor'] === 'string' ? parsed['refundCursor'] : null,
      settlementCursor: typeof parsed['settlementCursor'] === 'string' ? parsed['settlementCursor'] : null,
    };
  } catch {
    return null;
  }
}

export function serializeSelectorScanState(state: SelectorScanState): string {
  return JSON.stringify({
    orderCursor: state.orderCursor,
    refundCursor: state.refundCursor,
    settlementCursor: state.settlementCursor,
  });
}

interface CandidatePage {
  rows: SelectorUnit[];
  nextCursor: string | null;
}

async function scanOrderUnits(
  database: SqlDatabase,
  input: { now: number; limit: number; cursor: string | null },
): Promise<CandidatePage> {
  const rows = await database
    .prepare(
      `SELECT closure.formal_order_id,closure.business_closed_at
     FROM order_archive_closures closure
     JOIN formal_orders formal_order ON formal_order.id=closure.formal_order_id
       AND formal_order.status='CONFIRMED'
     WHERE closure.status='CLOSED'
       AND closure.formal_order_id>COALESCE(?, '')
     ORDER BY closure.formal_order_id
     LIMIT ?`,
    )
    .bind(input.cursor ?? '', input.limit + 1)
    .all<{ formal_order_id: string; business_closed_at: number }>();
  return finishPage(rows.results, input.limit, (row) => ({
    bundle_type: 'ORDER' as const,
    ref_id: row.formal_order_id,
    formal_order_id: row.formal_order_id,
    last_closed_at: row.business_closed_at,
  }), (row) => row.formal_order_id, input.now);
}

async function scanRefundUnits(
  database: SqlDatabase,
  input: { now: number; limit: number; cursor: string | null },
): Promise<CandidatePage> {
  const rows = await database
    .prepare(
      `SELECT obligation.id AS ref_id,obligation.formal_order_id,
       MAX(entry.created_at,closure.business_closed_at) AS last_closed_at
     FROM buyer_refund_obligations obligation
     JOIN buyer_refund_ledger_balances balance
       ON balance.obligation_id=obligation.id AND balance.status='PAID'
     JOIN order_archive_closures closure
       ON closure.formal_order_id=obligation.formal_order_id AND closure.status='CLOSED'
     JOIN buyer_refund_payment_entries entry ON entry.obligation_id=obligation.id
     WHERE obligation.id>COALESCE(?, '')
     GROUP BY obligation.id
     ORDER BY obligation.id
     LIMIT ?`,
    )
    .bind(input.cursor ?? '', input.limit + 1)
    .all<{ ref_id: string; formal_order_id: string; last_closed_at: number }>();
  return finishPage(rows.results, input.limit, (row) => ({
    bundle_type: 'BUYER_REFUND_PAYMENT' as const,
    ref_id: row.ref_id,
    formal_order_id: row.formal_order_id,
    last_closed_at: Number(row.last_closed_at),
  }), (row) => row.ref_id, input.now);
}

async function scanSettlementUnits(
  database: SqlDatabase,
  input: { now: number; limit: number; cursor: string | null },
): Promise<CandidatePage> {
  const rows = await database
    .prepare(
      `SELECT payment.id AS ref_id,
       MIN(payable.formal_order_id) AS formal_order_id,
       MAX(
         payment.paid_at,
         closure.business_closed_at,
         (SELECT COALESCE(MAX(allocation.allocated_at),0) FROM seller_payment_allocations allocation
           WHERE allocation.payment_id=payment.id),
         (SELECT COALESCE(MAX(reversal.reversed_at),0) FROM seller_payment_allocation_reversals reversal
           WHERE reversal.payment_id=payment.id),
         (SELECT COALESCE(MAX(payment_reversal.reversed_at),0) FROM seller_payment_reversals payment_reversal
           WHERE payment_reversal.payment_id=payment.id)
       ) AS last_closed_at
     FROM seller_payments payment
     JOIN seller_payment_allocations allocation ON allocation.payment_id=payment.id
     JOIN seller_payables payable ON payable.id=allocation.payable_id
     JOIN order_archive_closures closure ON closure.formal_order_id=payable.formal_order_id
       AND closure.status='CLOSED'
     WHERE payment.id>COALESCE(?, '')
     GROUP BY payment.id
     ORDER BY payment.id
     LIMIT ?`,
    )
    .bind(input.cursor ?? '', input.limit + 1)
    .all<{ ref_id: string; formal_order_id: string; last_closed_at: number }>();
  return finishPage(rows.results, input.limit, (row) => ({
    bundle_type: 'SELLER_SETTLEMENT_PAYMENT' as const,
    ref_id: row.ref_id,
    formal_order_id: row.formal_order_id,
    last_closed_at: Number(row.last_closed_at),
  }), (row) => row.ref_id, input.now);
}

function finishPage<T>(
  rows: readonly T[],
  limit: number,
  map: (row: T) => SelectorUnit,
  cursorOf: (row: T) => string,
  now: number,
): CandidatePage {
  const page = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  return {
    rows: page
      .map(map)
      .filter((unit) => Number.isSafeInteger(unit.last_closed_at)
        && unit.last_closed_at > 0
        && bundleEligibilityAt(unit.last_closed_at) <= now),
    nextCursor: hasMore && page.length > 0 ? cursorOf(page[page.length - 1]!) : null,
  };
}

export interface UnitFileFact {
  file_object_id: string;
  purpose: string;
  visibility: string;
  detected_mime: string;
  uploaded_byte_size: number;
  uploaded_sha256: string;
  source_version: number;
  entity_type: string;
  entity_id: string;
  source_created_at: number;
}

export async function fetchUnitFileFacts(
  database: SqlDatabase,
  unit: SelectorUnit,
): Promise<UnitFileFact[]> {
  // Drive every branch from the (entity_type, entity_id) index on
  // file_entity_links: an OR-of-membership filter would let the planner scan
  // file_objects by status instead (O(all files) per unit at 100k scale).
  const objectFilter = `object.status='VERIFIED' AND intent.status='VERIFIED'
       AND object.detected_mime IS NOT NULL
       AND object.uploaded_byte_size IS NOT NULL
       AND object.uploaded_sha256 IS NOT NULL`;
  const baseJoin = `FROM file_entity_links link
     JOIN file_objects object ON object.id=link.file_object_id
     JOIN file_upload_intents intent ON intent.id=object.upload_intent_id
     WHERE link.revoked_at IS NULL AND ${objectFilter}`;
  const projection = `object.id AS file_object_id,object.purpose,object.visibility,object.detected_mime,
       object.uploaded_byte_size,object.uploaded_sha256,object.version AS source_version,
       link.entity_type,link.entity_id,object.created_at AS source_created_at`;
  let sql = '';
  const binds: unknown[] = [];
  if (unit.bundle_type === 'ORDER') {
    // D-056 §4.1: ORDER entity links carry the payment screenshot
    // (ORDER_EVIDENCE, linked at the evidence version) and the unified
    // communication screenshots (ORDER_COMMUNICATION_SCREENSHOT, linked at
    // the formal order — replacing the retired internal-files slot=1 and
    // buyer-chat paths).
    const evidenceVersionId = await database
      .prepare('SELECT order_evidence_version_id FROM formal_orders WHERE id=?')
      .bind(unit.formal_order_id)
      .first<{ order_evidence_version_id: string | null }>();
    sql = `SELECT ${projection} ${baseJoin}
       AND link.entity_type='ORDER' AND link.entity_id IN (?,?)
      UNION ALL
      SELECT ${projection} ${baseJoin}
       AND link.entity_type='REVIEW' AND link.entity_id IN (
         SELECT review.id FROM review_cases review WHERE review.formal_order_id=?)
      GROUP BY object.id
      ORDER BY object.created_at,object.id`;
    binds.push(
      unit.formal_order_id,
      evidenceVersionId?.order_evidence_version_id ?? unit.formal_order_id,
      unit.formal_order_id,
    );
  } else if (unit.bundle_type === 'BUYER_REFUND_PAYMENT') {
    sql = `SELECT ${projection} ${baseJoin}
       AND link.entity_type='BUYER_REFUND' AND link.entity_id=?
      GROUP BY object.id
      ORDER BY object.created_at,object.id`;
    binds.push(unit.ref_id);
  } else {
    sql = `SELECT ${projection} ${baseJoin}
       AND link.entity_type='SELLER_SETTLEMENT' AND link.entity_id=?
      GROUP BY object.id
      ORDER BY object.created_at,object.id`;
    binds.push(unit.ref_id);
  }
  const rows = await database.prepare(sql).bind(...binds).all<UnitFileFact>();
  return rows.results;
}

interface CurrentBundleRow {
  id: string;
  bundle_version: number;
  state: 'ONLINE' | 'ARCHIVED' | 'RESTORE_REQUESTED' | 'RESTORING' | 'RESTORED_TEMPORARILY' | 'RESTORE_FAILED';
  shadow_completed_at: number | null;
  sealed_at: number | null;
}

export interface SelectorDecision {
  action: 'SKIP_RESTORE_ACTIVE' | 'SKIP_NO_FILES' | 'SKIP_UP_TO_DATE' | 'SKIP_JOB_ACTIVE'
    | 'SKIP_JOB_DEAD' | 'CREATE_BUNDLE' | 'SUPERSEDE_AND_CREATE';
  bundleId?: string;
  bundleVersion?: number;
  supersededVersion?: number;
}

export async function decideUnit(
  database: SqlDatabase,
  unit: SelectorUnit,
): Promise<SelectorDecision> {
  const facts = await fetchUnitFileFacts(database, unit);
  const current = await database
    .prepare(
      `SELECT id,bundle_version,state,shadow_completed_at,sealed_at
     FROM archive_bundles WHERE bundle_type=? AND ref_id=? AND is_current=1`,
    )
    .bind(unit.bundle_type, unit.ref_id)
    .first<CurrentBundleRow>();
  if (!current) {
    if (facts.length === 0) return { action: 'SKIP_NO_FILES' };
    return { action: 'CREATE_BUNDLE' };
  }
  if (current.state !== 'ONLINE' && current.state !== 'ARCHIVED') {
    return { action: 'SKIP_RESTORE_ACTIVE', bundleId: current.id, bundleVersion: current.bundle_version };
  }
  // Files whose hot copies are already gone (archived by any version of this
  // unit) are excluded from new versions; a fresh fact outside that covered
  // set means new evidence arrived and a new bundle version is required.
  const coveredRows = facts.length === 0
    ? { results: [] as { file_object_id: string }[] }
    : await database
      .prepare(
        `SELECT DISTINCT covered_files.file_object_id
       FROM archive_bundle_files covered_files
       JOIN archive_bundles covered_bundle ON covered_bundle.id=covered_files.bundle_id
       WHERE covered_bundle.bundle_type=? AND covered_bundle.ref_id=?
         AND covered_files.delete_state='DELETED'`,
      )
      .bind(unit.bundle_type, unit.ref_id)
      .all<{ file_object_id: string }>();
  const covered = new Set(coveredRows.results.map((row) => row.file_object_id));
  const pendingCount = facts.filter((fact) => !covered.has(fact.file_object_id)).length;
  if (current.state === 'ARCHIVED') {
    if (pendingCount <= 0) return { action: 'SKIP_UP_TO_DATE', bundleId: current.id, bundleVersion: current.bundle_version };
    return { action: 'SUPERSEDE_AND_CREATE', bundleId: current.id, bundleVersion: current.bundle_version };
  }
  // ONLINE: a shadow-completed bundle whose facts changed needs a new version;
  // an active or failed job is owned by the queue.
  const job = await database
    .prepare(`SELECT state FROM archive_jobs WHERE dedupe_key=?`)
    .bind(archiveJobDedupeKey(current.id, current.bundle_version))
    .first<{ state: string }>();
  if (current.shadow_completed_at === null || !current.sealed_at) {
    if (!job) return { action: 'CREATE_BUNDLE', bundleId: current.id, bundleVersion: current.bundle_version };
    if (job.state === 'SUCCEEDED') return { action: 'SKIP_UP_TO_DATE', bundleId: current.id, bundleVersion: current.bundle_version };
    if (job.state === 'DEAD_LETTERED' || job.state === 'CANCELLED') {
      return { action: 'SKIP_JOB_DEAD', bundleId: current.id, bundleVersion: current.bundle_version };
    }
    return { action: 'SKIP_JOB_ACTIVE', bundleId: current.id, bundleVersion: current.bundle_version };
  }
  const sealedCount = await database
    .prepare(`SELECT COUNT(*) AS sealed_count FROM archive_bundle_files WHERE bundle_id=?`)
    .bind(current.id)
    .first<{ sealed_count: number }>();
  if (pendingCount === 0 && Number(sealedCount?.sealed_count ?? 0) === facts.length) {
    return { action: 'SKIP_UP_TO_DATE', bundleId: current.id, bundleVersion: current.bundle_version };
  }
  return { action: 'SUPERSEDE_AND_CREATE', bundleId: current.id, bundleVersion: current.bundle_version };
}

export function archiveJobDedupeKey(bundleId: string, bundleVersion: number): string {
  return `ARCHIVE_BUNDLE:${bundleId}:${bundleVersion}`;
}

export function restoreJobDedupeKey(bundleId: string, bundleVersion: number): string {
  return `RESTORE_BUNDLE:${bundleId}:${bundleVersion}`;
}

export function cleanupJobDedupeKey(restoreId: string): string {
  return `CLEANUP_EXPIRED_RESTORE:${restoreId}`;
}

export function newBundleRowId(): string {
  return `archive-bundle-${crypto.randomUUID()}`;
}

export function newJobRowId(): string {
  return `archive-job-${crypto.randomUUID()}`;
}

/**
 * One selector pass over a page of each unit family. Purely D1-bound: no
 * storage or Drive access. Returns the resumable cursor state so the next
 * scheduled tick continues where this one stopped.
 */
export async function runArchiveSelectorScan(
  database: SqlDatabase,
  input: { now: number; limit?: number; state: SelectorScanState },
): Promise<SelectorScanOutcome> {
  const limit = Number.isSafeInteger(input.limit) && Number(input.limit)! > 0
    && Number(input.limit)! <= 500 ? Number(input.limit) : 200;
  const outcome: SelectorScanOutcome = {
    state: input.state,
    unitsExamined: 0,
    bundlesCreated: 0,
    jobsCreated: 0,
    bundlesSuperseded: 0,
    skippedRestoreActive: 0,
    skippedNoFiles: 0,
    candidatesRemaining: 0,
  };
  const scanners = [
    { cursor: input.state.orderCursor, run: scanOrderUnits },
    { cursor: input.state.refundCursor, run: scanRefundUnits },
    { cursor: input.state.settlementCursor, run: scanSettlementUnits },
  ] as const;
  const nextCursors: string[] = ['', '', ''];
  let scannerIndex = 0;
  for (const scanner of scanners) {
    const page = await scanner.run(database, { now: input.now, limit, cursor: scanner.cursor });
    nextCursors[scannerIndex] = page.nextCursor ?? '';
    scannerIndex += 1;
    for (const unit of page.rows) {
      outcome.unitsExamined += 1;
      await materializeUnit(database, unit, input.now, outcome);
    }
  }
  outcome.state = {
    orderCursor: nextCursors[0] === '' ? null : nextCursors[0]!,
    refundCursor: nextCursors[1] === '' ? null : nextCursors[1]!,
    settlementCursor: nextCursors[2] === '' ? null : nextCursors[2]!,
  };
  return outcome;
}

async function materializeUnit(
  database: SqlDatabase,
  unit: SelectorUnit,
  now: number,
  outcome: SelectorScanOutcome,
): Promise<void> {
  const decision = await decideUnit(database, unit);
  switch (decision.action) {
    case 'SKIP_NO_FILES':
      outcome.skippedNoFiles += 1;
      return;
    case 'SKIP_RESTORE_ACTIVE':
      outcome.skippedRestoreActive += 1;
      return;
    case 'SKIP_UP_TO_DATE':
    case 'SKIP_JOB_ACTIVE':
    case 'SKIP_JOB_DEAD':
      return;
    case 'CREATE_BUNDLE': {
      const existing = decision.bundleId
        ? { id: decision.bundleId, version: decision.bundleVersion! }
        : await insertBundleRow(database, unit, now);
      if (!existing) return;
      outcome.bundlesCreated += decision.bundleId ? 0 : 1;
      await ensureArchiveJob(database, existing.id, existing.version, now, outcome);
      return;
    }
    case 'SUPERSEDE_AND_CREATE': {
      const superseded = await supersedeCurrentBundle(database, unit, decision.bundleId!, decision.bundleVersion!, now);
      if (!superseded) return;
      outcome.bundlesSuperseded += 1;
      outcome.bundlesCreated += 1;
      await ensureArchiveJob(database, superseded.id, superseded.version, now, outcome);
      return;
    }
  }
}

async function insertBundleRow(
  database: SqlDatabase,
  unit: SelectorUnit,
  now: number,
): Promise<{ id: string; version: number } | null> {
  const id = newBundleRowId();
  const inserted = await database
    .prepare(
      `INSERT INTO archive_bundles(id,bundle_type,ref_id,formal_order_id,bundle_version,is_current,
     state,eligibility_at,created_at,updated_at)
     VALUES(?,?,?,?,?,1,'ONLINE',?,?,?)
     ON CONFLICT(bundle_type,ref_id,bundle_version) DO NOTHING`,
    )
    .bind(
      id,
      unit.bundle_type,
      unit.ref_id,
      unit.formal_order_id,
      1,
      bundleEligibilityAt(unit.last_closed_at),
      now,
      now,
    )
    .run();
  if (inserted.meta.changes === 0) return null;
  await insertBundleEvent(database, id, 'BUNDLE_CREATED', 1, now, {
    bundle_type: unit.bundle_type,
    formal_order_id: unit.formal_order_id,
  });
  return { id, version: 1 };
}

async function supersedeCurrentBundle(
  database: SqlDatabase,
  unit: SelectorUnit,
  currentId: string,
  currentVersion: number,
  now: number,
): Promise<{ id: string; version: number } | null> {
  const newId = newBundleRowId();
  const newVersion = currentVersion + 1;
  try {
    await database.batch([
      database
        .prepare(
          `UPDATE archive_bundles SET is_current=0,superseded_by_version=?,version=version+1,
         updated_at=MAX(?,updated_at+1)
         WHERE id=? AND is_current=1 AND state IN ('ONLINE','ARCHIVED') AND version>=1`,
        )
        .bind(newVersion, now, currentId),
      database
        .prepare(
          `INSERT INTO archive_bundles(id,bundle_type,ref_id,formal_order_id,bundle_version,is_current,
         state,eligibility_at,created_at,updated_at)
         VALUES(?,?,?,?,?,1,'ONLINE',?,?,?)`,
        )
        .bind(
          newId,
          unit.bundle_type,
          unit.ref_id,
          unit.formal_order_id,
          newVersion,
          bundleEligibilityAt(unit.last_closed_at),
          now,
          now,
        ),
      database
        .prepare(
          `INSERT INTO transaction_assertions(assertion_value) SELECT CASE WHEN
         (SELECT is_current FROM archive_bundles WHERE id=?)=0
         AND (SELECT is_current FROM archive_bundles WHERE id=?)=1 THEN 1 ELSE 0 END`,
        )
        .bind(currentId, newId),
      insertBundleEventStatement(database, currentId, 'SUPERSEDED', currentVersion, now, {
        superseded_by_version: newVersion,
      }),
      insertBundleEventStatement(database, newId, 'BUNDLE_CREATED', newVersion, now, {
        bundle_type: unit.bundle_type,
        reason: 'facts_changed',
      }),
    ]);
  } catch {
    return null;
  }
  return { id: newId, version: newVersion };
}

async function ensureArchiveJob(
  database: SqlDatabase,
  bundleId: string,
  bundleVersion: number,
  now: number,
  outcome: SelectorScanOutcome,
): Promise<void> {
  const traceId = `trace-${crypto.randomUUID()}`;
  const inserted = await database
    .prepare(
      `INSERT INTO archive_jobs(id,dedupe_key,job_type,bundle_id,bundle_version,state,
     attempt_count,max_attempts,trace_id,created_at,updated_at)
     VALUES(?,?, 'ARCHIVE_BUNDLE', ?,?, 'PENDING', 0, 8, ?, ?, ?)
     ON CONFLICT(dedupe_key) DO NOTHING`,
    )
    .bind(newJobRowId(), archiveJobDedupeKey(bundleId, bundleVersion), bundleId, bundleVersion, traceId, now, now)
    .run();
  if (inserted.meta.changes === 1) outcome.jobsCreated += 1;
}

export async function insertBundleEvent(
  database: SqlDatabase,
  bundleId: string,
  eventType: string,
  bundleVersion: number,
  now: number,
  metadata: Record<string, unknown>,
): Promise<void> {
  await database
    .prepare(insertBundleEventStatementSql())
    .bind(
      `archive-event-${crypto.randomUUID()}`,
      bundleId,
      eventType,
      bundleVersion,
      JSON.stringify(metadata),
      now,
    )
    .run();
}

export function insertBundleEventStatement(
  database: SqlDatabase,
  bundleId: string,
  eventType: string,
  bundleVersion: number,
  now: number,
  metadata: Record<string, unknown>,
) {
  return database
    .prepare(insertBundleEventStatementSql())
    .bind(
      `archive-event-${crypto.randomUUID()}`,
      bundleId,
      eventType,
      bundleVersion,
      JSON.stringify(metadata),
      now,
    );
}

function insertBundleEventStatementSql(): string {
  return `INSERT INTO archive_bundle_events(id,bundle_id,event_type,bundle_version,phase,
    previous_state,next_state,failure_category,metadata_json,created_at)
    VALUES(?,?,?,?,NULL,NULL,NULL,NULL,?,?)`;
}
