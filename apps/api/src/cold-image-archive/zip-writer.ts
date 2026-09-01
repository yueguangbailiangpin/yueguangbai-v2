import { IncrementalCrc32, IncrementalSha256 } from '@ygb/domain';

/** Streaming ZIP limits — bundle caps that keep the format within classic
 * (non-ZIP64) bounds and the Worker memory ceiling: entries ≤ 65535, total
 * ≤ 1 GiB, single member ≤ 64 MiB. */
export const ZIP_MAX_FILE_ENTRIES = 5000;
export const ZIP_MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
export const ZIP_MAX_MEMBER_BYTES = 64 * 1024 * 1024;
const MANIFEST_ENTRY_NAME = 'manifest.json';

export interface ZipMemberSource {
  safeName: string;
  byteSize: number;
  /** Opens the member body; null means the storage could not stream it. */
  open(): Promise<ReadableStream<Uint8Array> | null>;
}

export interface ZipMemberOutcome {
  safeName: string;
  byteSize: number;
  crc32: number;
  sha256Hex: string;
}

export interface ZipWriterResult {
  byteSize: number;
  sha256Hex: string;
  entryCount: number;
  members: readonly ZipMemberOutcome[];
}

export type ZipSourceFactory = () => Promise<{
  manifestJsonBytes: Uint8Array;
  members: readonly ZipMemberSource[];
}>;

export class ZipWriterError extends Error {
  constructor(public readonly code: 'zip_member_open_failed' | 'zip_limit_exceeded' | 'zip_invalid_member_name' | 'zip_duplicate_member_name') {
    super(code);
    this.name = 'ZipWriterError';
  }
}

/**
 * Workers-compatible streaming ZIP builder (store mode — JPEG/PNG/PDF members
 * are never recompressed, D-055). The ZIP is produced as a pull-based
 * ReadableStream so storage backpressure bounds Worker memory: at most one
 * member chunk plus the fixed header buffers are resident at any time. The
 * writer computes each member's CRC-32 and SHA-256 and the whole archive's
 * SHA-256 incrementally; `result` resolves only after the stream has been
 * fully consumed.
 */
export function createStreamingZip(source: ZipSourceFactory): {
  stream: ReadableStream<Uint8Array>;
  result: Promise<ZipWriterResult>;
} {
  let resultResolve: (value: ZipWriterResult) => void;
  let resultReject: (reason: Error) => void;
  const result = new Promise<ZipWriterResult>((resolve, reject) => {
    resultResolve = resolve;
    resultReject = reject;
  });
  let generator: AsyncGenerator<Uint8Array> | null = null;
  const ensureGenerator = () => {
    if (!generator) generator = zipGenerator(source, finalize);
    return generator;
  };
  let settled = false;
  const finalize = (outcome: ZipWriterResult | null, error: Error | null) => {
    if (settled) return;
    settled = true;
    if (error) resultReject(error);
    else resultResolve(outcome!);
  };
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await ensureGenerator().next();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
        finalize(null, error instanceof Error ? error : new Error('zip_stream_failed'));
      }
    },
    async cancel() {
      await ensureGenerator().return(undefined).catch(() => undefined);
      finalize(null, new Error('zip_stream_cancelled'));
    },
  });
  return { stream, result };
}

