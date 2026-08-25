import type {
  ArchiveBundleFileManifestEntry,
  ArchiveBundleManifest,
  ArchiveBundleType,
  ColdArchivePurpose,
  SupportedFileMime,
} from '@ygb/contracts';
import { canonicalJson, sha256Hex } from '@ygb/domain';

const MIME_EXTENSION: Record<SupportedFileMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/**
 * Unguessable ZIP member name: an order index plus a deterministic 64-bit
 * FNV-1a digest (hex) of the opaque file id plus the sniffed extension. No
 * client file names, no PII, always matches the storage GLOB `[0-9a-f]*`.
 */
export function safeMemberName(entryIndex: number, fileObjectId: string, mime: SupportedFileMime): string {
  if (!Number.isSafeInteger(entryIndex) || entryIndex < 0 || entryIndex > 9999) {
    throw new Error('invalid_manifest_entry_index');
  }
  if (typeof fileObjectId !== 'string' || fileObjectId.length < 4 || fileObjectId.length > 200) {
    throw new Error('invalid_manifest_file_id');
  }
  let high = 0xcbf29ce4n;
  let low = 0x84222325n;
  for (let index = 0; index < fileObjectId.length; index += 1) {
    const byte = BigInt(fileObjectId.charCodeAt(index) & 0xff);
    high = (high ^ byte) * 0x100000001b3n & 0xffffffffffffffffn;
    low = (low + byte * BigInt(index + 1)) * 0x100000001b3n & 0xffffffffffffffffn;
  }
  const hex = (high.toString(16).padStart(16, '0') + low.toString(16).padStart(16, '0')).slice(0, 16);
  if (!/^[0-9a-f]{16}$/.test(hex)) throw new Error('invalid_manifest_safe_name');
  return `${String(entryIndex).padStart(4, '0')}-${hex}.${MIME_EXTENSION[mime]}`;
}

export async function buildBundleManifest(input: {
  bundleId: string;
  bundleVersion: number;
  bundleType: ArchiveBundleType;
  eligibilityAt: number;
  createdAt: number;
  entries: readonly Omit<ArchiveBundleFileManifestEntry, 'safe_name' | 'entry_index'>[];
}): Promise<{ manifest: ArchiveBundleManifest; manifestJson: string; manifestSha256: string }> {
  const seenNames = new Set<string>();
  const seenFiles = new Set<string>();
  const entries: ArchiveBundleFileManifestEntry[] = input.entries.map((entry, index) => {
    if (seenFiles.has(entry.file_object_id)) throw new Error('manifest_duplicate_file');
    seenFiles.add(entry.file_object_id);
    const safeName = safeMemberName(index, entry.file_object_id, entry.mime_type);
    if (seenNames.has(safeName)) throw new Error('manifest_duplicate_safe_name');
    seenNames.add(safeName);
    return { ...entry, entry_index: index, safe_name: safeName };
  });
  const manifest: ArchiveBundleManifest = {
    manifest_version: 1,
    bundle_id: input.bundleId,
    bundle_version: input.bundleVersion,
    bundle_type: input.bundleType,
    eligibility_at: input.eligibilityAt,
    created_at: input.createdAt,
    file_count: entries.length,
    total_bytes: entries.reduce((total, entry) => total + entry.byte_size, 0),
    files: entries,
  };
  const manifestJson = canonicalJson(manifest);
  // Stable serialization: canonical JSON (sorted keys, no whitespace) hashed
  // with SHA-256. The same manifest facts always produce the same digest.
  return { manifest, manifestJson, manifestSha256: await sha256Hex(manifestJson) };
}

export function manifestPurposeList(): readonly ColdArchivePurpose[] {
  return [
    'ORDER_EVIDENCE',
    'ORDER_EVIDENCE_INTERNAL_COMMUNICATION',
    'REVIEW_EVIDENCE',
    'BUYER_REFUND_PROOF',
    'SELLER_SETTLEMENT_PROOF',
  ];
}
