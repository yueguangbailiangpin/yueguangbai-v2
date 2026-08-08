import { describe, expect, it } from 'vitest';
import { ObjectStoragePutFailure } from '@ygb/contracts';
import { AnonymousR2Bucket } from '../../test-support/anonymous-r2-binding';
import {
  createR2ObjectStorageAdapter,
  R2ObjectStorageAdapter,
} from './r2-object-storage';

const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

describe('Cloudflare R2 object storage adapter', () => {
  it('round-trips put, HEAD, ranged read, private read and delete', async () => {
    const bucket = new AnonymousR2Bucket();
    const storage = new R2ObjectStorageAdapter(bucket);
    const receipt = await storage.putObject({
      objectKey: 'private/anonymous/file-1',
      bytes,
      contentType: 'image/png',
      metadata: {
        'ygb-file-object-id': 'file-1',
        'ygb-upload-intent-id': 'intent-1',
      },
    });
    expect(receipt).toMatchObject({
      byteSize: bytes.byteLength,
      contentType: 'image/png',
    });
    expect(receipt.checksumSha256).toMatch(/^[0-9a-f]{64}$/u);
    await expect(storage.headObject('private/anonymous/file-1')).resolves
      .toMatchObject({
        objectKey: 'private/anonymous/file-1',
        checksumSha256: receipt.checksumSha256,
        metadata: {
          'ygb-file-object-id': 'file-1',
          'ygb-upload-intent-id': 'intent-1',
        },
      });
    expect([...await storage.readPrefix('private/anonymous/file-1', 8)])
      .toEqual([...bytes.slice(0, 8)]);
    expect([...await storage.readObject('private/anonymous/file-1')])
      .toEqual([...bytes]);
    await storage.deleteObject('private/anonymous/file-1');
    await expect(storage.headObject('private/anonymous/file-1')).resolves.toBeNull();
  });

  it('fails closed for malformed bindings and tampered R2 evidence', async () => {
    expect(createR2ObjectStorageAdapter(null)).toBeNull();
    expect(createR2ObjectStorageAdapter({ put() {} })).toBeNull();
    const bucket = new AnonymousR2Bucket();
    const storage = createR2ObjectStorageAdapter(bucket)!;
    await storage.putObject({
      objectKey: 'private/anonymous/file-2',
      bytes,
      contentType: 'image/png',
      metadata: {
        'ygb-file-object-id': 'file-2',
        'ygb-upload-intent-id': 'intent-2',
      },
    });
    bucket.tamper('private/anonymous/file-2', {
      customMetadata: { 'ygb-sha256': '0'.repeat(64) },
    });
    await expect(storage.headObject('private/anonymous/file-2'))
      .rejects.toThrow('r2_object_checksum_invalid');
  });

  it('propagates binding failures for existing compensation handling', async () => {
    const bucket = new AnonymousR2Bucket();
    const storage = new R2ObjectStorageAdapter(bucket);
    bucket.failNext('put', 'private/anonymous/file-3');
    await expect(storage.putObject({
      objectKey: 'private/anonymous/file-3',
      bytes,
      contentType: 'image/png',
      metadata: {},
    })).rejects.toMatchObject({
      name: 'ObjectStoragePutFailure',
      message: 'r2_put_ambiguous',
      objectMayExist: true,
    });
  });

  it('marks incomplete receipts and post-put failures as possibly stored', async () => {
    for (const [key, arrange] of [
      ['private/anonymous/incomplete', (bucket: AnonymousR2Bucket) => {
        bucket.returnIncompleteNextPutReceipt('private/anonymous/incomplete');
      }],
      ['private/anonymous/ambiguous', (bucket: AnonymousR2Bucket) => {
        bucket.failAfterNextPut('private/anonymous/ambiguous');
      }],
    ] as const) {
      const bucket = new AnonymousR2Bucket();
      const storage = new R2ObjectStorageAdapter(bucket);
      arrange(bucket);
      const failure = await storage.putObject({
        objectKey: key,
        bytes,
        contentType: 'image/png',
        metadata: {},
      }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ObjectStoragePutFailure);
      expect(failure).toMatchObject({ objectMayExist: true });
      expect(bucket.objects.has(key)).toBe(true);
    }
  });
});
