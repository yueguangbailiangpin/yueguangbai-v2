import type {
  FileHttpUploadDescriptor,
  SupportedFileExtension,
  SupportedFileMime,
} from '@ygb/contracts';
import { FrontendApiError } from '../api/errors';
import type { FileUploadWorkflow } from './file-purpose-config';

const EXTENSION_MIME = Object.freeze({
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
} as const satisfies Record<SupportedFileExtension, SupportedFileMime>);

export type ValidatedFileSelection = Readonly<{
  file: File;
  descriptor: Readonly<FileHttpUploadDescriptor>;
}>;

function validationError(reason: string, field = 'files'): FrontendApiError {
  return new FrontendApiError(
    'VALIDATION_ERROR',
    0,
    null,
    'VALIDATION',
    null,
    Object.freeze({ field, reason }),
  );
}

export function validateFileSelection(
  workflow: FileUploadWorkflow,
  files: readonly File[],
): readonly ValidatedFileSelection[] {
  if (files.length < 1) throw validationError('file_count_empty');
  if (files.length > workflow.maximumFileCount) {
    throw validationError('file_count_exceeded');
  }

  const identities = new Set<File>();
  const fingerprints = new Set<string>();
  return Object.freeze(files.map((file) => {
    if (identities.has(file)) throw validationError('duplicate_file_object');
    identities.add(file);
    const fingerprint = `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
    if (fingerprints.has(fingerprint)) throw validationError('duplicate_file_descriptor');
    fingerprints.add(fingerprint);
    return Object.freeze({ file, descriptor: descriptorForFile(workflow, file) });
  }));
}

export function descriptorForFile(
  workflow: FileUploadWorkflow,
  file: File,
): Readonly<FileHttpUploadDescriptor> {
  const name = file.name.normalize('NFKC').trim();
  if (name.length < 3 || name.length > 180
    || /[\\/\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(name)
    || name.startsWith('.') || name.endsWith('.')) {
    throw validationError('invalid_file_name', 'client_file_name');
  }
  const lastDot = name.lastIndexOf('.');
  if (lastDot < 1 || lastDot === name.length - 1) {
    throw validationError('invalid_file_extension', 'extension');
  }
  const extension = name.slice(lastDot + 1).toLocaleLowerCase('en-US');
  if (!Object.hasOwn(EXTENSION_MIME, extension)) {
    throw validationError('unsupported_file_extension', 'extension');
  }
  if (name.indexOf('.') !== lastDot) {
    throw validationError('multiple_file_extensions', 'client_file_name');
  }
  const typedExtension = extension as SupportedFileExtension;
  const mime = file.type.trim().toLocaleLowerCase('en-US');
  if (mime.length < 1) throw validationError('empty_mime', 'declared_mime');
  if (!workflow.allowedMimes.includes(mime as SupportedFileMime)) {
    throw validationError('unsupported_mime', 'declared_mime');
  }
  if (EXTENSION_MIME[typedExtension] !== mime) {
    throw validationError('extension_mime_mismatch', 'declared_mime');
  }
  if (!Number.isSafeInteger(file.size) || file.size < 1) {
    throw validationError('invalid_byte_size', 'byte_size');
  }
  if (file.size > workflow.maximumByteSize) {
    throw validationError('file_size_exceeded', 'byte_size');
  }
  return Object.freeze({
    client_file_name: name,
    extension: typedExtension,
    declared_mime: mime as SupportedFileMime,
    byte_size: file.size,
  });
}

