import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import { sha256Hex } from '@ygb/domain';
import {
  buildImageInventoryMap,
  listImageDirectory,
  logicalImageFileId,
  reconcileImageInventory,
  runImageInventory,
  sniffImageMime,
} from './image-inventory';
import { runHistoricalImport } from './pipeline';
import { HISTORICAL_CSV_HEADERS } from './index';

/**
 * Stage 6.5 image inventory tests — synthetic fixtures only
 * (REAL_IMAGE_INVENTORY=NOT_RUN). The source directory is read-only: tests
 * assert its contents never change.
 */

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7, 6]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 5, 4]);
const NOT_AN_IMAGE = new TextEncoder().encode('hello world this is text');

let database: SqliteDatabase | null = null;
const tempDirectories: string[] = [];
afterEach(() => {
  database?.close();
  database = null;
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), `${prefix}-`));
  tempDirectories.push(directory);
  return directory;
}

function writeImage(root: string, relativePath: string, bytes: Uint8Array): void {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, bytes);
}

/** Read-only witness: full content digest of every file in the tree. */
function treeDigest(root: string): string {
  const entries: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(entryPath);
      else if (entry.isFile()) {
        entries.push(`${path.relative(root, entryPath)}:${createHash('sha256').update(readFileSync(entryPath)).digest('hex')}`);
      }
    }
  };
  walk(root);
  entries.sort();
  return createHash('sha256').update(entries.join('\n')).digest('hex');
}

function buildSourceDirectory(root: string): void {
  writeImage(root, 'images/chat-a.png', PNG);
  writeImage(root, 'images/order-a.jpg', JPEG);
  writeImage(root, 'images/webp-a.webp', WEBP);
  writeImage(root, 'nested/deep/gif-a.gif', GIF);
  writeImage(root, 'images/chat-a-copy.png', PNG); // duplicate content
  writeImage(root, 'images/fake.png', NOT_AN_IMAGE); // extension says png, bytes say text
  writeImage(root, 'images/noext', PNG); // sniffable image, unknown extension
  writeFileSync(path.join(root, 'images/empty.png'), new Uint8Array(0));
  symlinkSync(path.join(root, 'images/chat-a.png'), path.join(root, 'images/link.png'));
}

