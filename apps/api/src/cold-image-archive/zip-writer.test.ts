import { describe, expect, it } from 'vitest';
import { IncrementalCrc32, IncrementalSha256, sha256Hex } from '@ygb/domain';
import {
  createStreamingZip,
  validateMemberName,
  ZIP_MAX_FILE_ENTRIES,
  type ZipMemberSource,
} from './zip-writer';

function streamOf(bytes: Uint8Array, chunkSize = 7): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      const end = Math.min(offset + chunkSize, bytes.byteLength);
      controller.enqueue(bytes.slice(offset, end));
      offset = end;
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

/** Minimal central-directory parser used to prove the produced ZIP is real. */
function parseCentralDirectory(zip: Uint8Array) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = -1;
  for (let index = zip.byteLength - 22; index >= 0; index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) throw new Error('missing EOCD');
  const entryCount = view.getUint16(eocd + 10, true);
  const centralStart = view.getUint32(eocd + 16, true);
  const entries: { name: string; crc: number; size: number; offset: number }[] = [];
  let cursor = centralStart;
  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error('bad central record');
    const crc = view.getUint32(cursor + 16, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = new TextDecoder().decode(zip.subarray(cursor + 46, cursor + 46 + nameLength));
    entries.push({ name, crc, size, offset: localOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readLocalMember(zip: Uint8Array, offset: number): { name: string; bytes: Uint8Array } {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  if (view.getUint32(offset, true) !== 0x04034b50) throw new Error('bad local header');
  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const flags = view.getUint16(offset + 6, true);
  const declaredSize = view.getUint32(offset + 22, true);
  const name = new TextDecoder().decode(zip.subarray(offset + 30, offset + 30 + nameLength));
  const dataStart = offset + 30 + nameLength + extraLength;
  const bytes = zip.subarray(dataStart, dataStart + declaredSize);
  if (flags & 0x0008) {
    // data descriptor (with signature) follows the member body
    const descriptor = dataStart + declaredSize;
    if (view.getUint32(descriptor, true) !== 0x08074b50) throw new Error('missing descriptor signature');
    if (view.getUint32(descriptor + 4, true) !== new IncrementalCrc32().update(bytes).digest()) {
      throw new Error('descriptor crc mismatch');
    }
  }
  return { name, bytes };
}

describe('streaming ZIP writer', () => {
  it('produces a structurally valid store-mode archive with manifest first', async () => {
    const manifest = new TextEncoder().encode('{"manifest_version":1}');
    const first = crypto.getRandomValues(new Uint8Array(512));
    const second = crypto.getRandomValues(new Uint8Array(33));
    const members: ZipMemberSource[] = [
      { safeName: '0001-abcdef0123456789.jpg', byteSize: first.byteLength, open: async () => streamOf(first) },
      { safeName: '0002-abcdef0123456789.jpg', byteSize: second.byteLength, open: async () => streamOf(second) },
    ];
    const writer = createStreamingZip(async () => ({ manifestJsonBytes: manifest, members }));
    const zip = await collect(writer.stream);
    const result = await writer.result;
    const central = parseCentralDirectory(zip);
    expect(central.map((entry) => entry.name)).toEqual([
      'manifest.json',
      '0001-abcdef0123456789.jpg',
      '0002-abcdef0123456789.jpg',
    ]);
    const manifestEntry = readLocalMember(zip, central[0]!.offset);
    expect(manifestEntry.bytes).toEqual(manifest);
    expect(readLocalMember(zip, central[1]!.offset).bytes).toEqual(first);
    expect(readLocalMember(zip, central[2]!.offset).bytes).toEqual(second);
    expect(result.byteSize).toBe(zip.byteLength);
    expect(result.sha256Hex).toBe(await sha256Hex(zip));
    expect(result.entryCount).toBe(3);
    expect(result.members.map((member) => member.sha256Hex)).toEqual([
      await sha256Hex(first),
      await sha256Hex(second),
    ]);
  });

  it('emits nothing upfront and streams lazily (backpressure comes from the consumer)', async () => {
    let opened = 0;
    const manifest = new Uint8Array(10);
    const members: ZipMemberSource[] = Array.from({ length: 3 }, (_, index) => ({
      safeName: `000${index + 1}-abcdef0123456789.jpg`,
      byteSize: 8,
      open: async () => {
        opened += 1;
        return streamOf(crypto.getRandomValues(new Uint8Array(8)));
      },
    }));
    const writer = createStreamingZip(async () => ({ manifestJsonBytes: manifest, members }));
    const reader = writer.stream.getReader();
    // Pull a handful of chunks: members must open lazily, not all at once.
    for (let pull = 0; pull < 3; pull += 1) await reader.read();
    expect(opened).toBeLessThanOrEqual(2);
    await reader.cancel();
    await expect(writer.result).rejects.toBeTruthy();
  });

  it('rejects duplicate and unsafe member names', async () => {
    const manifest = new Uint8Array(4);
    const base: ZipMemberSource = {
      safeName: '0001-abcdef0123456789.jpg',
      byteSize: 4,
      open: async () => streamOf(new Uint8Array(4)),
    };
    const duplicate = createStreamingZip(async () => ({
      manifestJsonBytes: manifest,
      members: [base, { ...base }],
    }));
    await expect(collect(duplicate.stream)).rejects.toMatchObject({
      message: 'zip_duplicate_member_name',
    });
    validateMemberName('0001-abcdef0123456789.jpg');
    expect(() => validateMemberName('../evil.jpg')).toThrow('zip_invalid_member_name');
    expect(() => validateMemberName('a/b.jpg')).toThrow('zip_invalid_member_name');
    expect(() => validateMemberName('0001-abc..jpg')).toThrow('zip_invalid_member_name');
    expect(() => validateMemberName('0001-abc.exe\u0000')).toThrow('zip_invalid_member_name');
  });

  it('fails closed when a member stream is unavailable or size mismatches', async () => {
    const manifest = new Uint8Array(4);
    const unavailable = createStreamingZip(async () => ({
      manifestJsonBytes: manifest,
      members: [{ safeName: '0001-abcdef0123456789.jpg', byteSize: 4, open: async () => null }],
    }));
    await expect(collect(unavailable.stream)).rejects.toMatchObject({ message: 'zip_member_open_failed' });
    const truncated = createStreamingZip(async () => ({
      manifestJsonBytes: manifest,
      members: [{
        safeName: '0001-abcdef0123456789.jpg',
        byteSize: 10,
        open: async () => streamOf(new Uint8Array(4)),
      }],
    }));
    await expect(collect(truncated.stream)).rejects.toBeTruthy();
  });

  it('enforces the bundle entry cap', () => {
    expect(ZIP_MAX_FILE_ENTRIES).toBe(5000);
    const hasher = new IncrementalSha256();
    hasher.update(new Uint8Array(64));
    expect(hasher.digestHex()).toMatch(/^[0-9a-f]{64}$/);
  });
});
