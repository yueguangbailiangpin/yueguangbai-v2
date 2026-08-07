import { describe, expect, it } from 'vitest';
import type {
  FileAuthorityEvidence,
  OfflineStorageManifestEntry,
} from '@ygb/contracts';
import { protectReference, reconcileFileManifests } from '@ygb/testkit';

describe('offline D1/R2/Drive manifest reconciliation', () => {
  it('accepts one exact private storage object for each D1 authority row', () => {
    const r2 = authority('hot', 'R2');
    const drive = authority('archived', 'DRIVE');
    const report = reconcileFileManifests({
      authority: [r2, drive],
      r2Manifest: [entry(r2)],
      driveManifest: [entry(drive)],
      generatedAtUtcMs: 1,
    });
    expect(report).toMatchObject({
      status: 'PASS',
      authority_count: 2,
      external_calls: 0,
      r2_deletes: 0,
    });
    expect(report.findings).toEqual([]);
  });

  it('reports missing, orphan, duplicate, size, MIME, checksum, ref and public-link failures', () => {
    const missing = authority('missing', 'R2');
    const broken = authority('broken', 'DRIVE');
    const duplicate = authority('duplicate', 'R2');
    const brokenEntry: OfflineStorageManifestEntry = {
      ...entry(broken),
      protected_ref: protectReference('drive', 'wrong'),
      byte_size: broken.byte_size + 1,
      mime_type: 'image/png',
      sha256: protectReference('content', 'wrong'),
      public_url: 'https://public.example.test/bare-link',
    };
    const duplicateEntry = entry(duplicate);
    const orphan = entry(authority('orphan', 'DRIVE'));
    const report = reconcileFileManifests({
      authority: [missing, broken, duplicate],
      r2Manifest: [duplicateEntry, duplicateEntry],
      driveManifest: [brokenEntry, orphan, duplicateEntry],
      generatedAtUtcMs: 2,
    });
    expect(report.status).toBe('FAIL');
    for (const kind of [
      'MISSING', 'ORPHAN', 'DUPLICATE', 'PROTECTED_REF_MISMATCH',
      'SIZE_MISMATCH', 'MIME_MISMATCH', 'SHA256_MISMATCH', 'PUBLIC_LINK',
    ] as const) {
      expect(report.finding_counts[kind]).toBeGreaterThan(0);
    }
    expect(JSON.stringify(report)).not.toContain('public.example.test');
  });
});

function authority(id: string, location: 'R2' | 'DRIVE'): FileAuthorityEvidence {
  return {
    authority_hash: protectReference('file', id),
    expected_location: location,
    expected_protected_ref: protectReference(location.toLowerCase(), `${location}-${id}`),
    byte_size: 1024,
    mime_type: 'image/jpeg',
    sha256: protectReference('content', id),
  };
}

function entry(source: FileAuthorityEvidence): OfflineStorageManifestEntry {
  return {
    authority_hash: source.authority_hash,
    protected_ref: source.expected_protected_ref,
    byte_size: source.byte_size,
    mime_type: source.mime_type,
    sha256: source.sha256,
    public_url: null,
  };
}
