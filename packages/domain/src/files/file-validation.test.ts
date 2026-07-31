import { describe, expect, it } from 'vitest';
import {
  FileValidationError,
  inspectTrustedFileBytes,
  normalizeUploadDescriptor,
  validateUploadManifest,
} from './file-validation';

const png = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47,
  0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x01, 0x02,
]);

describe('file upload validation', () => {
  it('normalizes a supported manifest and inspects trusted bytes', async () => {
    const manifest = validateUploadManifest('ORDER_EVIDENCE', [{
      clientFileName: '  evidence.PNG  ',
      declaredMime: 'IMAGE/PNG',
      byteSize: png.byteLength,
    }]);
    expect(manifest[0]).toEqual({
      clientFileName: 'evidence.PNG',
      declaredMime: 'image/png',
      extension: 'png',
      byteSize: png.byteLength,
    });

    await expect(inspectTrustedFileBytes({
      purpose: 'ORDER_EVIDENCE',
      clientFileName: 'evidence.png',
      declaredMime: 'image/png',
      expectedByteSize: png.byteLength,
      bytes: png,
    })).resolves.toMatchObject({
      detectedMime: 'image/png',
      byteSize: png.byteLength,
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
  });

  it('rejects double extensions and MIME/extension mismatch', () => {
    expect(() => normalizeUploadDescriptor(
      'ORDER_EVIDENCE',
      {
        clientFileName: 'proof.jpg.exe',
        declaredMime: 'image/jpeg',
        byteSize: 100,
      },
    )).toThrow(FileValidationError);

    expect(() => normalizeUploadDescriptor(
      'ORDER_EVIDENCE',
      {
        clientFileName: 'proof.png',
        declaredMime: 'image/jpeg',
        byteSize: 100,
      },
    )).toThrow('DECLARED_MIME_MISMATCH');
  });

  it('rejects SVG, HTML and executable declarations', () => {
    for (const declaredMime of [
      'image/svg+xml',
      'text/html',
      'application/x-msdownload',
    ]) {
      expect(() => normalizeUploadDescriptor(
        'SUPPORT_ATTACHMENT',
        {
          clientFileName: 'unsafe.svg',
          declaredMime,
          byteSize: 100,
        },
      )).toThrow('UNSUPPORTED_FILE_TYPE');
    }
  });

  it('rejects spoofed magic bytes and count/size overflow', async () => {
    const html = new TextEncoder().encode('<html>unsafe</html>');
    await expect(inspectTrustedFileBytes({
      purpose: 'ORDER_EVIDENCE',
      clientFileName: 'fake.png',
      declaredMime: 'image/png',
      expectedByteSize: html.byteLength,
      bytes: html,
    })).rejects.toThrow('MAGIC_BYTES_MISMATCH');

    expect(() => validateUploadManifest(
      'BUYER_REFUND_PROOF',
      Array.from({ length: 7 }, (_, index) => ({
        clientFileName: `proof${index}.jpg`,
        declaredMime: 'image/jpeg',
        byteSize: 100,
      })),
    )).toThrow('FILE_COUNT_EXCEEDED');
  });
});
