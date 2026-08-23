import { sha256Hex } from '@ygb/domain';
import type {
  R2BucketBinding,
  R2ObjectBodyLike,
  R2ObjectLike,
} from '../src/files/r2-object-storage';

interface StoredObject {
  bytes: Uint8Array<ArrayBuffer>;
  object: R2ObjectLike;
}

export class AnonymousR2Bucket implements R2BucketBinding {
  readonly objects = new Map<string, StoredObject>();
  private readonly failures = new Set<string>();
  private readonly incompletePutReceipts = new Set<string>();
  private readonly postPutFailures = new Set<string>();

  failNext(operation: 'put' | 'head' | 'get' | 'delete', key: string): void {
    this.failures.add(`${operation}:${key}`);
  }

  returnIncompleteNextPutReceipt(key: string): void {
    this.incompletePutReceipts.add(key);
  }

  failAfterNextPut(key: string): void {
    this.postPutFailures.add(key);
  }

  async put(
    key: string,
    value: ArrayBuffer | ArrayBufferView,
    options: {
      httpMetadata: { contentType: string };
      customMetadata: Record<string, string>;
      sha256: string;
    },
  ): Promise<R2ObjectLike> {
    this.consumeFailure('put', key);
    const bytes = copyBytes(value);
    const checksum = await sha256Hex(bytes);
    if (checksum !== options.sha256) throw new Error('anonymous_r2_checksum_rejected');
    const object = makeObject(key, bytes, options, checksum);
    this.objects.set(key, { bytes, object });
    if (this.postPutFailures.delete(key)) {
      throw new Error('anonymous_r2_post_put_failure');
    }
    if (this.incompletePutReceipts.delete(key)) {
      return {
        key,
        size: bytes.byteLength,
        httpMetadata: { ...options.httpMetadata },
        customMetadata: { ...options.customMetadata },
        checksums: { sha256: hexArrayBuffer(checksum) },
      };
    }
    return cloneObject(object);
  }

  async head(key: string): Promise<R2ObjectLike | null> {
    this.consumeFailure('head', key);
    const stored = this.objects.get(key);
    return stored ? cloneObject(stored.object) : null;
  }

  async get(
    key: string,
    options?: { range: { offset: number; length: number } },
  ): Promise<R2ObjectBodyLike | null> {
    this.consumeFailure('get', key);
    const stored = this.objects.get(key);
    if (!stored) return null;
    const bytes = options
      ? stored.bytes.slice(
          options.range.offset,
          options.range.offset + options.range.length,
        )
      : stored.bytes;
    const body = new Response(copyBytes(bytes)).body;
    return {
      ...cloneObject(stored.object),
      async arrayBuffer() { return copyBytes(bytes).buffer; },
      ...(body === null ? {} : { body }),
    };
  }

  async delete(key: string): Promise<void> {
    this.consumeFailure('delete', key);
    this.objects.delete(key);
  }

  tamper(
    key: string,
    patch: Partial<Pick<R2ObjectLike, 'key' | 'size' | 'httpMetadata' | 'customMetadata' | 'checksums'>>,
  ): void {
    const stored = this.objects.get(key);
    if (!stored) throw new Error('anonymous_r2_object_missing');
    stored.object = { ...stored.object, ...patch };
  }

  private consumeFailure(operation: string, key: string): void {
    if (this.failures.delete(`${operation}:${key}`)) {
      throw new Error(`anonymous_r2_${operation}_failure`);
    }
  }
}

function makeObject(
  key: string,
  bytes: Uint8Array<ArrayBuffer>,
  options: {
    httpMetadata: { contentType: string };
    customMetadata: Record<string, string>;
  },
  checksum: string,
): R2ObjectLike {
  return {
    key,
    size: bytes.byteLength,
    etag: checksum.slice(0, 32),
    httpEtag: `"${checksum.slice(0, 32)}"`,
    httpMetadata: { ...options.httpMetadata },
    customMetadata: { ...options.customMetadata },
    checksums: { sha256: hexArrayBuffer(checksum) },
  };
}

function cloneObject(object: R2ObjectLike): R2ObjectLike {
  return {
    ...object,
    httpMetadata: { ...object.httpMetadata },
    customMetadata: { ...object.customMetadata },
    checksums: object.checksums?.sha256
      ? { sha256: object.checksums.sha256.slice(0) }
      : {},
  };
}

function copyBytes(value: ArrayBuffer | ArrayBufferView): Uint8Array<ArrayBuffer> {
  const source = value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy;
}

function hexArrayBuffer(value: string): ArrayBuffer {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes.buffer;
}
