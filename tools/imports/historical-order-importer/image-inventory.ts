import { open as openFile } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import type { SqlDatabase, SqlStatement } from '@ygb/contracts';
import { canonicalJson, IncrementalSha256, sha256Hex } from '@ygb/domain';

/**
 * Stage 6.5 read-only historical image inventory (D-054 real-import prep).
 *
 * Scans a source directory of image files WITHOUT EVER WRITING to it: bytes
 * are streamed (64 KiB windows) through an incremental SHA-256, the MIME type
 * is sniffed from magic bytes (extensions are never trusted alone), and each
 * file's facts land in the historical_image_inventory_* tables with a
 * checkpoint after every committed page. A later reconciliation joins the
 * inventory against a historical import batch's file plans to classify
 * LINKED / ORPHAN / QUARANTINE business relations, detect duplicate content,
 * and emit the stable JSONL/CSV artifacts plus the imageInventory map input
 * the stage-6 importer accepts. Reports and plans only — no R2 or Drive
 * upload is ever executed by this module.
 */

const READ_CHUNK_BYTES = 64 * 1024;
const SNIFF_BYTES = 16;

export const HISTORICAL_IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
};

/** Magic-byte sniffing — the extension is a cross-check, never the source. */
export function sniffImageMime(head: Uint8Array): string | null {
  const startsWith = (bytes: readonly number[]) =>
    head.length >= bytes.length && bytes.every((byte, index) => head[index] === byte);
  if (startsWith([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) // GIF87a
    || startsWith([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) return 'image/gif'; // GIF89a
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && head.length >= 12
    && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50) {
    return 'image/webp';
  }
  if (startsWith([0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
  return null;
}

export type ImageInventoryFindingCode =
  | 'READ_FAILED' | 'UNRECOGNIZED_MIME' | 'EXTENSION_MIME_MISMATCH' | 'DUPLICATE_CONTENT'
  | 'ORPHAN_FILE' | 'REFERENCED_MISSING' | 'UNRESOLVED_BUSINESS_RELATION' | 'UNRESOLVED_AUDIENCE'
  | 'UNSAFE_ENTRY';

export interface ImageInventorySummary {
  batch_id: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'ABANDONED';
  source_root: string;
  source_listing_sha256: string;
  scanned_files: number;
  scanned_bytes: number;
  read_failed_files: number;
  unrecognized_mime_files: number;
  duplicate_content_groups: number;
  findings: number;
  resumed_from: string | null;
  real_image_inventory: 'NOT_RUN_SYNTHETIC_ONLY';
}

export interface ImageInventoryRunOptions {
  sourceRoot: string;
  resumeBatchId?: string;
  actorStaffId?: string;
  now?: number;
  /** Files per committed checkpoint page (every page is one transaction). */
  checkpointEvery?: number;
  /** Test hook: stop after N files (simulated interruption before commit). */
  stopAfterFiles?: number;
}

interface ScannedFileFacts {
  byteSize: number;
  sha256: string | null;
  mimeType: string | null;
  readStatus: 'READ_OK' | 'READ_FAILED';
}

async function scanFileFacts(absolutePath: string): Promise<ScannedFileFacts> {
  const hasher = new IncrementalSha256();
  let byteSize = 0;
  let sniffHead: Uint8Array | null = null;
  const handle = await openFile(absolutePath, 'r').catch(() => null);
  if (!handle) return { byteSize: 0, sha256: null, mimeType: null, readStatus: 'READ_FAILED' };
  try {
    const buffer = new Uint8Array(new ArrayBuffer(READ_CHUNK_BYTES));
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, READ_CHUNK_BYTES, null);
      if (bytesRead === 0) break;
      const chunk = buffer.subarray(0, bytesRead);
      hasher.update(chunk);
      if (sniffHead === null) sniffHead = chunk.slice(0, SNIFF_BYTES);
      byteSize += bytesRead;
    }
  } catch {
    return { byteSize: 0, sha256: null, mimeType: null, readStatus: 'READ_FAILED' };
  } finally {
    await handle.close().catch(() => undefined);
  }
  if (byteSize === 0) {
    // Zero-byte files hash fine but carry no image payload: treat as an
    // unreadable/corrupt source rather than a valid image fact.
    return { byteSize: 0, sha256: hasher.digestHex(), mimeType: null, readStatus: 'READ_FAILED' };
  }
  return {
    byteSize,
    sha256: hasher.digestHex(),
    mimeType: sniffHead === null ? null : sniffImageMime(sniffHead),
    readStatus: 'READ_OK',
  };
}

/** Streams the directory listing; only regular files are inventory entries. */
export async function listImageDirectory(sourceRoot: string): Promise<{
  paths: string[];
  unsafeEntries: string[];
}> {
  const { readdir } = await import('node:fs/promises');
  const root = resolve(sourceRoot);
  const paths: string[] = [];
  const unsafeEntries: string[] = [];
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = join(directory, entry.name);
      const rel = relative(root, entryPath).split(sep).join('/');
      if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (entry.isFile()) {
        paths.push(rel);
      } else {
        // Symlinks, devices, sockets... never followed or written.
        unsafeEntries.push(rel);
      }
    }
  }
  await walk(root);
  paths.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { paths, unsafeEntries };
}

function listingDigest(paths: readonly string[]): string {
  const hasher = new IncrementalSha256();
  const encoder = new TextEncoder();
  for (const path of paths) {
    hasher.update(encoder.encode(path));
    hasher.update(encoder.encode('\n'));
  }
  return hasher.digestHex();
}

/** Stable per-path logical identity: histimg- + SHA-256(path), 72 chars. */
export async function logicalImageFileId(relativePath: string): Promise<string> {
  return `histimg-${await sha256Hex(relativePath)}`;
}

function extensionOf(relativePath: string): string | null {
  const name = basename(relativePath);
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return null;
  const extension = name.slice(dot).toLowerCase();
  return extension.length <= 16 ? extension : null;
}

/**
 * Runs (or resumes) one read-only inventory batch. The source directory is
 * never written: files are opened read-only, all outputs live in the local
 * D1 inventory tables and in the caller-specified reconciliation output
 * directory (see reconcileImageInventory).
 */
export async function runImageInventory(
  database: SqlDatabase,
  options: ImageInventoryRunOptions,
): Promise<ImageInventorySummary> {
  const now = options.now ?? Date.now();
  const checkpointEvery = options.checkpointEvery ?? 200;
  const sourceRoot = resolve(options.sourceRoot);
  const { paths, unsafeEntries } = await listImageDirectory(sourceRoot);
  const listingSha = listingDigest(paths);

  let batchId = options.resumeBatchId ?? null;
  let resumedFrom: string | null = null;
  if (batchId) {
    const batch = await database
      .prepare(`SELECT id,source_root,source_listing_sha256,status,checkpoint_relative_path
        FROM historical_image_inventory_batches WHERE id=?`)
      .bind(batchId).first<{
        id: string; source_root: string; source_listing_sha256: string;
        status: string; checkpoint_relative_path: string | null;
      }>();
    if (!batch) throw new Error('INVENTORY_BATCH_NOT_FOUND');
    if (batch.status !== 'RUNNING') throw new Error(`INVENTORY_BATCH_NOT_RESUMABLE:${batch.status}`);
    if (batch.source_listing_sha256 !== listingSha || batch.source_root !== sourceRoot) {
      throw new Error('SOURCE_CHANGED_SINCE_BATCH: the source directory listing changed; start a NEW inventory');
    }
    resumedFrom = batch.checkpoint_relative_path;
  } else {
    const existing = await database
      .prepare(`SELECT id,status FROM historical_image_inventory_batches
        WHERE source_root=? AND source_listing_sha256=?`)
      .bind(sourceRoot, listingSha).first<{ id: string; status: string }>();
    if (existing) {
      if (existing.status === 'COMPLETED') return imageInventorySummary(database, existing.id, null);
      throw new Error(`INVENTORY_BATCH_ALREADY_RUNNING:${existing.id} — resume it explicitly`);
    }
    batchId = `hist-img-inv-${crypto.randomUUID()}`;
    await database.batch([database.prepare(
      `INSERT INTO historical_image_inventory_batches(id,source_root,source_listing_sha256,status,
       checkpoint_relative_path,created_by_staff_id,created_at,updated_at)
       VALUES(?,?,?,'RUNNING',NULL,?,?,?)`,
    ).bind(batchId, sourceRoot, listingSha, options.actorStaffId ?? null, now, now)]);
  }

  // Sorted-order resume: everything at or before the checkpoint already has
  // durable rows (INSERT OR IGNORE makes replay idempotent regardless).
  let startIndex = 0;
  if (resumedFrom !== null) {
    const found = paths.findIndex((candidate) => candidate === resumedFrom);
    if (found >= 0) startIndex = found + 1;
  }

  let pending: SqlStatement[] = [];
  let processed = 0;
  let pageScanned = 0;
  const flush = async (checkpointPath: string | null): Promise<void> => {
    if (pending.length === 0 && checkpointPath === null) return;
    const statements = [...pending];
    if (checkpointPath !== null) {
      statements.push(database.prepare(
        `UPDATE historical_image_inventory_batches
         SET checkpoint_relative_path=?,
           scanned_files=(SELECT COUNT(*) FROM historical_image_inventory_files WHERE inventory_batch_id=?),
           scanned_bytes=(SELECT COALESCE(SUM(byte_size),0) FROM historical_image_inventory_files WHERE inventory_batch_id=?),
           read_failed_files=(SELECT COUNT(*) FROM historical_image_inventory_files WHERE inventory_batch_id=? AND read_status='READ_FAILED'),
           unrecognized_mime_files=(SELECT COUNT(*) FROM historical_image_inventory_files WHERE inventory_batch_id=? AND (mime_type IS NULL OR read_status='READ_FAILED')),
           updated_at=?
         WHERE id=?`,
      ).bind(checkpointPath, batchId, batchId, batchId, batchId, now, batchId));
    }
    if (statements.length > 0) await database.batch(statements);
    pending = [];
  };

  for (let index = startIndex; index < paths.length; index += 1) {
    const relativePath = paths[index]!;
    const facts = await scanFileFacts(join(sourceRoot, relativePath));
    const extension = extensionOf(relativePath);
    const expectedMime = extension === null ? null : HISTORICAL_IMAGE_MIME_BY_EXTENSION[extension] ?? null;
    const extensionConsistent = facts.mimeType === null || expectedMime === null || expectedMime === facts.mimeType
      ? 1
      : 0;
    pending.push(database.prepare(
      `INSERT OR IGNORE INTO historical_image_inventory_files(id,inventory_batch_id,relative_path,
       logical_file_id,byte_size,sha256,mime_type,extension,read_status,extension_mime_consistent,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      `hist-img-${crypto.randomUUID()}`,
      batchId,
      relativePath,
      await logicalImageFileId(relativePath),
      facts.readStatus === 'READ_OK' ? facts.byteSize : 0,
      facts.readStatus === 'READ_OK' ? facts.sha256 : null,
      facts.mimeType,
      extension,
      facts.readStatus,
      extensionConsistent,
      now,
    ));
    if (facts.readStatus === 'READ_FAILED') {
      pending.push(findingStatement(database, batchId, relativePath, 'READ_FAILED', { extension }, now));
    } else if (facts.mimeType === null) {
      pending.push(findingStatement(database, batchId, relativePath, 'UNRECOGNIZED_MIME', { extension }, now));
    } else if (extensionConsistent === 0) {
      pending.push(findingStatement(database, batchId, relativePath, 'EXTENSION_MIME_MISMATCH', {
        extension, sniffed_mime: facts.mimeType,
      }, now));
    }
    pageScanned += 1;
    processed += 1;
    if (options.stopAfterFiles !== undefined && processed >= options.stopAfterFiles) {
      // Simulated interruption BEFORE the final commit: only the last durable
      // checkpoint survives.
      await flush(paths[index] ?? null);
      return imageInventorySummary(database, batchId!, resumedFrom);
    }
    if (pageScanned % checkpointEvery === 0) {
      await flush(relativePath);
    }
  }
  for (const unsafe of unsafeEntries) {
    pending.push(findingStatement(database, batchId, unsafe, 'UNSAFE_ENTRY', {}, now));
  }
  await flush(null);
  await database.batch([database.prepare(
    `UPDATE historical_image_inventory_batches SET status='COMPLETED',finished_at=?,
     checkpoint_relative_path=NULL,
     scanned_files=(SELECT COUNT(*) FROM historical_image_inventory_files WHERE inventory_batch_id=?),
     scanned_bytes=(SELECT COALESCE(SUM(byte_size),0) FROM historical_image_inventory_files WHERE inventory_batch_id=?),
     read_failed_files=(SELECT COUNT(*) FROM historical_image_inventory_files WHERE inventory_batch_id=? AND read_status='READ_FAILED'),
     unrecognized_mime_files=(SELECT COUNT(*) FROM historical_image_inventory_files WHERE inventory_batch_id=? AND (mime_type IS NULL OR read_status='READ_FAILED')),
     updated_at=? WHERE id=? AND status='RUNNING'`,
  ).bind(now, batchId, batchId, batchId, batchId, now, batchId)]);
  return imageInventorySummary(database, batchId, resumedFrom);
}

function findingStatement(
  database: SqlDatabase,
  batchId: string,
  relativePath: string,
  code: ImageInventoryFindingCode,
  detail: Record<string, unknown>,
  now: number,
): SqlStatement {
  return database.prepare(
    `INSERT OR IGNORE INTO historical_image_inventory_findings(id,inventory_batch_id,relative_path,
     finding_code,detail_json,created_at) VALUES(?,?,?,?,?,?)`,
  ).bind(
    `hist-img-find-${crypto.randomUUID()}`,
    batchId,
    relativePath,
    code,
    canonicalJson(detail),
    now,
  );
}

export async function imageInventorySummary(
  database: SqlDatabase,
  batchId: string,
  resumedFrom: string | null,
): Promise<ImageInventorySummary> {
  const batch = await database
    .prepare(`SELECT source_root,source_listing_sha256,status,scanned_files,scanned_bytes,
      read_failed_files,unrecognized_mime_files,duplicate_content_groups
      FROM historical_image_inventory_batches WHERE id=?`)
    .bind(batchId).first<{
      source_root: string; source_listing_sha256: string; status: string;
      scanned_files: number; scanned_bytes: number; read_failed_files: number;
      unrecognized_mime_files: number; duplicate_content_groups: number;
    }>();
  if (!batch) throw new Error('INVENTORY_BATCH_NOT_FOUND');
  const findingCount = await database
    .prepare('SELECT COUNT(*) AS count FROM historical_image_inventory_findings WHERE inventory_batch_id=?')
    .bind(batchId).first<{ count: number }>();
  return {
    batch_id: batchId,
    status: batch.status as ImageInventorySummary['status'],
    source_root: batch.source_root,
    source_listing_sha256: batch.source_listing_sha256,
    scanned_files: batch.scanned_files,
    scanned_bytes: batch.scanned_bytes,
    read_failed_files: batch.read_failed_files,
    unrecognized_mime_files: batch.unrecognized_mime_files,
    duplicate_content_groups: batch.duplicate_content_groups,
    findings: Number(findingCount?.count ?? 0),
    resumed_from: resumedFrom,
    real_image_inventory: 'NOT_RUN_SYNTHETIC_ONLY',
  };
}

// ---------------------------------------------------------------------------
// Reconciliation: business mapping, duplicate detection, artifacts
// ---------------------------------------------------------------------------

export interface ImageReconciliationOptions {
  inventoryBatchId: string;
  /** The historical import batch whose file plans define the mapping. */
  importBatchId?: string;
  /** Explicit output directory — must sit OUTSIDE the source directory. */
  outputDir: string;
  now?: number;
  /** Keyset page size for every reconciliation scan. */
  pageSize?: number;
}

export interface ImageReconciliationSummary {
  inventory_batch_id: string;
  import_batch_id: string | null;
  linked_files: number;
  orphan_files: number;
  quarantined_files: number;
  duplicate_content_groups: number;
  referenced_missing: number;
  findings: number;
  artifacts: {
    inventory_jsonl: string;
    findings_jsonl: string;
    inventory_csv: string;
    summary_json: string;
    inventory_map_jsonl: string;
  };
  business_relation_rule: string;
  plan_only: 'NO_R2_OR_DRIVE_UPLOAD_EXECUTED';
}

interface InventoryFileRow {
  relative_path: string;
  logical_file_id: string;
  byte_size: number | null;
  sha256: string | null;
  mime_type: string | null;
  extension: string | null;
  read_status: string;
  extension_mime_consistent: number;
}

interface ReferenceRow {
  source_ref: string;
  order_id: string;
  purpose: string;
  audience: string;
}

function assertOutputDirectorySafe(outputDir: string, sourceRoot: string): void {
  const output = resolve(outputDir);
  const source = resolve(sourceRoot);
  if (output === source
    || output.startsWith(source + sep)
    || source.startsWith(output + sep)) {
    throw new Error(`OUTPUT_DIRECTORY_OVERLAPS_SOURCE:${output} vs ${source}`);
  }
}

export async function reconcileImageInventory(
  database: SqlDatabase,
  options: ImageReconciliationOptions,
): Promise<ImageReconciliationSummary> {
  const now = options.now ?? Date.now();
  const pageSize = options.pageSize ?? 5_000;
  const batch = await database
    .prepare(`SELECT id,source_root,status FROM historical_image_inventory_batches WHERE id=?`)
    .bind(options.inventoryBatchId).first<{ id: string; source_root: string; status: string }>();
  if (!batch) throw new Error('INVENTORY_BATCH_NOT_FOUND');
  if (batch.status !== 'COMPLETED') throw new Error(`INVENTORY_NOT_COMPLETED:${batch.status}`);
  assertOutputDirectorySafe(options.outputDir, batch.source_root);
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir(resolve(options.outputDir), { recursive: true });
  const artifact = (name: string) => join(resolve(options.outputDir), name);

  // --- 1. Duplicate content groups (keyset-paginated, SQL-side grouping) ---
  let duplicateGroups = 0;
  const duplicateStatements: SqlStatement[] = [];
  let lastSha = '';
  for (;;) {
    const page = await database
      .prepare(`SELECT sha256, COUNT(*) AS count FROM historical_image_inventory_files
        WHERE inventory_batch_id=? AND sha256 IS NOT NULL AND sha256>?
        GROUP BY sha256 HAVING COUNT(*)>1 ORDER BY sha256 LIMIT ?`)
      .bind(options.inventoryBatchId, lastSha, pageSize)
      .all<{ sha256: string; count: number }>();
    if (page.results.length === 0) break;
    for (const group of page.results) {
      duplicateGroups += 1;
      // The lexicographically smallest path is the canonical copy; every
      // other physical duplicate gets a finding row.
      const members = await database
        .prepare(`SELECT relative_path FROM historical_image_inventory_files
          WHERE inventory_batch_id=? AND sha256=? ORDER BY relative_path`)
        .bind(options.inventoryBatchId, group.sha256)
        .all<{ relative_path: string }>();
      for (const member of members.results.slice(1)) {
        duplicateStatements.push(findingStatement(database, options.inventoryBatchId,
          member.relative_path, 'DUPLICATE_CONTENT', {
            canonical_path: members.results[0]!.relative_path,
            duplicate_count: group.count,
          }, now));
      }
    }
    lastSha = page.results[page.results.length - 1]!.sha256;
  }
  for (let offset = 0; offset < duplicateStatements.length; offset += 40) {
    await database.batch(duplicateStatements.slice(offset, offset + 40));
  }

  // --- 2. Load the reference map (paginated) when an import batch is given ---
  const references = new Map<string, ReferenceRow[]>();
  if (options.importBatchId) {
    let lastId = '';
    for (;;) {
      const page = await database
        .prepare(`SELECT plan.id,plan.source_ref,plan.purpose,plan.audience,hist.source_order_id
          FROM historical_order_files plan
          JOIN historical_orders hist ON hist.id=plan.historical_order_id
          WHERE plan.import_batch_id=? AND plan.source_ref IS NOT NULL AND plan.id>?
          ORDER BY plan.id LIMIT ?`)
        .bind(options.importBatchId, lastId, pageSize)
        .all<{ id: string; source_ref: string; purpose: string; audience: string; source_order_id: string }>();
      if (page.results.length === 0) break;
      for (const row of page.results) {
        const list = references.get(row.source_ref) ?? [];
        list.push({
          source_ref: row.source_ref,
          order_id: row.source_order_id,
          purpose: row.purpose,
          audience: row.audience,
        });
        references.set(row.source_ref, list);
      }
      lastId = page.results[page.results.length - 1]!.id;
    }
  }

  // --- 3. Walk inventory files in keyset pages, classify + emit artifacts ---
  const baseNameOf = (value: string) => value.split('/').pop() ?? value;
  const inventoryJsonLines: string[] = [];
  const csvLines: string[] = [
    'relative_path,logical_file_id,byte_size,sha256,mime_type,extension,read_status,'
      + 'extension_mime_consistent,business_relation,business_order_id,business_purpose,business_audience',
  ];
  const mapLines: string[] = [];
  const relationStatements: SqlStatement[] = [];
  let linked = 0;
  let orphan = 0;
  let quarantined = 0;
  const matchedReferences = new Set<string>();
  let lastPath = '';
  for (;;) {
    const page = await database
      .prepare(`SELECT relative_path,logical_file_id,byte_size,sha256,mime_type,extension,
        read_status,extension_mime_consistent FROM historical_image_inventory_files
        WHERE inventory_batch_id=? AND relative_path>? ORDER BY relative_path LIMIT ?`)
      .bind(options.inventoryBatchId, lastPath, pageSize)
      .all<InventoryFileRow>();
    if (page.results.length === 0) break;
    for (const file of page.results) {
      let relation: 'LINKED' | 'ORPHAN' | 'QUARANTINE';
      let orderId: string | null = null;
      let purpose: string | null = null;
      let audience: string | null = null;
      if (!options.importBatchId) {
        // Without an import batch no business relation can be determined:
        // everything quarantines (fail closed, never a silent LINKED).
        relation = 'QUARANTINE';
        relationStatements.push(findingStatement(database, options.inventoryBatchId,
          file.relative_path, 'UNRESOLVED_BUSINESS_RELATION', { reason: 'no_import_batch' }, now));
      } else {
        const matches = references.get(file.relative_path)
          ?? references.get(baseNameOf(file.relative_path))
          ?? [];
        const distinct = new Map<string, ReferenceRow>();
        for (const match of matches) {
          distinct.set(`${match.order_id}:${match.purpose}`, match);
          matchedReferences.add(match.source_ref);
        }
        if (distinct.size === 1) {
          const match = [...distinct.values()][0]!;
          relation = 'LINKED';
          orderId = match.order_id;
          purpose = match.purpose;
          audience = match.audience;
          if (!match.audience) {
            relation = 'QUARANTINE';
            relationStatements.push(findingStatement(database, options.inventoryBatchId,
              file.relative_path, 'UNRESOLVED_AUDIENCE', { order_id: match.order_id }, now));
          }
        } else if (distinct.size > 1) {
          relation = 'QUARANTINE';
          relationStatements.push(findingStatement(database, options.inventoryBatchId,
            file.relative_path, 'UNRESOLVED_BUSINESS_RELATION', {
              reason: 'ambiguous_reference',
              reference_count: distinct.size,
            }, now));
        } else {
          relation = 'ORPHAN';
          relationStatements.push(findingStatement(database, options.inventoryBatchId,
            file.relative_path, 'ORPHAN_FILE', {}, now));
        }
      }
      if (relation === 'LINKED') linked += 1;
      else if (relation === 'ORPHAN') orphan += 1;
      else quarantined += 1;
      relationStatements.push(database.prepare(
        `UPDATE historical_image_inventory_files
         SET business_relation=?,business_import_batch_id=?,business_order_id=?,
           business_purpose=?,business_audience=?
         WHERE inventory_batch_id=? AND relative_path=?`,
      ).bind(
        relation,
        options.importBatchId ?? null,
        orderId,
        purpose,
        audience,
        options.inventoryBatchId,
        file.relative_path,
      ));
      const csvEscape = (value: string | number | null) =>
        value === null ? '' : /[",\n]/u.test(String(value)) ? `"${String(value).replaceAll('"', '""')}"` : String(value);
      csvLines.push([
        file.relative_path, file.logical_file_id, file.byte_size ?? '', file.sha256 ?? '',
        file.mime_type ?? '', file.extension ?? '', file.read_status,
        file.extension_mime_consistent, relation, orderId ?? '', purpose ?? '', audience ?? '',
      ].map(csvEscape).join(','));
      inventoryJsonLines.push(JSON.stringify({
        relative_path: file.relative_path,
        logical_file_id: file.logical_file_id,
        byte_size: file.byte_size,
        sha256: file.sha256,
        mime_type: file.mime_type,
        extension: file.extension,
        read_status: file.read_status,
        extension_mime_consistent: file.extension_mime_consistent === 1,
        business_relation: relation,
        business_order_id: orderId,
        business_purpose: purpose,
        business_audience: audience,
      }));
      if (file.read_status === 'READ_OK' && file.sha256 && file.mime_type) {
        mapLines.push(JSON.stringify({
          path: file.relative_path,
          sha256: file.sha256,
          mime: file.mime_type,
          byteSize: file.byte_size,
        }));
      }
    }
    lastPath = page.results[page.results.length - 1]!.relative_path;
  }
  for (let offset = 0; offset < relationStatements.length; offset += 40) {
    await database.batch(relationStatements.slice(offset, offset + 40));
  }

  // --- 4. Referenced-but-missing (refs with no physical inventory file) ---
  const referencedMissingStatements: SqlStatement[] = [];
  let referencedMissing = 0;
  if (options.importBatchId) {
    let lastId = '';
    for (;;) {
      const page = await database
        .prepare(`SELECT plan.id,plan.source_ref FROM historical_order_files plan
          WHERE plan.import_batch_id=? AND plan.source_ref IS NOT NULL AND plan.id>?
          ORDER BY plan.id LIMIT ?`)
        .bind(options.importBatchId, lastId, pageSize)
        .all<{ id: string; source_ref: string }>();
      if (page.results.length === 0) break;
      for (const row of page.results) {
        if (matchedReferences.has(row.source_ref)) continue;
        const exact = await database
          .prepare(`SELECT 1 AS found FROM historical_image_inventory_files
            WHERE inventory_batch_id=? AND relative_path=? LIMIT 1`)
          .bind(options.inventoryBatchId, row.source_ref)
          .first<{ found: number }>();
        if (exact) {
          matchedReferences.add(row.source_ref);
          continue;
        }
        const byBase = await database
          .prepare(`SELECT 1 AS found FROM historical_image_inventory_files
            WHERE inventory_batch_id=? AND relative_path LIKE ? LIMIT 1`)
          .bind(options.inventoryBatchId, `%/${baseNameOf(row.source_ref).replaceAll('%', '\\%').replaceAll('_', '\\_')}`)
          .first<{ found: number }>();
        if (byBase) {
          matchedReferences.add(row.source_ref);
          continue;
        }
        referencedMissing += 1;
        referencedMissingStatements.push(findingStatement(database, options.inventoryBatchId,
          row.source_ref, 'REFERENCED_MISSING', { import_batch_id: options.importBatchId }, now));
      }
      lastId = page.results[page.results.length - 1]!.id;
    }
    for (let offset = 0; offset < referencedMissingStatements.length; offset += 40) {
      await database.batch(referencedMissingStatements.slice(offset, offset + 40));
    }
  }

  // --- 5. Artifacts + duplicate-group counter + findings export ---
  const findingLines: string[] = [];
  let lastFinding = '';
  for (;;) {
    const page = await database
      .prepare(`SELECT relative_path,finding_code,detail_json FROM historical_image_inventory_findings
        WHERE inventory_batch_id=? AND relative_path>? ORDER BY relative_path LIMIT ?`)
      .bind(options.inventoryBatchId, lastFinding, pageSize)
      .all<{ relative_path: string; finding_code: string; detail_json: string }>();
    if (page.results.length === 0) break;
    for (const row of page.results) {
      findingLines.push(JSON.stringify({
        relative_path: row.relative_path,
        finding_code: row.finding_code,
        detail: JSON.parse(row.detail_json) as Record<string, unknown>,
      }));
    }
    lastFinding = page.results[page.results.length - 1]!.relative_path;
  }
  await database.batch([database.prepare(
    `UPDATE historical_image_inventory_batches SET duplicate_content_groups=?,updated_at=?
     WHERE id=?`,
  ).bind(duplicateGroups, now, options.inventoryBatchId)]);

  const summary: ImageReconciliationSummary = {
    inventory_batch_id: options.inventoryBatchId,
    import_batch_id: options.importBatchId ?? null,
    linked_files: linked,
    orphan_files: orphan,
    quarantined_files: quarantined,
    duplicate_content_groups: duplicateGroups,
    referenced_missing: referencedMissing,
    findings: findingLines.length,
    artifacts: {
      inventory_jsonl: artifact('inventory.jsonl'),
      findings_jsonl: artifact('findings.jsonl'),
      inventory_csv: artifact('inventory.csv'),
      summary_json: artifact('summary.json'),
      inventory_map_jsonl: artifact('inventory-map.jsonl'),
    },
    business_relation_rule: 'inventory path or basename exact-matches historical_order_files.source_ref of the given import batch; '
      + 'no match = ORPHAN, ambiguous match = QUARANTINE, audience missing = QUARANTINE, no import batch = QUARANTINE',
    plan_only: 'NO_R2_OR_DRIVE_UPLOAD_EXECUTED',
  };
  await writeFile(summary.artifacts.inventory_jsonl, `${inventoryJsonLines.join('\n')}\n`, 'utf8');
  await writeFile(summary.artifacts.findings_jsonl, `${findingLines.join('\n')}\n`, 'utf8');
  await writeFile(summary.artifacts.inventory_csv, `${csvLines.join('\n')}\n`, 'utf8');
  await writeFile(summary.artifacts.inventory_map_jsonl, `${mapLines.join('\n')}\n`, 'utf8');
  await writeFile(summary.artifacts.summary_json, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  return summary;
}

/**
 * Builds the imageInventory Map the stage-6 importer accepts (path → digest
 * facts) from a COMPLETED inventory batch. Paginated; used after
 * reconciliation to re-run imports with real byte digests.
 */
export async function buildImageInventoryMap(
  database: SqlDatabase,
  inventoryBatchId: string,
  pageSize = 5_000,
): Promise<Map<string, { sha256: string; mime: string; byteSize: number }>> {
  const map = new Map<string, { sha256: string; mime: string; byteSize: number }>();
  let lastPath = '';
  for (;;) {
    const page = await database
      .prepare(`SELECT relative_path,sha256,mime_type,byte_size FROM historical_image_inventory_files
        WHERE inventory_batch_id=? AND relative_path>? AND read_status='READ_OK'
          AND sha256 IS NOT NULL AND mime_type IS NOT NULL
        ORDER BY relative_path LIMIT ?`)
      .bind(inventoryBatchId, lastPath, pageSize)
      .all<{ relative_path: string; sha256: string; mime_type: string; byte_size: number }>();
    if (page.results.length === 0) break;
    for (const row of page.results) {
      map.set(row.relative_path, {
        sha256: row.sha256,
        mime: row.mime_type,
        byteSize: row.byte_size ?? 0,
      });
    }
    lastPath = page.results[page.results.length - 1]!.relative_path;
  }
  return map;
}
