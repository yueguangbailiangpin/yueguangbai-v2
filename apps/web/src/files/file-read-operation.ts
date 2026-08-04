import type { ErrorCategory, SafeDetails } from '../api/errors';
import type { RequestIdentity } from '../api/identity-request';
import type { SafeFileReference } from './file-read-contracts';

export type FileReadOperationState =
  | 'IDLE'
  | 'VALIDATING_REFERENCE'
  | 'CREATING_READ_INTENT'
  | 'READ_READY'
  | 'DOWNLOADING'
  | 'READY'
  | 'RESTART_REQUIRED'
  | 'ERROR'
  | 'CANCELED'
  | 'DEPENDENCY_UNAVAILABLE'
  | 'FILE_STORAGE_CONFLICT';

export type SafeFileReadError = Readonly<{
  code: string;
  httpStatus: number;
  category: ErrorCategory;
  requestId: string | null;
  retryAfter: number | null;
  safeDetails: SafeDetails | null;
}>;

export type FileReadProgress = Readonly<{
  loadedBytes: number;
  totalBytes: number | null;
  percent: number | null;
}>;

export type FileReadSnapshot = Readonly<{
  identity: RequestIdentity | null;
  safeFileReference: SafeFileReference | null;
  state: FileReadOperationState;
  progress: FileReadProgress;
  contentType: string | null;
  byteSize: number | null;
  ephemeralObjectUrl: string | null;
  requestId: string | null;
  safeError: SafeFileReadError | null;
  canRetry: boolean;
  canCancel: boolean;
  canStartNewOperation: boolean;
  canRelease: boolean;
  restartRequired: boolean;
}>;

export const initialFileReadSnapshot: FileReadSnapshot = Object.freeze({
  identity: null,
  safeFileReference: null,
  state: 'IDLE',
  progress: Object.freeze({
    loadedBytes: 0,
    totalBytes: null,
    percent: null,
  }),
  contentType: null,
  byteSize: null,
  ephemeralObjectUrl: null,
  requestId: null,
  safeError: null,
  canRetry: false,
  canCancel: false,
  canStartNewOperation: true,
  canRelease: false,
  restartRequired: false,
});

