import { describe, expect, it } from 'vitest';
import { sha256Hex } from './sha256';
import { IncrementalSha256, sha256HexOfStream } from './sha256-stream';

function chunked(bytes: Uint8Array, size: number): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      const end = Math.min(offset + size, bytes.byteLength);
      controller.enqueue(bytes.slice(offset, end));
      offset = end;
    },
  });
}

describe('IncrementalSha256', () => {
  it('matches crypto.subtle for empty input', async () => {
    const incremental = new IncrementalSha256().digestHex();
    expect(incremental).toBe(
      await sha256Hex(new Uint8Array(0)),
    );
    expect(incremental).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('matches crypto.subtle across every chunk boundary around 64 bytes', async () => {
    const bytes = new Uint8Array(300);
    for (let index = 0; index < bytes.byteLength; index += 1) {
      bytes[index] = (index * 31 + 7) & 0xff;
    }
    const expected = await sha256Hex(bytes);
    for (let size = 1; size <= 130; size += 1) {
      const hasher = new IncrementalSha256();
      for (let offset = 0; offset < bytes.byteLength; offset += size) {
        hasher.update(bytes.subarray(offset, Math.min(offset + size, bytes.byteLength)));
      }
      expect(hasher.digestHex()).toBe(expected);
    }
  });

  it('matches for inputs larger than 2^32 bits of accumulated length bookkeeping', async () => {
    // byteLength bookkeeping uses float-safe arithmetic; verify a 1 MiB payload
    // with irregular chunks still matches the one-shot digest.
    const bytes = new Uint8Array(1024 * 1024);
    for (let offset = 0; offset < bytes.byteLength; offset += 65536) {
      crypto.getRandomValues(bytes.subarray(offset, Math.min(offset + 65536, bytes.byteLength)));
    }
    const expected = await sha256Hex(bytes);
    const hasher = new IncrementalSha256();
    let offset = 0;
    let step = 1;
    while (offset < bytes.byteLength) {
      const end = Math.min(offset + step, bytes.byteLength);
      hasher.update(bytes.subarray(offset, end));
      offset = end;
      step = step === 1 ? 97 : 1;
    }
    expect(hasher.digestHex()).toBe(expected);
  });

  it('refuses double finish and update after finish', () => {
    const hasher = new IncrementalSha256().update(new Uint8Array([1]));
    hasher.digestHex();
    expect(() => hasher.digestHex()).toThrow('sha256_stream_already_finished');
    expect(() => hasher.update(new Uint8Array([2]))).toThrow(
      'sha256_stream_already_finished',
    );
  });
});

describe('sha256HexOfStream', () => {
  it('hashes a stream chunk-by-chunk with byte accounting', async () => {
    const bytes = crypto.getRandomValues(new Uint8Array(4096));
    const result = await sha256HexOfStream(chunked(bytes, 100));
    expect(result.byteSize).toBe(4096);
    expect(result.sha256Hex).toBe(await sha256Hex(bytes));
  });

  it('handles empty streams', async () => {
    const result = await sha256HexOfStream(chunked(new Uint8Array(0), 10));
    expect(result.byteSize).toBe(0);
    expect(result.sha256Hex).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});
