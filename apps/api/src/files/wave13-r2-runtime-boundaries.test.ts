import { afterEach, describe, expect, it } from 'vitest';
import type {
  FileActor,
  FilePurpose,
  FileVisibility,
  ObjectStorageAdapter,
  ObjectStorageHead,
  ObjectStoragePutInput,
  ObjectStoragePutResult,
  SqlDatabase,
  SqlRunResult,
  SqlStatement,
} from '@ygb/contracts';
import { sha256Hex } from '@ygb/domain';
import {
  createMigratedTestDatabase,
  type SqliteDatabase,
} from '@ygb/testkit';
import { resolveAssignmentStaffAuthorization, resolveStaffDataScope } from '../staff-assignment';
import { RouteBoundFileAuthorizationService } from './route-authorization';
import { MockObjectStorage } from './mock-object-storage';
import {
  completeFileUploadIntent,
  createFileUploadIntent,
  uploadFileObject,
} from './index';
import { compensateStoredObjects } from './compensation';
import { onePixelPng } from '../../test-support/wave13-runtime';

let database: SqliteDatabase | null = null;
afterEach(() => {
  database?.close();
  database = null;
});

const activePurposes = [
  ['ORDER_EVIDENCE', 'BUYER_VISIBLE', 'BUYER_CUSTOMER', 'buyer-purpose'],
  ['REVIEW_EVIDENCE', 'SELLER_VISIBLE', 'BUYER_CUSTOMER', 'buyer-review'],
  ['PRODUCT_APPLICATION_IMAGE', 'SELLER_VISIBLE', 'SELLER_MEMBER', 'seller-member'],
  ['BUYER_REFUND_PROOF', 'INTERNAL_ONLY', 'STAFF', 'zz-phase3h-test-owner'],
  ['SELLER_SETTLEMENT_PROOF', 'INTERNAL_ONLY', 'STAFF', 'zz-phase3h-test-owner'],
] as const satisfies readonly [
  FilePurpose,
  FileVisibility,
  FileActor['type'],
  string,
][];

