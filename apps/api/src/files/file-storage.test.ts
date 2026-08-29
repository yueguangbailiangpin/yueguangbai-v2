import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest';
import type {
  FileActor,
  SqlDatabase,
  SqlRunResult,
  SqlStatement,
} from '@ygb/contracts';
import {
  createMigratedTestDatabase,
  type SqliteDatabase,
} from '@ygb/testkit';
import type {
  FileAuthorizationService,
} from './authorization';
import { completeFileUploadIntent } from './complete-upload-intent';
import { createFileUploadIntent } from './create-upload-intent';
import { linkVerifiedFileToEntity } from './file-entity-links';
import {
  consumeFileReadIntent,
  createFileReadIntent,
  createFileReadIntentsBatch,
} from './file-read-service';
import { MockObjectStorage } from './mock-object-storage';
import { uploadFileObject } from './upload-file-object';

const png = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47,
  0x0d, 0x0a, 0x1a, 0x0a,
  0x01, 0x02, 0x03,
]);
const actor: FileActor = {
  type: 'STAFF',
  id: 'staff-file-test',
  roles: ['owner'],
};
const authorization: FileAuthorizationService = {
  assertCanCreateUpload: () => {},
  assertCanUpload: () => {},
  assertCanCompleteUpload: () => {},
  assertCanLink: () => {},
  assertCanRead: () => {},
};
let database: SqliteDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe('file manifest and upload intent lifecycle', () => {
  it('verifies before linking, issues no permanent URL, and consumes a short read intent once', async () => {
    database = createMigratedTestDatabase();
    const storage = new MockObjectStorage();
    const intent = await createFileUploadIntent(
      database,
      authorization,
      {
        purpose: 'ORDER_EVIDENCE',
        visibility: 'SELLER_VISIBLE',
        files: [{
          clientFileName: 'evidence.png',
          declaredMime: 'image/png',
          byteSize: png.byteLength,
        }],
      },
      {
        actor,
        idempotencyKey: 'file:intent:0001',
        now: 1000,
      },
    );
    const slot = intent.uploads[0];
    if (!slot?.uploadToken) throw new Error('missing_upload_token');

    const replay = await createFileUploadIntent(
      database,
      authorization,
      {
        purpose: 'ORDER_EVIDENCE',
        visibility: 'SELLER_VISIBLE',
        files: [{
          clientFileName: 'evidence.png',
          declaredMime: 'image/png',
          byteSize: png.byteLength,
        }],
      },
      {
        actor,
        idempotencyKey: 'file:intent:0001',
        now: 1100,
      },
    );
    expect(replay.uploads[0]?.uploadTokenAvailable).toBe(false);
    expect(replay.uploads[0]?.uploadToken).toBeNull();

    await expect(linkVerifiedFileToEntity(
      database,
      authorization,
      {
        fileObjectId: slot.fileObjectId,
        expectedFileVersion: 1,
        entityType: 'ORDER',
        entityId: 'order-before-verification',
      },
      {
        actor,
        idempotencyKey: 'file:link:blocked',
        now: 1200,
      },
    )).rejects.toMatchObject({ code: 'FILE_NOT_VERIFIED' });

    const uploaded = await uploadFileObject(
      database,
      storage,
      authorization,
      {
        fileObjectId: slot.fileObjectId,
        uploadToken: slot.uploadToken,
        declaredMime: 'image/png',
        bytes: png,
      },
      {
        actor,
        idempotencyKey: 'file:upload:0001',
        now: 1300,
      },
    );
    expect(uploaded.status).toBe('UPLOADED');
    const uploadedReplay = await uploadFileObject(
      database,
      storage,
      authorization,
      {
        fileObjectId: slot.fileObjectId,
        uploadToken: slot.uploadToken,
        declaredMime: 'image/png',
        bytes: png,
      },
      {
        actor,
        idempotencyKey: 'file:upload:0001',
        now: 1350,
      },
    );
    expect(uploadedReplay.replayed).toBe(true);

    const verified = await completeFileUploadIntent(
      database,
      storage,
      authorization,
      {
        uploadIntentId: intent.uploadIntentId,
        expectedVersion: 1,
      },
      {
        actor,
        idempotencyKey: 'file:complete:0001',
        now: 1400,
      },
    );
    expect(verified.files[0]).toMatchObject({
      status: 'VERIFIED',
      detectedMime: 'image/png',
      verifiedByteSize: png.byteLength,
    });
    expect(JSON.stringify(verified)).not.toContain('object_key');
    expect(JSON.stringify(verified)).not.toContain('http');
    const verifiedReplay = await completeFileUploadIntent(
      database,
      storage,
      authorization,
      {
        uploadIntentId: intent.uploadIntentId,
        expectedVersion: 1,
      },
      {
        actor,
        idempotencyKey: 'file:complete:0001',
        now: 1450,
      },
    );
    expect(verifiedReplay.replayed).toBe(true);

    const linked = await linkVerifiedFileToEntity(
      database,
      authorization,
      {
        fileObjectId: slot.fileObjectId,
        expectedFileVersion: 3,
        entityType: 'ORDER',
        entityId: 'order-1',
      },
      {
        actor,
        idempotencyKey: 'file:link:0001',
        now: 1500,
      },
    );
    expect(linked.entityId).toBe('order-1');

    const readIntent = await createFileReadIntent(
      database,
      authorization,
      {
        fileObjectId: slot.fileObjectId,
        expectedFileVersion: 3,
        ttlMs: 60_000,
      },
      {
        actor,
        idempotencyKey: 'file:read:0001',
        now: 1600,
      },
    );
    if (!readIntent.accessToken) throw new Error('missing_read_token');
    expect(readIntent).not.toHaveProperty('url');
    expect(readIntent).not.toHaveProperty('permanentUrl');
    expect(readIntent).not.toHaveProperty('permanent_url');
    expect(Object.keys(readIntent).sort()).toEqual([
      'accessToken',
      'accessTokenAvailable',
      'expiresAt',
      'fileObjectId',
      'readIntentId',
      'replayed',
    ]);

    const read = await consumeFileReadIntent(
      database,
      storage,
      authorization,
      {
        readIntentId: readIntent.readIntentId,
        accessToken: readIntent.accessToken,
      },
      { actor, now: 1700 },
    );
    expect(read.byteSize).toBe(png.byteLength);
    expect(read.bytes ?? new Uint8Array(await new Response(read.stream!).arrayBuffer()))
      .toEqual(png);
    await expect(consumeFileReadIntent(
      database,
      storage,
      authorization,
      {
        readIntentId: readIntent.readIntentId,
        accessToken: readIntent.accessToken,
      },
      { actor, now: 1800 },
    )).rejects.toMatchObject({ code: 'FILE_UPLOAD_EXPIRED' });

    const eventCount = await database.prepare(`
      SELECT COUNT(*) AS count
      FROM file_events
    `).first<{ count: number }>();
    expect(Number(eventCount?.count)).toBeGreaterThanOrEqual(5);
    await expect(database.prepare(`
      DELETE FROM file_events
    `).run()).rejects.toThrow('file_events_are_immutable');
  });

  it('deletes storage objects when HEAD metadata verification fails', async () => {
    database = createMigratedTestDatabase();
    const storage = new MockObjectStorage();
    const { intent, slot } = await uploadedFixture(database, storage, '0002');
    const object = await database.prepare(`
      SELECT object_key
      FROM file_objects
      WHERE id=?
    `).bind(slot.fileObjectId).first<{ object_key: string }>();
    if (!object) throw new Error('missing_object');
    storage.tamperHead(object.object_key, {
      checksumSha256: '0'.repeat(64),
    });

    await expect(completeFileUploadIntent(
      database,
      storage,
      authorization,
      {
        uploadIntentId: intent.uploadIntentId,
        expectedVersion: 1,
      },
      {
        actor,
        idempotencyKey: 'file:complete:0002',
        now: 2000,
      },
    )).rejects.toMatchObject({ code: 'FILE_STORAGE_CONFLICT' });

    expect(await storage.headObject(object.object_key)).toBeNull();
    const state = await database.prepare(`
      SELECT intent.status AS intent_status, object.status AS object_status
      FROM file_upload_intents intent
      JOIN file_objects object ON object.upload_intent_id=intent.id
      WHERE intent.id=?
    `).bind(intent.uploadIntentId).first<{
      intent_status: string;
      object_status: string;
    }>();
    expect(state).toEqual({
      intent_status: 'FAILED',
      object_status: 'DELETED',
    });
  });

  it('returns a deletion plan if compensation delete fails', async () => {
    database = createMigratedTestDatabase();
    const storage = new MockObjectStorage();
    const { intent, slot } = await uploadedFixture(database, storage, '0003');
    const object = await database.prepare(`
      SELECT object_key
      FROM file_objects
      WHERE id=?
    `).bind(slot.fileObjectId).first<{ object_key: string }>();
    if (!object) throw new Error('missing_object');
    storage.tamperHead(object.object_key, {
      byteSize: png.byteLength + 1,
    });
    storage.failNext('delete', object.object_key);

    await expect(completeFileUploadIntent(
      database,
      storage,
      authorization,
      {
        uploadIntentId: intent.uploadIntentId,
        expectedVersion: 1,
      },
      {
        actor,
        idempotencyKey: 'file:complete:0003',
        now: 2000,
      },
    )).rejects.toMatchObject({
      code: 'FILE_COMPENSATION_REQUIRED',
      compensation: {
        uploadIntentId: intent.uploadIntentId,
        deletePendingObjectIds: [slot.fileObjectId],
      },
    });
  });

  it('deletes a just-written object when the D1 manifest update fails', async () => {
    database = createMigratedTestDatabase();
    const storage = new MockObjectStorage();
    const intent = await createFileUploadIntent(
      database,
      authorization,
      {
        purpose: 'ORDER_EVIDENCE',
        visibility: 'INTERNAL_ONLY',
        files: [{
          clientFileName: 'evidence.png',
          declaredMime: 'image/png',
          byteSize: png.byteLength,
        }],
      },
      {
        actor,
        idempotencyKey: 'file:intent:0004',
        now: 1000,
      },
    );
    const slot = intent.uploads[0];
    if (!slot?.uploadToken) throw new Error('missing_upload_token');
    const failing = new FailNextBatchDatabase(database);
    failing.failNextBatch = true;

    await expect(uploadFileObject(
      failing,
      storage,
      authorization,
      {
        fileObjectId: slot.fileObjectId,
        uploadToken: slot.uploadToken,
        declaredMime: 'image/png',
        bytes: png,
      },
      {
        actor,
        idempotencyKey: 'file:upload:0004',
        now: 1300,
      },
    )).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
    expect(storage.objects.size).toBe(0);
  });

  it('returns bytes to exactly one concurrent read-intent consumer', async () => {
    database = createMigratedTestDatabase();
    const storage = new CoordinatedReadStorage();
    const { intent, slot } = await uploadedFixture(database, storage, 'race');
    await completeFileUploadIntent(
      database,
      storage,
      { ...authorization },
      { uploadIntentId: intent.uploadIntentId, expectedVersion: 1 },
      { actor, idempotencyKey: 'file:complete:race', now: 1400 },
    );
    await linkVerifiedFileToEntity(
      database,
      authorization,
      {
        fileObjectId: slot.fileObjectId,
        expectedFileVersion: 3,
        entityType: 'ORDER',
        entityId: 'order-race',
      },
      { actor, idempotencyKey: 'file:link:race', now: 1500 },
    );
    const readIntent = await createFileReadIntent(
      database,
      authorization,
      {
        fileObjectId: slot.fileObjectId,
        expectedFileVersion: 3,
        ttlMs: 60_000,
      },
      { actor, idempotencyKey: 'file:read:race', now: 1600 },
    );
    if (!readIntent.accessToken) throw new Error('missing_read_token');

    const input = {
      readIntentId: readIntent.readIntentId,
      accessToken: readIntent.accessToken,
    };
    const results = await Promise.allSettled([
      consumeFileReadIntent(
        database, storage, authorization, input, { actor, now: 1700 },
      ),
      consumeFileReadIntent(
        database, storage, authorization, input, { actor, now: 1700 },
      ),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled'))
      .toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected'))
      .toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected'))
      .toMatchObject({
        reason: expect.objectContaining({ code: 'VERSION_CONFLICT' }),
      });
    expect(await database.prepare(`
      SELECT COUNT(*) AS count FROM file_events
      WHERE event_type='FILE_READ_INTENT_CONSUMED'
        AND json_extract(metadata_json, '$.read_intent_id')=?
    `).bind(readIntent.readIntentId).first()).toEqual({ count: 1 });
  });
});

async function uploadedFixture(
  db: SqlDatabase,
  storage: MockObjectStorage,
  suffix: string,
) {
  const intent = await createFileUploadIntent(
    db,
    authorization,
    {
      purpose: 'ORDER_EVIDENCE',
      visibility: 'INTERNAL_ONLY',
      files: [{
        clientFileName: 'evidence.png',
        declaredMime: 'image/png',
        byteSize: png.byteLength,
      }],
    },
    {
      actor,
      idempotencyKey: `file:intent:${suffix}`,
      now: 1000,
    },
  );
  const slot = intent.uploads[0];
  if (!slot?.uploadToken) throw new Error('missing_upload_token');
  await uploadFileObject(
    db,
    storage,
    authorization,
    {
      fileObjectId: slot.fileObjectId,
      uploadToken: slot.uploadToken,
      declaredMime: 'image/png',
      bytes: png,
    },
    {
      actor,
      idempotencyKey: `file:upload:${suffix}`,
      now: 1300,
    },
  );
  return { intent, slot };
}


class FailNextBatchDatabase implements SqlDatabase {
  failNextBatch = false;
  constructor(private readonly delegate: SqlDatabase) {}
  prepare(sql: string): SqlStatement {
    return this.delegate.prepare(sql);
  }
  async batch(statements: readonly SqlStatement[]): Promise<SqlRunResult[]> {
    if (this.failNextBatch) {
      this.failNextBatch = false;
      throw new Error('injected_d1_batch_failure');
    }
    return this.delegate.batch(statements);
  }
}

class CoordinatedReadStorage extends MockObjectStorage {
  private readers = 0;
  private release!: () => void;
  private readonly gate = new Promise<void>((resolve) => {
    this.release = resolve;
  });

  override async readObject(
    objectKey: string,
  ): Promise<Uint8Array<ArrayBuffer>> {
    this.readers += 1;
    if (this.readers === 2) this.release();
    await this.gate;
    return super.readObject(objectKey);
  }
}

describe('batch file read intents', () => {
  async function seedVerifiedFile(
    label: string,
    now: number,
  ): Promise<{ fileObjectId: string; uploadToken: string; uploadIntentId: string }> {
    const storage = new MockObjectStorage();
    const intent = await createFileUploadIntent(
      database!,
      authorization,
      {
        purpose: 'ORDER_EVIDENCE',
        visibility: 'SELLER_VISIBLE',
        files: [{
          clientFileName: `${label}.png`,
          declaredMime: 'image/png',
          byteSize: png.byteLength,
        }],
      },
      { actor, idempotencyKey: `file:batch:${label}:intent`, now },
    );
    const slot = intent.uploads[0];
    if (!slot?.uploadToken) throw new Error('missing_upload_token');
    await uploadFileObject(
      database!,
      storage,
      authorization,
      {
        fileObjectId: slot.fileObjectId,
        uploadToken: slot.uploadToken,
        declaredMime: 'image/png',
        bytes: png,
      },
      { actor, idempotencyKey: `file:batch:${label}:upload`, now: now + 100 },
    );
    await completeFileUploadIntent(
      database!,
      storage,
      authorization,
      {
        uploadIntentId: intent.uploadIntentId,
        expectedVersion: 1,
      },
      { actor, idempotencyKey: `file:batch:${label}:complete`, now: now + 200 },
    );
    await linkVerifiedFileToEntity(
      database!,
      authorization,
      {
        fileObjectId: slot.fileObjectId,
        expectedFileVersion: 3,
        entityType: 'ORDER',
        entityId: `order-${label}`,
      },
      { actor, idempotencyKey: `file:batch:${label}:link`, now: now + 300 },
    );
    return {
      fileObjectId: slot.fileObjectId,
      uploadToken: slot.uploadToken,
      uploadIntentId: intent.uploadIntentId,
    };
  }

  it('issues intents for several files atomically and replays per item', async () => {
    database = createMigratedTestDatabase();
    const first = await seedVerifiedFile('one', 1000);
    const second = await seedVerifiedFile('two', 2000);

    const batch = await createFileReadIntentsBatch(
      database,
      authorization,
      {
        requests: [
          { fileObjectId: first.fileObjectId, expectedFileVersion: 3 },
          { fileObjectId: second.fileObjectId, expectedFileVersion: 3 },
        ],
        idempotencyKeys: ['file:batch:read:one', 'file:batch:read:two'],
      },
      { actor, now: 3000 },
    );
    expect(batch.intents).toHaveLength(2);
    expect(new Set(batch.intents.map((item) => item.fileObjectId)).size).toBe(2);
    for (const item of batch.intents) {
      expect(item.accessTokenAvailable).toBe(true);
      expect(item.accessToken).toBeTruthy();
      expect(item.replayed).toBe(false);
    }

    const rows = await database!.prepare(`
      SELECT COUNT(*) AS count FROM file_read_intents
      WHERE status='ISSUED'
    `).first<{ count: number }>();
    expect(Number(rows?.count)).toBe(2);

    const replay = await createFileReadIntentsBatch(
      database,
      authorization,
      {
        requests: [
          { fileObjectId: first.fileObjectId, expectedFileVersion: 3 },
          { fileObjectId: second.fileObjectId, expectedFileVersion: 3 },
        ],
        idempotencyKeys: ['file:batch:read:one', 'file:batch:read:two'],
      },
      { actor, now: 3100 },
    );
    expect(replay.intents).toHaveLength(2);
    for (const item of replay.intents) {
      expect(item.replayed).toBe(true);
      expect(item.accessTokenAvailable).toBe(false);
      expect(item.accessToken).toBeNull();
    }
    const rowsAfterReplay = await database!.prepare(`
      SELECT COUNT(*) AS count FROM file_read_intents
    `).first<{ count: number }>();
    expect(Number(rowsAfterReplay?.count)).toBe(2);

    await expect(createFileReadIntentsBatch(
      database,
      authorization,
      {
        requests: [
          { fileObjectId: first.fileObjectId, expectedFileVersion: 4 },
        ],
        idempotencyKeys: ['file:batch:read:stale'],
      },
      { actor, now: 3200 },
    )).rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 });

    await expect(createFileReadIntentsBatch(
      database,
      authorization,
      {
        requests: [
          { fileObjectId: first.fileObjectId, expectedFileVersion: 3 },
          { fileObjectId: first.fileObjectId, expectedFileVersion: 3 },
        ],
        idempotencyKeys: ['file:batch:read:dup:one', 'file:batch:read:dup:two'],
      },
      { actor, now: 3300 },
    )).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
  });
});

