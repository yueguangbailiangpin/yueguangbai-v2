import type {
  ObjectStorageAdapter,
  ObjectStorageHead,
  ObjectStoragePutInput,
  ObjectStoragePutResult,
  ObjectStorageStream,
} from '@ygb/contracts';
import { sha256Hex } from '@ygb/domain';

interface StoredMockObject {
  bytes: Uint8Array<ArrayBuffer>;
  head: ObjectStorageHead;
}

type FailureOperation = 'put' | 'head' | 'prefix' | 'read' | 'delete';

export class MockObjectStorage implements ObjectStorageAdapter {
  readonly objects = new Map<string, StoredMockObject>();
  private readonly failures = new Set<string>();

  failNext(operation: FailureOperation, objectKey: string): void {
    this.failures.add(`${operation}:${objectKey}`);
  }

  async putObject(
    input: ObjectStoragePutInput,
  ): Promise<ObjectStoragePutResult> {
    this.consumeFailure('put', input.objectKey);
    const bytes = copyBytes(input.bytes);
    const checksumSha256 = await sha256Hex(bytes);
    const result: ObjectStoragePutResult = Object.freeze({
      etag: `mock-${checksumSha256.slice(0, 32)}`,
      byteSize: bytes.byteLength,
      contentType: input.contentType,
      checksumSha256,
    });
    const head: ObjectStorageHead = Object.freeze({
      objectKey: input.objectKey,
      ...result,
      metadata: Object.freeze({ ...input.metadata }),
    });
    this.objects.set(input.objectKey, { bytes, head });
    return result;
  }

  async putObjectStream(input: {
    objectKey: string;
    contentType: ObjectStoragePutInput['contentType'] | 'application/zip';
    metadata: Readonly<Record<string, string>>;
    body: ReadableStream<Uint8Array>;
  }): Promise<Omit<ObjectStoragePutResult, 'checksumSha256'> & { checksumSha256: string }> {
    this.consumeFailure('put', input.objectKey);
    const chunks: Uint8Array[] = [];
    const reader = input.body.getReader();
    let byteSize = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength === 0) continue;
      chunks.push(value);
      byteSize += value.byteLength;
    }
    const bytes = new Uint8Array(new ArrayBuffer(byteSize));
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const checksumSha256 = await sha256Hex(bytes);
    const head: ObjectStorageHead = Object.freeze({
      objectKey: input.objectKey,
      etag: `mock-${checksumSha256.slice(0, 32)}`,
      byteSize,
      contentType: input.contentType as ObjectStoragePutInput['contentType'],
      checksumSha256,
      metadata: Object.freeze({ ...input.metadata }),
    });
    this.objects.set(input.objectKey, { bytes, head });
    return {
      etag: head.etag,
      byteSize,
      contentType: input.contentType as ObjectStoragePutResult['contentType'],
      checksumSha256,
    };
  }

  async headObject(objectKey: string): Promise<ObjectStorageHead | null> {
    this.consumeFailure('head', objectKey);
    return this.objects.get(objectKey)?.head ?? null;
  }

  async readPrefix(
    objectKey: string,
    maximumBytes: number,
  ): Promise<Uint8Array<ArrayBuffer>> {
    this.consumeFailure('prefix', objectKey);
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
      throw new Error('invalid_prefix_length');
    }
    const stored = this.requireObject(objectKey);
    return copyBytes(stored.bytes.slice(0, maximumBytes));
  }

  async readObject(objectKey: string): Promise<Uint8Array<ArrayBuffer>> {
    this.consumeFailure('read', objectKey);
    return copyBytes(this.requireObject(objectKey).bytes);
  }

  async openObjectStream(
    objectKey: string,
  ): Promise<ObjectStorageStream | null> {
    this.consumeFailure('read', objectKey);
    const stored = this.objects.get(objectKey);
    if (!stored) return null;
    const body = new Response(stored.bytes).body;
    if (body === null) return null;
    return { head: stored.head, body };
  }

  async deleteObject(objectKey: string): Promise<void> {
    this.consumeFailure('delete', objectKey);
    this.objects.delete(objectKey);
  }

  tamperHead(
    objectKey: string,
    patch: Partial<Omit<ObjectStorageHead, 'objectKey'>>,
  ): void {
    const stored = this.requireObject(objectKey);
    stored.head = Object.freeze({
      ...stored.head,
      ...patch,
      objectKey,
      metadata: patch.metadata === undefined
        ? stored.head.metadata
        : Object.freeze({ ...patch.metadata }),
    });
  }

  private requireObject(objectKey: string): StoredMockObject {
    const stored = this.objects.get(objectKey);
    if (!stored) throw new Error('mock_object_not_found');
    return stored;
  }

  private consumeFailure(
    operation: FailureOperation,
    objectKey: string,
  ): void {
    const key = `${operation}:${objectKey}`;
    if (!this.failures.delete(key)) return;
    throw new Error(`mock_storage_${operation}_failed`);
  }
}

function copyBytes(
  input: Uint8Array<ArrayBufferLike>,
): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(input.byteLength);
  copy.set(input);
  return copy;
}