describe('Wave 13 shared R2 failure and purpose matrix', () => {
  it('authorizes and verifies each of the five active Purpose/Visibility pairs', async () => {
    database = createMigratedTestDatabase();
    for (const [purpose, visibility, type, id] of activePurposes) {
      const storage = new MockObjectStorage();
      const actor: FileActor = { type, id, roles: type === 'STAFF' ? ['owner'] : [] };
      const authorization = await routeAuthorization(database, actor, purpose, visibility);
      const result = await completeHappyPath(
        database,
        storage,
        authorization,
        actor,
        purpose,
        visibility,
        `purpose-${purpose.toLowerCase()}`,
      );
      expect(result.status).toBe('VERIFIED');
      expect(result.files).toHaveLength(1);
      expect(result.files[0]).toMatchObject({ purpose, visibility });
    }
  });

  it('covers put failure and receipt mismatch without a linkable orphan', async () => {
    database = createMigratedTestDatabase();
    const actor: FileActor = {
      type: 'STAFF', id: 'zz-phase3h-test-owner', roles: ['owner'],
    };
    const authorization = await routeAuthorization(
      database, actor, 'BUYER_REFUND_PROOF', 'INTERNAL_ONLY',
    );
    const putStorage = new MockObjectStorage();
    const issued = await issue(
      database, authorization, actor,
      'BUYER_REFUND_PROOF', 'INTERNAL_ONLY', 'put-failure',
    );
    const objectKey = await keyFor(database, issued.fileObjectId);
    putStorage.failNext('put', objectKey);
    await expect(uploadFileObject(
      database,
      putStorage,
      authorization,
      {
        fileObjectId: issued.fileObjectId,
        uploadToken: issued.uploadToken,
        declaredMime: 'image/png',
        bytes: onePixelPng(),
      },
      {
        actor,
        idempotencyKey: 'put-failure-upload',
        now: 20_000,
      },
    )).rejects.toMatchObject({ status: 503 });
    expect(await linkCount(database, issued.fileObjectId)).toBe(0);

    const badReceiptStorage = new ReceiptMismatchStorage();
    const receipt = await issue(
      database, authorization, actor,
      'BUYER_REFUND_PROOF', 'INTERNAL_ONLY', 'receipt-mismatch',
    );
    await expect(uploadFileObject(
      database,
      badReceiptStorage,
      authorization,
      {
        fileObjectId: receipt.fileObjectId,
        uploadToken: receipt.uploadToken,
        declaredMime: 'image/png',
        bytes: onePixelPng(),
      },
      {
        actor,
        idempotencyKey: 'receipt-mismatch-upload',
        now: 30_000,
      },
    )).rejects.toMatchObject({ status: 409 });
    expect(await linkCount(database, receipt.fileObjectId)).toBe(0);
  });

  it('covers HEAD failure during completion', async () => {
    database = createMigratedTestDatabase();
    const storage = new MockObjectStorage();
    const actor: FileActor = {
      type: 'STAFF', id: 'zz-phase3h-test-owner', roles: ['owner'],
    };
    const authorization = await routeAuthorization(
      database, actor, 'SELLER_SETTLEMENT_PROOF', 'INTERNAL_ONLY',
    );
    const issued = await issue(
      database, authorization, actor,
      'SELLER_SETTLEMENT_PROOF', 'INTERNAL_ONLY', 'head-failure',
    );
    await uploadFileObject(
      database,
      storage,
      authorization,
      {
        fileObjectId: issued.fileObjectId,
        uploadToken: issued.uploadToken,
        declaredMime: 'image/png',
        bytes: onePixelPng(),
      },
      { actor, idempotencyKey: 'head-failure-upload', now: 40_000 },
    );
    storage.failNext('head', await keyFor(database, issued.fileObjectId));
    await expect(completeFileUploadIntent(
      database,
      storage,
      authorization,
      { uploadIntentId: issued.uploadIntentId, expectedVersion: 1 },
      { actor, idempotencyKey: 'head-failure-complete', now: 41_000 },
    )).rejects.toMatchObject({ status: 503 });
    expect(await linkCount(database, issued.fileObjectId)).toBe(0);
  });

  it('compensates an R2 put when the D1 final commit fails', async () => {
    database = createMigratedTestDatabase();
    const storage = new MockObjectStorage();
    const actor: FileActor = {
      type: 'STAFF', id: 'zz-phase3h-test-owner', roles: ['owner'],
    };
    const authorization = await routeAuthorization(
      database, actor, 'BUYER_REFUND_PROOF', 'INTERNAL_ONLY',
    );
    const issued = await issue(
      database, authorization, actor,
      'BUYER_REFUND_PROOF', 'INTERNAL_ONLY', 'd1-final-failure',
    );
    const failing = new FailNextBatchDatabase(database);
    await expect(uploadFileObject(
      failing,
      storage,
      authorization,
      {
        fileObjectId: issued.fileObjectId,
        uploadToken: issued.uploadToken,
        declaredMime: 'image/png',
        bytes: onePixelPng(),
      },
      { actor, idempotencyKey: 'd1-final-failure-upload', now: 50_000 },
    )).rejects.toMatchObject({ status: 503 });
    const key = await keyFor(database, issued.fileObjectId);
    expect(storage.objects.has(key)).toBe(false);
    expect(await statusFor(database, issued.fileObjectId)).toBe('DELETED');
    expect(await linkCount(database, issued.fileObjectId)).toBe(0);
  });

  it('records delete pending, hides storage authority, and retries cleanup to DELETED', async () => {
    database = createMigratedTestDatabase();
    const storage = new MockObjectStorage();
    const actor: FileActor = {
      type: 'STAFF', id: 'zz-phase3h-test-owner', roles: ['owner'],
    };
    const authorization = await routeAuthorization(
      database, actor, 'SELLER_SETTLEMENT_PROOF', 'INTERNAL_ONLY',
    );
    const issued = await issue(
      database, authorization, actor,
      'SELLER_SETTLEMENT_PROOF', 'INTERNAL_ONLY', 'delete-pending',
    );
    const key = await keyFor(database, issued.fileObjectId);
    storage.failNext('delete', key);
    const failing = new FailNextBatchDatabase(database);
    let captured: unknown;
    try {
      await uploadFileObject(
        failing,
        storage,
        authorization,
        {
          fileObjectId: issued.fileObjectId,
          uploadToken: issued.uploadToken,
          declaredMime: 'image/png',
          bytes: onePixelPng(),
        },
        { actor, idempotencyKey: 'delete-pending-upload', now: 60_000 },
      );
    } catch (error) {
      captured = error;
    }
    expect(captured).toMatchObject({
      code: 'FILE_COMPENSATION_REQUIRED',
      status: 503,
    });
    expect(JSON.stringify(captured)).not.toContain(key);
    expect(JSON.stringify(captured)).not.toContain('object_key');
    expect(await statusFor(database, issued.fileObjectId)).toBe('DELETION_PENDING');

    const bytes = onePixelPng();
    await compensateStoredObjects(database, storage, {
      uploadIntentId: issued.uploadIntentId,
      objects: [{
        fileObjectId: issued.fileObjectId,
        objectKey: key,
        byteSize: bytes.byteLength,
        detectedMime: 'image/png',
        sha256: await sha256Hex(bytes),
      }],
      reason: 'CLEANUP_RETRY',
      actor,
      idempotencyKey: null,
      now: 60_000 + 5 * 60 * 1000,
    });
    expect(await statusFor(database, issued.fileObjectId)).toBe('DELETED');
    expect(storage.objects.has(key)).toBe(false);
  });
});

