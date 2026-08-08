import {
  isSupportedFileMime,
  type ObjectStorageAdapter,
  type ObjectStorageHead,
  type ObjectStoragePutInput,
  type ObjectStoragePutResult,
  ObjectStoragePutFailure,
} from '@ygb/contracts';
import { sha256Hex } from '@ygb/domain';

export interface R2ObjectLike {
  key: string;
  size: number;
  etag?: string;
  httpEtag?: string;
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
  checksums?: { sha256?: ArrayBuffer };
}

export interface R2ObjectBodyLike extends R2ObjectLike {
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface R2BucketBinding {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView,
    options: {
      httpMetadata: { contentType: string };
      customMetadata: Record<string, string>;
      sha256: string;
    },
  ): Promise<R2ObjectLike | null>;
  head(key: string): Promise<R2ObjectLike | null>;
  get(
    key: string,
    options?: { range: { offset: number; length: number } },
  ): Promise<R2ObjectBodyLike | R2ObjectLike | null>;
  delete(key: string): Promise<void>;
}

const CHECKSUM_METADATA = 'ygb-sha256';

export class R2ObjectStorageAdapter implements ObjectStorageAdapter {
  constructor(private readonly bucket: R2BucketBinding) {}

  async putObject(input: ObjectStoragePutInput): Promise<ObjectStoragePutResult> {
    const checksumSha256 = await sha256Hex(input.bytes);
    let stored: R2ObjectLike | null;
    try {
      stored = await this.bucket.put(input.objectKey, input.bytes, {
        httpMetadata: { contentType: input.contentType },
        customMetadata: {
          ...input.metadata,
          [CHECKSUM_METADATA]: checksumSha256,
        },
        sha256: checksumSha256,
      });
    } catch (cause) {
      throw new ObjectStoragePutFailure('r2_put_ambiguous', true, { cause });
    }
    if (!stored) throw new Error('r2_put_rejected');
    try {
      const head = objectHead(stored, input.objectKey);
      if (head.byteSize !== input.bytes.byteLength
        || head.contentType !== input.contentType
        || head.checksumSha256 !== checksumSha256
        || !metadataIncludes(head.metadata, input.metadata)) {
        throw new Error('r2_put_receipt_mismatch');
      }
      return Object.freeze({
        etag: head.etag,
        byteSize: head.byteSize,
        contentType: head.contentType,
        checksumSha256: head.checksumSha256,
      });
    } catch (cause) {
      throw new ObjectStoragePutFailure(
        'r2_put_receipt_invalid', true, { cause },
      );
    }
  }

  async headObject(objectKey: string): Promise<ObjectStorageHead | null> {
    const stored = await this.bucket.head(objectKey);
    return stored === null ? null : objectHead(stored, objectKey);
  }

  async readPrefix(
    objectKey: string,
    maximumBytes: number,
  ): Promise<Uint8Array<ArrayBuffer>> {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
      throw new Error('invalid_prefix_length');
    }
    return readBody(await this.bucket.get(objectKey, {
      range: { offset: 0, length: maximumBytes },
    }), objectKey, maximumBytes);
  }

  async readObject(objectKey: string): Promise<Uint8Array<ArrayBuffer>> {
    return readBody(await this.bucket.get(objectKey), objectKey);
  }

  async deleteObject(objectKey: string): Promise<void> {
    await this.bucket.delete(objectKey);
  }
}

export function createR2ObjectStorageAdapter(
  binding: unknown,
): R2ObjectStorageAdapter | null {
  if (!binding || typeof binding !== 'object') return null;
  const value = binding as Partial<R2BucketBinding>;
  return typeof value.put === 'function'
    && typeof value.head === 'function'
    && typeof value.get === 'function'
    && typeof value.delete === 'function'
    ? new R2ObjectStorageAdapter(value as R2BucketBinding)
    : null;
}

function objectHead(
  object: R2ObjectLike,
  expectedKey: string,
): ObjectStorageHead {
  if (object.key !== expectedKey
    || !Number.isSafeInteger(object.size)
    || object.size < 0
    || !isSupportedFileMime(object.httpMetadata?.contentType)) {
    throw new Error('r2_object_metadata_invalid');
  }
  const metadata = Object.freeze({ ...object.customMetadata });
  const metadataChecksum = metadata[CHECKSUM_METADATA];
  const checksum = object.checksums?.sha256 === undefined
    ? metadataChecksum
    : arrayBufferHex(object.checksums.sha256);
  if (!checksum || !/^[0-9a-f]{64}$/u.test(checksum)
    || (metadataChecksum !== undefined && metadataChecksum !== checksum)) {
    throw new Error('r2_object_checksum_invalid');
  }
  const etag = object.httpEtag ?? object.etag;
  if (typeof etag !== 'string' || etag.length < 1 || etag.length > 256) {
    throw new Error('r2_object_etag_invalid');
  }
  return Object.freeze({
    objectKey: expectedKey,
    etag,
    byteSize: object.size,
    contentType: object.httpMetadata.contentType,
    checksumSha256: checksum,
    metadata,
  });
}

async function readBody(
  object: R2ObjectBodyLike | R2ObjectLike | null,
  expectedKey: string,
  maximumBytes?: number,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!object || object.key !== expectedKey
    || typeof (object as Partial<R2ObjectBodyLike>).arrayBuffer !== 'function') {
    throw new Error('r2_object_not_found');
  }
  const bytes = new Uint8Array(
    await (object as R2ObjectBodyLike).arrayBuffer(),
  );
  if (maximumBytes !== undefined && bytes.byteLength > maximumBytes) {
    throw new Error('r2_range_exceeded');
  }
  return bytes;
}

function metadataIncludes(
  actual: Readonly<Record<string, string>>,
  expected: Readonly<Record<string, string>>,
): boolean {
  return Object.entries(expected).every(([key, value]) => actual[key] === value);
}

function arrayBufferHex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
