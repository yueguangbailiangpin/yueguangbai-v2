import type { ErrorCategory, SafeDetails } from '../api/errors';
import type { FileUploadWorkflowKey } from './file-purpose-config';

export type FileUploadOperationState =
  | 'IDLE'
  | 'VALIDATING'
  | 'CREATING_INTENT'
  | 'INTENT_READY'
  | 'UPLOADING'
  | 'COMPLETING'
  | 'VERIFIED'
  | 'RESTART_REQUIRED'
  | 'FILE_NOT_VERIFIED'
  | 'ERROR'
  | 'CANCELED'
  | 'FILE_COMPENSATION_REQUIRED'
  | 'DEPENDENCY_UNAVAILABLE';

export type FileUploadSlotState =
  | 'PENDING'
  | 'UPLOADING'
  | 'UPLOADED'
  | 'FAILED'
  | 'CANCELED';

export type SafeFileUploadError = Readonly<{
  code: string;
  httpStatus: number;
  category: ErrorCategory;
  requestId: string | null;
  safeDetails: SafeDetails | null;
}>;

export type SafeVerifiedFile = Readonly<{
  file_object_id: string;
  file_version: number;
  purpose: string;
  visibility: string;
  detected_mime: string;
  byte_size: number;
  sha256: string;
}>;

export type SafeVerifiedManifest = Readonly<{
  upload_intent_id: string;
  intent_version: number;
  request_id: string;
  files: readonly SafeVerifiedFile[];
}>;

export type FileUploadSnapshot = Readonly<{
  workflow: FileUploadWorkflowKey | null;
  state: FileUploadOperationState;
  slots: readonly Readonly<{
    slotNo: number;
    fileObjectId: string | null;
    clientFileName: string;
    state: FileUploadSlotState;
  }>[];
  progress: Readonly<{
    mode: 'DETERMINATE' | 'INDETERMINATE';
    loadedBytes: number | null;
    totalBytes: number | null;
    percent: number | null;
    currentSlot: number | null;
    completedSlots: number;
    totalSlots: number;
  }>;
  requestId: string | null;
  error: SafeFileUploadError | null;
  manifest: SafeVerifiedManifest | null;
  canRetry: boolean;
  canCancel: boolean;
  restartRequired: boolean;
  requiresFileReselection: boolean;
}>;

export const initialFileUploadSnapshot: FileUploadSnapshot = Object.freeze({
  workflow: null,
  state: 'IDLE',
  slots: Object.freeze([]),
  progress: Object.freeze({
    mode: 'INDETERMINATE',
    loadedBytes: null,
    totalBytes: null,
    percent: null,
    currentSlot: null,
    completedSlots: 0,
    totalSlots: 0,
  }),
  requestId: null,
  error: null,
  manifest: null,
  canRetry: false,
  canCancel: false,
  restartRequired: false,
  requiresFileReselection: false,
});
