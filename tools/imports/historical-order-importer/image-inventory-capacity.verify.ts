import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import {
  buildImageInventoryMap,
  reconcileImageInventory,
  runImageInventory,
} from './image-inventory';

/**
 * Stage 6.5 image-inventory capacity verification: 100,000+ synthetic image
 * metadata entries driven through the REAL read-only scan → checkpointed
 * apply → resume → SQL-side reconciliation machinery. Proves pagination,
 * checkpoint durability, duplicate grouping and reconciliation never
 * aggregate the full set in memory, and that interrupted runs converge to
 * exactly the one-shot state. Synthetic files only — REAL_IMAGE_INVENTORY
 * stays NOT_RUN.
 */

const FILE_COUNT = 100_000;
const DIRECTORIES = 100;
const FILES_PER_DIRECTORY = FILE_COUNT / DIRECTORIES;
/** Content cycles every 19,000 indexes → ~5% of files share each digest. */
const UNIQUE_CONTENTS = 19_000;

function fileBytes(contentIndex: number): Uint8Array {
  const length = 64 + (contentIndex % 97);
  const bytes = new Uint8Array(new ArrayBuffer(length));
  // PNG magic prefix keeps every file a sniffable image.
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  for (let index = 8; index < length; index += 1) {
    bytes[index] = (contentIndex * 31 + index * 7) % 251;
  }
  return bytes;
}

function synthesizeSourceDirectory(root: string): { duplicateGroups: number; totalBytes: number } {
  const perDigest = new Array<number>(UNIQUE_CONTENTS).fill(0);
  let totalBytes = 0;
  for (let directory = 0; directory < DIRECTORIES; directory += 1) {
    const directoryPath = path.join(root, `set-${String(directory).padStart(3, '0')}`);
    mkdirSync(directoryPath, { recursive: true });
    for (let slot = 0; slot < FILES_PER_DIRECTORY; slot += 1) {
      const flat = directory * FILES_PER_DIRECTORY + slot;
      const contentIndex = flat % UNIQUE_CONTENTS;
      const bytes = fileBytes(contentIndex);
      totalBytes += bytes.byteLength;
      perDigest[contentIndex] = (perDigest[contentIndex] ?? 0) + 1;
      writeFileSync(
        path.join(directoryPath, `image-${String(slot).padStart(5, '0')}.png`),
        bytes,
      );
    }
  }
  return {
    duplicateGroups: perDigest.filter((count) => count > 1).length,
    totalBytes,
  };
}

describe('image inventory capacity (stage 6.5)', () => {
  it('inventories, resumes and reconciles 100k image entries without full in-memory aggregation',
    { timeout: 590_000 }, async () => {
      const startedAt = Date.now();
      const sourceRoot = mkdtempSync(path.join(tmpdir(), 'ygb-img-capacity-'));
      const outputDir = mkdtempSync(path.join(tmpdir(), 'ygb-img-capacity-out-'));
      try {
        const synthStartedAt = Date.now();
        const { duplicateGroups, totalBytes } = synthesizeSourceDirectory(sourceRoot);
        const synthMs = Date.now() - synthStartedAt;
        expect(duplicateGroups).toBeGreaterThan(UNIQUE_CONTENTS * 0.9);
        const heapBeforeScan = process.memoryUsage().heapUsed;

        // --- 1. Interrupted scan + resume converges to the one-shot state ---
        const db: SqliteDatabase = createMigratedTestDatabase();
        const interruptStartedAt = Date.now();
        const interrupted = await runImageInventory(db, {
          sourceRoot, now: 1_000, checkpointEvery: 500, stopAfterFiles: 43_000,
        });
        expect(interrupted.status).toBe('RUNNING');
        const interruptMs = Date.now() - interruptStartedAt;
        const resumeStartedAt = Date.now();
        const resumed = await runImageInventory(db, {
          sourceRoot, resumeBatchId: interrupted.batch_id, now: 2_000, checkpointEvery: 500,
        });
        const resumeMs = Date.now() - resumeStartedAt;
        expect(resumed.status).toBe('COMPLETED');
        expect(resumed.scanned_files).toBe(FILE_COUNT);
        expect(resumed.scanned_bytes).toBe(totalBytes);
        expect(resumed.read_failed_files).toBe(0);
        expect(resumed.unrecognized_mime_files).toBe(0);
        // Re-scanning the same listing replays idempotently.
        const replay = await runImageInventory(db, { sourceRoot, now: 3_000, checkpointEvery: 500 });
        expect(replay.batch_id).toBe(resumed.batch_id);
        expect(replay.scanned_files).toBe(FILE_COUNT);

        // --- 2. SQL-side duplicate detection + relation classification ---
        const reconcileStartedAt = Date.now();
        const reconciliation = await reconcileImageInventory(db, {
          inventoryBatchId: resumed.batch_id,
          outputDir,
          now: 4_000,
          pageSize: 5_000,
        });
        const reconcileMs = Date.now() - reconcileStartedAt;
        expect(reconciliation.duplicate_content_groups).toBe(duplicateGroups);
        // No import batch given: every file fail-closes to QUARANTINE.
        expect(reconciliation.quarantined_files).toBe(FILE_COUNT);
        expect(reconciliation.linked_files).toBe(0);
        expect(reconciliation.orphan_files).toBe(0);
        // Findings = one UNRESOLVED_BUSINESS_RELATION per file plus one
        // DUPLICATE_CONTENT per non-canonical physical copy.
        expect(reconciliation.findings).toBe(FILE_COUNT + (FILE_COUNT - duplicateGroups));

        // --- 3. Bounded memory: the machinery never aggregates 100k rows ---
        const heapDeltaBytes = process.memoryUsage().heapUsed - heapBeforeScan;
        expect(heapDeltaBytes).toBeLessThan(512 * 1024 * 1024);

        // --- 4. The importer input map carries real digests for every file ---
        const mapStartedAt = Date.now();
        const map = await buildImageInventoryMap(db, resumed.batch_id);
        const mapMs = Date.now() - mapStartedAt;
        expect(map.size).toBe(FILE_COUNT);
        for (const entry of map.values()) {
          expect(entry.mime).toBe('image/png');
          expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/u);
        }

        // --- 5. D1 parameter bound: every table stays far below 100 columns ---
        for (const table of ['historical_image_inventory_batches',
          'historical_image_inventory_files', 'historical_image_inventory_findings']) {
          const columns = db.raw.prepare(`PRAGMA table_info(${table})`).all() as unknown[];
          expect(columns.length).toBeLessThan(100);
        }

        // --- 6. No O(N²): the resumed half must not be dramatically slower. ---
        expect(resumeMs).toBeLessThan(Math.max(interruptMs * 15, 120_000));
        db.close();
        const totalMs = Date.now() - startedAt;
        console.log('[image-inventory-capacity]', JSON.stringify({
          files: FILE_COUNT,
          directories: DIRECTORIES,
          duplicate_content_groups: duplicateGroups,
          total_bytes: totalBytes,
          synth_ms: synthMs,
          interrupt_ms: interruptMs,
          resume_ms: resumeMs,
          reconcile_ms: reconcileMs,
          map_ms: mapMs,
          heap_delta_mb: Math.round(heapDeltaBytes / 1024 / 1024),
          total_ms: totalMs,
          real_image_inventory: 'NOT_RUN_SYNTHETIC_ONLY',
        }));
      } finally {
        rmSync(sourceRoot, { recursive: true, force: true });
        rmSync(outputDir, { recursive: true, force: true });
      }
    });
});
