import { FileValidationError } from '@ygb/domain';

export type FileStorageErrorCode =
  | 'VALIDATION_ERROR'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VERSION_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'REQUEST_IN_PROGRESS'
  | 'DEPENDENCY_UNAVAILABLE'
  | 'UPLOAD_FAILED'
  | 'FILE_INTENT_NOT_FOUND'
  | 'FILE_OBJECT_NOT_FOUND'
  | 'FILE_UPLOAD_EXPIRED'
  | 'FILE_VALIDATION_FAILED'
  | 'FILE_NOT_VERIFIED'
  | 'FILE_STORAGE_CONFLICT'
  | 'FILE_COMPENSATION_REQUIRED'
  | 'FILE_READ_INTENT_NOT_FOUND'
  | 'FILE_ARCHIVED';

export class FileStorageError extends Error {
  constructor(
    public readonly code: FileStorageErrorCode,
    public readonly status: 400 | 403 | 404 | 409 | 410 | 422 | 503,
    public readonly compensation: FileCompensationPlan | null = null,
  ) {
    super(code);
    this.name = 'FileStorageError';
  }
}

export interface FileCompensationPlan {
  uploadIntentId: string;
  objectIds: readonly string[];
  deletePendingObjectIds: readonly string[];
  reason: string;
}

export function normalizeFileStorageError(
  error: unknown,
): FileStorageError {
  if (error instanceof FileStorageError) return error;
  if (error instanceof FileValidationError) {
    return new FileStorageError('FILE_VALIDATION_FAILED', 422);
  }

  const record = error as { code?: unknown };
  if (record?.code === 'IDEMPOTENCY_CONFLICT') {
    return new FileStorageError('IDEMPOTENCY_CONFLICT', 409);
  }
  if (record?.code === 'REQUEST_IN_PROGRESS') {
    return new FileStorageError('REQUEST_IN_PROGRESS', 409);
  }

  const message = String(error);
  if (message.includes('transaction_assertion_failed')) {
    return new FileStorageError('VERSION_CONFLICT', 409);
  }
  if (message.includes('UNIQUE constraint failed')) {
    return new FileStorageError('FILE_STORAGE_CONFLICT', 409);
  }
  return new FileStorageError('DEPENDENCY_UNAVAILABLE', 503);
}
