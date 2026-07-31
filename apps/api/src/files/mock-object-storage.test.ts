import { describe, expect, it } from 'vitest';
import { MockObjectStorage } from './mock-object-storage';

const bytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47,
  0x0d, 0x0a, 0x1a, 0x0a,
  0x01, 0x02,
]);

describe('MockObjectStorage', () => {
  it('computes trusted metadata, returns copies, and deletes objects', async () => {
    const storage = new MockObjectStorage();
    const result = await storage.putObject({
      objectKey: 'files/v1/2026/07/order-evidence/abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
      bytes,
      contentType: 'image/png',
      metadata: {
        'ygb-file-object-id': 'file-1',
        'ygb-upload-intent-id': 'intent-1',
      },
    });
    expect(result.checksumSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect((await storage.headObject(
      'files/v1/2026/07/order-evidence/abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    ))?.metadata['ygb-file-object-id']).toBe('file-1');
    const read = await storage.readObject(
      'files/v1/2026/07/order-evidence/abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    );
    read[0] = 0;
    expect((await storage.readPrefix(
      'files/v1/2026/07/order-evidence/abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
      1,
    ))[0]).toBe(0x89);
    await storage.deleteObject(
      'files/v1/2026/07/order-evidence/abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    );
    expect(await storage.headObject(
      'files/v1/2026/07/order-evidence/abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    )).toBeNull();
  });

  it('supports deterministic failure injection without exposing bytes', async () => {
    const storage = new MockObjectStorage();
    const key = 'files/v1/2026/07/order-evidence/abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
    storage.failNext('put', key);
    await expect(storage.putObject({
      objectKey: key,
      bytes,
      contentType: 'image/png',
      metadata: {},
    })).rejects.toThrow('mock_storage_put_failed');
    expect(storage.objects.size).toBe(0);
  });
});