async function completeHappyPath(
  target: SqlDatabase,
  storage: ObjectStorageAdapter,
  authorization: RouteBoundFileAuthorizationService,
  actor: FileActor,
  purpose: FilePurpose,
  visibility: FileVisibility,
  key: string,
) {
  const issued = await issue(
    target, authorization, actor, purpose, visibility, key,
  );
  await uploadFileObject(target, storage, authorization, {
    fileObjectId: issued.fileObjectId,
    uploadToken: issued.uploadToken,
    declaredMime: 'image/png',
    bytes: onePixelPng(),
  }, {
    actor,
    idempotencyKey: `${key}-upload`,
    now: 10_000,
  });
  return completeFileUploadIntent(target, storage, authorization, {
    uploadIntentId: issued.uploadIntentId,
    expectedVersion: 1,
  }, {
    actor,
    idempotencyKey: `${key}-complete`,
    now: 11_000,
  });
}

async function issue(
  target: SqlDatabase,
  authorization: RouteBoundFileAuthorizationService,
  actor: FileActor,
  purpose: FilePurpose,
  visibility: FileVisibility,
  key: string,
) {
  const bytes = onePixelPng();
  const result = await createFileUploadIntent(target, authorization, {
    purpose,
    visibility,
    files: [{
      clientFileName: `${key}.png`,
      declaredMime: 'image/png',
      byteSize: bytes.byteLength,
    }],
  }, {
    actor,
    idempotencyKey: `${key}-intent`,
    now: 1_000,
  });
  return {
    uploadIntentId: result.uploadIntentId,
    fileObjectId: result.uploads[0]!.fileObjectId,
    uploadToken: result.uploads[0]!.uploadToken!,
  };
}

async function routeAuthorization(
  target: SqlDatabase,
  actor: FileActor,
  purpose: FilePurpose,
  visibility: FileVisibility,
) {
  if (actor.type !== 'STAFF') {
    return new RouteBoundFileAuthorizationService(
      target,
      actor,
      new Map([[purpose, visibility]]),
      actor.type === 'BUYER_CUSTOMER'
        ? { type: 'BUYER_SESSION', accountId: actor.id, identitySubjectId: actor.id }
        : { type: 'SELLER_SESSION', accountId: actor.id, identitySubjectId: actor.id },
    );
  }
  const staff = await resolveAssignmentStaffAuthorization(target, actor.id);
  if (!staff) throw new Error('staff_fixture_missing');
  const scope = await resolveStaffDataScope(target, staff);
  return new RouteBoundFileAuthorizationService(
    target,
    actor,
    new Map([[purpose, visibility]]),
    { type: 'STAFF_SESSION', staffId: actor.id },
    staff,
    scope,
  );
}

async function keyFor(target: SqlDatabase, fileObjectId: string): Promise<string> {
  const row = await target.prepare(`
    SELECT object_key FROM file_objects WHERE id=?
  `).bind(fileObjectId).first<{ object_key: string }>();
  if (!row) throw new Error('file_object_missing');
  return row.object_key;
}

async function statusFor(target: SqlDatabase, fileObjectId: string): Promise<string> {
  const row = await target.prepare(`
    SELECT status FROM file_objects WHERE id=?
  `).bind(fileObjectId).first<{ status: string }>();
  return row?.status ?? 'MISSING';
}

async function linkCount(target: SqlDatabase, fileObjectId: string): Promise<number> {
  const row = await target.prepare(`
    SELECT COUNT(*) AS count FROM file_entity_links WHERE file_object_id=?
  `).bind(fileObjectId).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

class FailNextBatchDatabase implements SqlDatabase {
  private fail = true;
  constructor(private readonly target: SqlDatabase) {}
  prepare(sql: string): SqlStatement { return this.target.prepare(sql); }
  batch(statements: readonly SqlStatement[]): Promise<SqlRunResult[]> {
    if (this.fail) {
      this.fail = false;
      return Promise.reject(new Error('injected_d1_final_commit_failure'));
    }
    return this.target.batch(statements);
  }
}

class ReceiptMismatchStorage implements ObjectStorageAdapter {
  private readonly target = new MockObjectStorage();
  async putObject(input: ObjectStoragePutInput): Promise<ObjectStoragePutResult> {
    const result = await this.target.putObject(input);
    return { ...result, byteSize: result.byteSize + 1 };
  }
  headObject(key: string): Promise<ObjectStorageHead | null> {
    return this.target.headObject(key);
  }
  readObject(key: string): Promise<Uint8Array<ArrayBuffer>> {
    return this.target.readObject(key);
  }
  deleteObject(key: string): Promise<void> {
    return this.target.deleteObject(key);
  }
  listObjectKeys(prefix: string): Promise<readonly string[]> {
    return this.target.listObjectKeys(prefix);
  }
}