async function* zipGenerator(
  source: ZipSourceFactory,
  finalize: (outcome: ZipWriterResult | null, error: Error | null) => void,
): AsyncGenerator<Uint8Array> {
  const archiveSha = new IncrementalSha256();
  const archiveCrc = new IncrementalCrc32();
  let offset = 0;
  const members: ZipMemberOutcome[] = [];
  const central: { name: string; crc: number; size: number; offset: number }[] = [];
  try {
    const { manifestJsonBytes, members: memberSources } = await source();
    if (memberSources.length > ZIP_MAX_FILE_ENTRIES) throw new ZipWriterError('zip_limit_exceeded');
    const seenNames = new Set<string>([MANIFEST_ENTRY_NAME]);
    const push = (chunk: Uint8Array) => {
      archiveSha.update(chunk);
      archiveCrc.update(chunk);
      offset += chunk.byteLength;
      if (offset > ZIP_MAX_TOTAL_BYTES) throw new ZipWriterError('zip_limit_exceeded');
      return chunk;
    };

    // manifest.json first: the sealed manifest travels inside its own bundle.
    const manifestCrc = new IncrementalCrc32().update(manifestJsonBytes).digest();
    const dos = dosDateTime();
    yield push(localFileHeader(MANIFEST_ENTRY_NAME, manifestCrc, manifestJsonBytes.byteLength, dos, false));
    yield push(manifestJsonBytes);
    central.push({ name: MANIFEST_ENTRY_NAME, crc: manifestCrc, size: manifestJsonBytes.byteLength, offset: 0 });

    for (const member of memberSources) {
      validateMemberName(member.safeName);
      if (seenNames.has(member.safeName)) throw new ZipWriterError('zip_duplicate_member_name');
      seenNames.add(member.safeName);
      if (member.byteSize > ZIP_MAX_MEMBER_BYTES) throw new ZipWriterError('zip_limit_exceeded');
      const body = await member.open();
      if (!body) throw new ZipWriterError('zip_member_open_failed');
      const memberSha = new IncrementalSha256();
      const memberCrc = new IncrementalCrc32();
      let memberSize = 0;
      const memberOffset = offset;
      yield push(localFileHeader(member.safeName, 0, member.byteSize, dos, true));
      const reader = body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value.byteLength === 0) continue;
          memberSize += value.byteLength;
          memberSha.update(value);
          memberCrc.update(value);
          yield push(value);
        }
      } finally {
        reader.releaseLock();
        await body.cancel().catch(() => undefined);
      }
      if (memberSize !== member.byteSize) throw new ZipWriterError('zip_limit_exceeded');
      const memberCrcValue = memberCrc.digest();
      yield push(dataDescriptor(memberCrcValue, member.byteSize));
      members.push({
        safeName: member.safeName,
        byteSize: member.byteSize,
        crc32: memberCrcValue,
        sha256Hex: memberSha.digestHex(),
      });
      central.push({
        name: member.safeName,
        crc: memberCrcValue,
        size: member.byteSize,
        offset: memberOffset,
      });
    }

    const centralStart = offset;
    for (const entry of central) {
      yield push(centralDirectoryRecord(entry.name, entry.crc, entry.size, entry.offset, dos));
    }
    const centralSize = offset - centralStart;
    yield push(endOfCentralDirectory(central.length, centralSize, centralStart));
    finalize(
      {
        byteSize: offset,
        sha256Hex: archiveSha.digestHex(),
        entryCount: central.length,
        members,
      },
      null,
    );
  } catch (error) {
    finalize(null, error instanceof Error ? error : new Error('zip_stream_failed'));
    throw error;
  }
}

function localFileHeader(
  name: string,
  crc: number,
  size: number,
  dos: { time: number; date: number },
  useDataDescriptor: boolean,
): Uint8Array {
  // General purpose flag 0x0008 (data descriptor) is only set for streamed
  // members whose CRC becomes known after the body; the in-memory manifest
  // entry knows its CRC upfront and uses a complete header.
  const nameBytes = new TextEncoder().encode(name);
  const buffer = new Uint8Array(30 + nameBytes.byteLength);
  const view = new DataView(buffer.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, useDataDescriptor ? 0x0008 : 0, true);
  view.setUint16(8, 0, true); // store
  view.setUint16(10, dos.time, true);
  view.setUint16(12, dos.date, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, size, true);
  view.setUint32(22, size, true);
  view.setUint16(26, nameBytes.byteLength, true);
  view.setUint16(28, 0, true);
  buffer.set(nameBytes, 30);
  return buffer;
}

function dataDescriptor(crc: number, size: number): Uint8Array {
  const buffer = new Uint8Array(16);
  const view = new DataView(buffer.buffer);
  view.setUint32(0, 0x08074b50, true);
  view.setUint32(4, crc, true);
  view.setUint32(8, size, true);
  view.setUint32(12, size, true);
  return buffer;
}

function centralDirectoryRecord(
  name: string,
  crc: number,
  size: number,
  memberOffset: number,
  dos: { time: number; date: number },
): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const buffer = new Uint8Array(46 + nameBytes.byteLength);
  const view = new DataView(buffer.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0x0008, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, dos.time, true);
  view.setUint16(14, dos.date, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, size, true);
  view.setUint32(24, size, true);
  view.setUint16(28, nameBytes.byteLength, true);
  // extra(30..31), comment(32..33), disk(34..35), internal attrs(36..37)
  view.setUint32(38, 0, true); // external attrs
  view.setUint32(42, memberOffset, true);
  buffer.set(nameBytes, 46);
  return buffer;
}

function endOfCentralDirectory(
  entryCount: number,
  centralSize: number,
  centralStart: number,
): Uint8Array {
  const buffer = new Uint8Array(22);
  const view = new DataView(buffer.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, entryCount, true);
  view.setUint16(10, entryCount, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralStart, true);
  view.setUint16(20, 0, true);
  return buffer;
}

function dosDateTime(): { time: number; date: number } {
  // Fixed 1980-01-01 00:00 — the ZIP epoch. A fixed timestamp keeps archives
  // byte-reproducible for a given manifest; real wall-clock time lives in the
  // manifest JSON and D1 rows.
  return { time: 0, date: 1 };
}

export function validateMemberName(name: string): void {
  if (typeof name !== 'string' || name.length < 6 || name.length > 200) {
    throw new ZipWriterError('zip_invalid_member_name');
  }
  if (!/^[0-9a-zA-Z][0-9a-zA-Z._-]*$/.test(name)) {
    throw new ZipWriterError('zip_invalid_member_name');
  }
  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    throw new ZipWriterError('zip_invalid_member_name');
  }
}
