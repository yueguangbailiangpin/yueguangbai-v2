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
  FileAuthorizationResource,
  FileAuthorizationService,
} from './authorization';
import { completeFileUploadIntent } from './complete-upload-intent';
import { createFileUploadIntent } from './create-upload-intent';
import { linkVerifiedFileToEntity } from './file-entity-links';
import {
  consumeFileReadIntent,
  createFileReadIntent,
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
    expect(JSON.stringify(readIntent)).not.toContain('url');

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
    expect(read.bytes).toEqual(png);
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