describe('streaming read intent consumption', () => {
  async function seedStreamingFile(
    label: string,
  ): Promise<{ storage: MockObjectStorage; fileObjectId: string }> {
    const storage = new MockObjectStorage();
    const intent = await createFileUploadIntent(
      database!,
      authorization,
      {
        purpose: 'ORDER_EVIDENCE',
        visibility: 'SELLER_VISIBLE',
        files: [{
          clientFileName: `${label}.png`,
          declaredMime: 'image/png',
          byteSize: png.byteLength,
        }],
      },
      { actor, idempotencyKey: `file:stream:${label}:intent`, now: 1000 },
    );
    const slot = intent.uploads[0];
    if (!slot?.uploadToken) throw new Error('missing_upload_token');
    await uploadFileObject(
      database!,
      storage,
      authorization,
      {
        fileObjectId: slot.fileObjectId,
        uploadToken: slot.uploadToken,
        declaredMime: 'image/png',
        bytes: png,
      },
      { actor, idempotencyKey: `file:stream:${label}:upload`, now: 1100 },
    );
    await completeFileUploadIntent(
      database!,
      storage,
      authorization,
      {
        uploadIntentId: intent.uploadIntentId,
        expectedVersion: 1,
      },
      { actor, idempotencyKey: `file:stream:${label}:complete`, now: 1200 },
    );
    await linkVerifiedFileToEntity(
      database!,
      authorization,
      {
        fileObjectId: slot.fileObjectId,
        expectedFileVersion: 3,
        entityType: 'ORDER',
        entityId: `order-stream-${label}`,
      },
      { actor, idempotencyKey: `file:stream:${label}:link`, now: 1250 },
    );
    return { storage, fileObjectId: slot.fileObjectId };
  }

  async function streamingReadIntent(
    fileObjectId: string,
    label: string,
  ) {
    return createFileReadIntent(
      database!,
      authorization,
      {
        fileObjectId,
        expectedFileVersion: 3,
        ttlMs: 60_000,
      },
      { actor, idempotencyKey: `file:stream:${label}:read`, now: 1300 },
    );
  }

  it('streams the stored body through the adapter without buffering in the Worker', async () => {
    database = createMigratedTestDatabase();
    const { storage, fileObjectId } = await seedStreamingFile('body');
    const readIntent = await streamingReadIntent(fileObjectId, 'body');
    if (!readIntent.accessToken) throw new Error('missing_read_token');

    const result = await consumeFileReadIntent(
      database!,
      storage,
      authorization,
      { readIntentId: readIntent.readIntentId, accessToken: readIntent.accessToken },
      { actor, now: 1400 },
    );
    expect(result.bytes).toBeUndefined();
    expect(result.stream).toBeInstanceOf(ReadableStream);
    expect(result.byteSize).toBe(png.byteLength);
    expect(result.contentType).toBe('image/png');
    const streamed = new Uint8Array(
      await new Response(result.stream!).arrayBuffer(),
    );
    expect(streamed).toEqual(png);
  });

  it('rejects a tampered stored checksum with the same conflict semantics', async () => {
    database = createMigratedTestDatabase();
    const { storage, fileObjectId } = await seedStreamingFile('tamper');
    const readIntent = await streamingReadIntent(fileObjectId, 'tamper');
    if (!readIntent.accessToken) throw new Error('missing_read_token');
    const objectKey = await database!
      .prepare('SELECT object_key FROM file_objects WHERE id=?')
      .bind(fileObjectId)
      .first<{ object_key: string }>();
    storage.tamperHead(objectKey!.object_key, {
      checksumSha256: '0'.repeat(64),
    });

    await expect(consumeFileReadIntent(
      database!,
      storage,
      authorization,
      { readIntentId: readIntent.readIntentId, accessToken: readIntent.accessToken },
      { actor, now: 1400 },
    )).rejects.toMatchObject({ code: 'FILE_STORAGE_CONFLICT' });
    const status = await database!
      .prepare('SELECT status FROM file_read_intents WHERE id=?')
      .bind(readIntent.readIntentId)
      .first<{ status: string }>();
    expect(status?.status).toBe('ISSUED');
  });

  it('falls back to the buffered read when the adapter has no streaming variant', async () => {
    database = createMigratedTestDatabase();
    const { storage, fileObjectId } = await seedStreamingFile('legacy');
    const legacyStorage: import('@ygb/contracts').ObjectStorageAdapter = {
      putObject: (input) => storage.putObject(input),
      headObject: (key) => storage.headObject(key),
      readPrefix: (key, maximum) => storage.readPrefix(key, maximum),
      readObject: (key) => storage.readObject(key),
      deleteObject: (key) => storage.deleteObject(key),
    };
    const readIntent = await streamingReadIntent(fileObjectId, 'legacy');
    if (!readIntent.accessToken) throw new Error('missing_read_token');

    const result = await consumeFileReadIntent(
      database!,
      legacyStorage,
      authorization,
      { readIntentId: readIntent.readIntentId, accessToken: readIntent.accessToken },
      { actor, now: 1400 },
    );
    expect(result.stream).toBeUndefined();
    expect(result.bytes).toEqual(png);
    expect(result.byteSize).toBe(png.byteLength);
  });
});