describe('stage 6.5 read-only image inventory', () => {
  it('sniffs MIME from magic bytes, never from the extension', () => {
    expect(sniffImageMime(PNG)).toBe('image/png');
    expect(sniffImageMime(JPEG)).toBe('image/jpeg');
    expect(sniffImageMime(WEBP)).toBe('image/webp');
    expect(sniffImageMime(GIF)).toBe('image/gif');
    expect(sniffImageMime(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1]))).toBe('application/pdf');
    expect(sniffImageMime(NOT_AN_IMAGE)).toBeNull();
    expect(sniffImageMime(new Uint8Array([1, 2]))).toBeNull();
  });

  it('streams hashes read-only and records facts, findings and logical ids', async () => {
    database = createMigratedTestDatabase();
    const sourceRoot = tempDir('img-src');
    buildSourceDirectory(sourceRoot);
    const before = treeDigest(sourceRoot);
    const beforeMtime = statSync(path.join(sourceRoot, 'images/chat-a.png')).mtimeMs;

    const summary = await runImageInventory(database, {
      sourceRoot, now: Date.UTC(2026, 7, 26), checkpointEvery: 3,
    });
    expect(summary.status).toBe('COMPLETED');
    expect(summary.scanned_files).toBe(8); // symlink is not an inventory file
    expect(summary.scanned_bytes).toBe(
      PNG.byteLength * 3 + JPEG.byteLength + WEBP.byteLength + GIF.byteLength + NOT_AN_IMAGE.byteLength,
    );
    expect(summary.read_failed_files).toBe(1); // zero-byte
    expect(summary.unrecognized_mime_files).toBe(2); // fake.png text + empty.png
    const rows = await database.prepare(
      'SELECT relative_path,sha256,mime_type,extension,read_status,extension_mime_consistent,logical_file_id FROM historical_image_inventory_files ORDER BY relative_path',
    ).all<Record<string, string | number | null>>();
    const byPath = new Map(rows.results.map((row) => [String(row['relative_path']), row]));
    const chat = byPath.get('images/chat-a.png')!;
    expect(chat['sha256']).toBe(await sha256Hex(PNG));
    expect(chat['mime_type']).toBe('image/png');
    expect(chat['read_status']).toBe('READ_OK');
    expect(chat['logical_file_id']).toBe(await logicalImageFileId('images/chat-a.png'));
    expect(String(chat['logical_file_id'])).toMatch(/^histimg-[0-9a-f]{64}$/u);
    expect(byPath.get('images/fake.png')!['mime_type']).toBeNull();
    expect(byPath.get('images/fake.png')!['extension_mime_consistent']).toBe(1); // no sniffed mime → no contradiction claim
    expect(byPath.get('images/noext')!['mime_type']).toBe('image/png');
    expect(byPath.get('images/noext')!['extension']).toBeNull();
    expect(byPath.get('images/empty.png')!['read_status']).toBe('READ_FAILED');
    const findings = await database.prepare(
      'SELECT relative_path,finding_code FROM historical_image_inventory_findings ORDER BY relative_path,finding_code',
    ).all<{ relative_path: string; finding_code: string }>();
    const codes = findings.results.map((row) => row.finding_code);
    expect(codes).toContain('READ_FAILED');
    expect(codes).toContain('UNRECOGNIZED_MIME');
    expect(codes).toContain('UNSAFE_ENTRY'); // the symlink
    // The source directory is byte-for-byte untouched.
    expect(treeDigest(sourceRoot)).toBe(before);
    expect(statSync(path.join(sourceRoot, 'images/chat-a.png')).mtimeMs).toBe(beforeMtime);
    // Re-running the same listing replays the completed summary (idempotent).
    const replay = await runImageInventory(database, {
      sourceRoot, now: Date.UTC(2026, 7, 26), checkpointEvery: 3,
    });
    expect(replay.batch_id).toBe(summary.batch_id);
    expect(replay.scanned_files).toBe(8);
    const count = await database.prepare('SELECT COUNT(*) AS count FROM historical_image_inventory_files')
      .first<{ count: number }>();
    expect(count!.count).toBe(8);
  });

  it('resumes an interrupted inventory to exactly the one-shot state', async () => {
    database = createMigratedTestDatabase();
    const sourceRoot = tempDir('img-resume');
    for (let index = 0; index < 12; index += 1) {
      writeImage(sourceRoot, `set-a/image-${String(index).padStart(2, '0')}.png`,
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, index, index + 1]));
    }
    const interrupted = await runImageInventory(database, {
      sourceRoot, now: 1_000, checkpointEvery: 4, stopAfterFiles: 6,
    });
    expect(interrupted.status).toBe('RUNNING');
    const partial = await database.prepare(
      'SELECT COUNT(*) AS count, MAX(relative_path) AS max_path FROM historical_image_inventory_files',
    ).first<{ count: number; max_path: string }>();
    expect(partial!.count).toBeLessThan(12);
    const resumed = await runImageInventory(database, {
      sourceRoot, resumeBatchId: interrupted.batch_id, now: 2_000, checkpointEvery: 4,
    });
    expect(resumed.status).toBe('COMPLETED');
    expect(resumed.batch_id).toBe(interrupted.batch_id);
    expect(resumed.scanned_files).toBe(12);
    const digest = await database.prepare(
      'SELECT COUNT(*) AS count, COALESCE(SUM(byte_size),0) AS bytes FROM historical_image_inventory_files',
    ).first<{ count: number; bytes: number }>();
    // Identical to a fresh one-shot run of the same tree.
    database.close();
    database = createMigratedTestDatabase();
    const oneShot = await runImageInventory(database, {
      sourceRoot, now: 3_000, checkpointEvery: 4,
    });
    const oneShotDigest = await database.prepare(
      'SELECT COUNT(*) AS count, COALESCE(SUM(byte_size),0) AS bytes FROM historical_image_inventory_files',
    ).first<{ count: number; bytes: number }>();
    expect(digest).toEqual(oneShotDigest);
    expect(oneShot.scanned_files).toBe(12);
  });

  it('quarantines unmatched business relations and emits the importer input map', async () => {
    database = createMigratedTestDatabase();
    const sourceRoot = tempDir('img-map-src');
    const outputDir = tempDir('img-map-out');
    writeImage(sourceRoot, 'img/chat.png', PNG);
    writeImage(sourceRoot, 'img/order.jpg', JPEG);
    writeImage(sourceRoot, 'img/stray.png', GIF); // on disk, referenced by nothing
    const summary = await runImageInventory(database, {
      sourceRoot, now: Date.UTC(2026, 7, 26), checkpointEvery: 2,
    });

    // An import batch that references two of the three files (unmatched
    // identities are non-critical, so the apply completes).
    const valid: Record<string, string> = {
      '下单日期': '2026-01-10', '客户编号': 'C001', '买家微信': 'wx-inv-a', '店铺名字': '盘点店铺',
      'ASIN': 'B0INV0001', '订单价格': '1980', '订单号': '123-1234567-7000001',
      '聊天截图': 'img/chat.png', '订单截图': 'img/order.jpg', '服务费金额': '25',
      '买家返金金额': '95.5', '卖家返金金额': '90',
    };
    const cells: Record<string, string> = {};
    for (const header of HISTORICAL_CSV_HEADERS) cells[header] = valid[header] ?? '';
    const csv = `${HISTORICAL_CSV_HEADERS.join(',')}\n${HISTORICAL_CSV_HEADERS.map((h) => cells[h]).join(',')}\n`;
    const applied = await runHistoricalImport(database, {
      sourceSystem: 'HISTORICAL_ORDER_CSV',
      files: [{ name: 'master.csv', text: csv }],
    }, { mode: 'APPLY_LOCAL', now: Date.UTC(2026, 7, 26) });
    expect(applied.applied_orders).toBe(1);

    const reconciliation = await reconcileImageInventory(database, {
      inventoryBatchId: summary.batch_id,
      importBatchId: applied.batch_id!,
      outputDir,
      now: Date.UTC(2026, 7, 26),
    });
    expect(reconciliation.linked_files).toBe(2);
    expect(reconciliation.orphan_files).toBe(1);
    expect(reconciliation.quarantined_files).toBe(0);
    expect(reconciliation.duplicate_content_groups).toBe(0);
    const relations = await database.prepare(
      'SELECT relative_path,business_relation,business_order_id,business_purpose FROM historical_image_inventory_files ORDER BY relative_path',
    ).all<{ relative_path: string; business_relation: string; business_order_id: string | null; business_purpose: string | null }>();
    expect(relations.results.find((row) => row.relative_path === 'img/chat.png'))
      .toMatchObject({ business_relation: 'LINKED', business_order_id: '123-1234567-7000001', business_purpose: 'ORDER_EVIDENCE' });
    expect(relations.results.find((row) => row.relative_path === 'img/stray.png'))
      .toMatchObject({ business_relation: 'ORPHAN' });
    // Artifacts exist OUTSIDE the source directory; the source stays clean.
    for (const artifactPath of Object.values(reconciliation.artifacts)) {
      expect(artifactPath.startsWith(outputDir)).toBe(true);
    }
    expect(readFileSync(reconciliation.artifacts.inventory_csv, 'utf8')).toContain('img/chat.png');
    expect(readFileSync(reconciliation.artifacts.inventory_map_jsonl, 'utf8')).toContain('"path":"img/chat.png"');
    const inventoryMap = await buildImageInventoryMap(database, summary.batch_id);
    expect(inventoryMap.get('img/chat.png')).toMatchObject({ mime: 'image/png', byteSize: PNG.byteLength });
    expect(inventoryMap.get('img/chat.png')!.sha256).toBe(await sha256Hex(PNG));
    // Without an import batch everything fail-closes to QUARANTINE.
    const bare = await reconcileImageInventory(database, {
      inventoryBatchId: summary.batch_id, outputDir: path.join(outputDir, 'bare'),
      now: Date.UTC(2026, 7, 27),
    });
    expect(bare.quarantined_files).toBe(3);
    expect(bare.linked_files).toBe(0);
    expect(readFileSync(bare.artifacts.summary_json, 'utf8')).toContain('NO_R2_OR_DRIVE_UPLOAD_EXECUTED');
  });

  it('refuses output directories that overlap the source', async () => {
    database = createMigratedTestDatabase();
    const sourceRoot = tempDir('img-overlap');
    writeImage(sourceRoot, 'a.png', PNG);
    const summary = await runImageInventory(database, { sourceRoot, now: 1 });
    await expect(reconcileImageInventory(database, {
      inventoryBatchId: summary.batch_id,
      outputDir: path.join(sourceRoot, 'out'),
      now: 1,
    })).rejects.toThrow('OUTPUT_DIRECTORY_OVERLAPS_SOURCE');
    await expect(reconcileImageInventory(database, {
      inventoryBatchId: summary.batch_id,
      outputDir: path.dirname(sourceRoot),
      now: 1,
    })).rejects.toThrow('OUTPUT_DIRECTORY_OVERLAPS_SOURCE');
  });

  it('lists only regular files with safe relative paths', async () => {
    const sourceRoot = tempDir('img-list');
    writeImage(sourceRoot, 'a/b/c.png', PNG);
    writeImage(sourceRoot, 'top.png', PNG);
    symlinkSync(path.join(sourceRoot, 'a', 'b', 'c.png'), path.join(sourceRoot, 'dangling-elsewhere'));
    const listing = await listImageDirectory(sourceRoot);
    expect(listing.paths).toEqual(['a/b/c.png', 'top.png']);
    expect(listing.unsafeEntries).toEqual(['dangling-elsewhere']);
  });
});
