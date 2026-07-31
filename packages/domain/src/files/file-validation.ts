import type {
  FilePurpose,
  FileUploadDescriptor,
  NormalizedFileUploadDescriptor,
  SupportedFileExtension,
  SupportedFileMime,
} from '@ygb/contracts';
import {
  isSupportedFileMime,
} from '@ygb/contracts';
import { sha256Hex } from '../crypto/sha256';
import { filePurposePolicy } from './file-policy';

export type FileValidationErrorCode =
  | 'INVALID_FILE_NAME'
  | 'DOUBLE_EXTENSION_REJECTED'
  | 'UNSUPPORTED_FILE_TYPE'
  | 'FILE_COUNT_EXCEEDED'
  | 'FILE_SIZE_EXCEEDED'
  | 'DECLARED_MIME_MISMATCH'
  | 'MAGIC_BYTES_MISMATCH'
  | 'EXPECTED_SIZE_MISMATCH';

export class FileValidationError extends Error {
  constructor(public readonly code: FileValidationErrorCode) {
    super(code);
    this.name = 'FileValidationError';
  }
}

export interface TrustedFileInspection {
  detectedMime: SupportedFileMime;
  byteSize: number;
  sha256: string;
}

const EXTENSION_MIME: Readonly<
  Record<SupportedFileExtension, SupportedFileMime>
> = Object.freeze({
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
});

export function validateUploadManifest(
  purpose: FilePurpose,
  files: readonly FileUploadDescriptor[],
): readonly NormalizedFileUploadDescriptor[] {
  const policy = filePurposePolicy(purpose);
  if (files.length < 1 || files.length > policy.maximumFileCount) {
    throw new FileValidationError('FILE_COUNT_EXCEEDED');
  }

  return Object.freeze(files.map((file) =>
    normalizeUploadDescriptor(purpose, file)));
}

export function normalizeUploadDescriptor(
  purpose: FilePurpose,
  descriptor: FileUploadDescriptor,
): NormalizedFileUploadDescriptor {
  const { clientFileName, extension } = normalizeClientFileName(
    descriptor.clientFileName,
  );
  const policy = filePurposePolicy(purpose);
  if (!Number.isSafeInteger(descriptor.byteSize)
    || descriptor.byteSize < 1
    || descriptor.byteSize > policy.maximumByteSize) {
    throw new FileValidationError('FILE_SIZE_EXCEEDED');
  }

  const declaredMime = normalizeDeclaredMime(descriptor.declaredMime);
  if (!policy.allowedMimes.includes(declaredMime)) {
    throw new FileValidationError('UNSUPPORTED_FILE_TYPE');
  }
  if (EXTENSION_MIME[extension] !== declaredMime) {
    throw new FileValidationError('DECLARED_MIME_MISMATCH');
  }

  return Object.freeze({
    clientFileName,
    declaredMime,
    extension,
    byteSize: descriptor.byteSize,
  });
}

export async function inspectTrustedFileBytes(
  input: {
    purpose: FilePurpose;
    clientFileName: string;
    declaredMime: string;
    expectedByteSize: number;
    bytes: Uint8Array<ArrayBuffer>;
  },
): Promise<TrustedFileInspection> {
  const normalized = normalizeUploadDescriptor(input.purpose, {
    clientFileName: input.clientFileName,
    declaredMime: input.declaredMime,
    byteSize: input.expectedByteSize,
  });
  if (input.bytes.byteLength !== normalized.byteSize) {
    throw new FileValidationError('EXPECTED_SIZE_MISMATCH');
  }

  const detectedMime = detectSupportedMime(input.bytes);
  if (detectedMime === null || detectedMime !== normalized.declaredMime) {
    throw new FileValidationError('MAGIC_BYTES_MISMATCH');
  }

  return Object.freeze({
    detectedMime,
    byteSize: input.bytes.byteLength,
    sha256: await sha256Hex(input.bytes),
  });
}

export function detectSupportedMime(
  bytes: Uint8Array<ArrayBuffer> | Uint8Array<ArrayBufferLike>,
): SupportedFileMime | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [
    0x89, 0x50, 0x4e, 0x47,
    0x0d, 0x0a, 0x1a, 0x0a,
  ])) return 'image/png';
  if (bytes.byteLength >= 12
    && ascii(bytes, 0, 4) === 'RIFF'
    && ascii(bytes, 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  if (ascii(bytes, 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

export function normalizeClientFileName(
  value: string,
): {
  clientFileName: string;
  extension: SupportedFileExtension;
} {
  if (typeof value !== 'string') {
    throw new FileValidationError('INVALID_FILE_NAME');
  }
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length < 3
    || normalized.length > 180
    || /[\\/\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u
      .test(normalized)
    || normalized.startsWith('.')
    || normalized.endsWith('.')) {
    throw new FileValidationError('INVALID_FILE_NAME');
  }

  const parts = normalized.split('.');
  if (parts.length !== 2) {
    throw new FileValidationError('DOUBLE_EXTENSION_REJECTED');
  }
  const stem = parts[0];
  const extensionValue = parts[1]?.toLocaleLowerCase('en-US');
  if (!stem || !extensionValue
    || !/^[a-z0-9]+$/u.test(extensionValue)) {
    throw new FileValidationError('INVALID_FILE_NAME');
  }
  if (!isSupportedExtension(extensionValue)) {
    throw new FileValidationError('UNSUPPORTED_FILE_TYPE');
  }

  return Object.freeze({
    clientFileName: normalized,
    extension: extensionValue,
  });
}

function normalizeDeclaredMime(value: string): SupportedFileMime {
  if (typeof value !== 'string') {
    throw new FileValidationError('UNSUPPORTED_FILE_TYPE');
  }
  const normalized = value.trim().toLocaleLowerCase('en-US');
  if (!isSupportedFileMime(normalized)) {
    throw new FileValidationError('UNSUPPORTED_FILE_TYPE');
  }
  return normalized;
}

function isSupportedExtension(
  value: string,
): value is SupportedFileExtension {
  return Object.hasOwn(EXTENSION_MIME, value);
}

function startsWith(
  bytes: Uint8Array<ArrayBufferLike>,
  prefix: readonly number[],
): boolean {
  if (bytes.byteLength < prefix.length) return false;
  return prefix.every((value, index) => bytes[index] === value);
}

function ascii(
  bytes: Uint8Array<ArrayBufferLike>,
  start: number,
  end: number,
): string {
  if (bytes.byteLength < end) return '';
  return String.fromCharCode(...bytes.slice(start, end));
}
