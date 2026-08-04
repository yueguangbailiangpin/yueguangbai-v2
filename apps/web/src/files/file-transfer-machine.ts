import type { FileUploadOperationState as FileTransferState } from './file-upload-operation';
import type { FileUploadSnapshot } from './file-upload-operation';

export type { FileTransferState };

const stateSet = (...states: FileTransferState[]): ReadonlySet<FileTransferState> =>
  new Set(states);

export const FILE_UPLOAD_TRANSITIONS: Readonly<Record<
  FileTransferState,
  ReadonlySet<FileTransferState>
>> = Object.freeze({
  IDLE: stateSet('VALIDATING', 'ERROR'),
  VALIDATING: stateSet('CREATING_INTENT', 'ERROR', 'CANCELED'),
  CREATING_INTENT: stateSet('INTENT_READY', 'RESTART_REQUIRED', 'ERROR', 'CANCELED'),
  INTENT_READY: stateSet('UPLOADING', 'CANCELED'),
  UPLOADING: stateSet(
    'COMPLETING', 'ERROR', 'RESTART_REQUIRED', 'CANCELED',
    'FILE_COMPENSATION_REQUIRED', 'DEPENDENCY_UNAVAILABLE',
  ),
  COMPLETING: stateSet(
    'VERIFIED', 'ERROR', 'RESTART_REQUIRED', 'FILE_NOT_VERIFIED',
    'FILE_COMPENSATION_REQUIRED', 'DEPENDENCY_UNAVAILABLE',
  ),
  VERIFIED: stateSet('VALIDATING', 'ERROR'),
  RESTART_REQUIRED: stateSet('VALIDATING', 'CREATING_INTENT', 'ERROR'),
  FILE_NOT_VERIFIED: stateSet('VALIDATING', 'CREATING_INTENT', 'ERROR'),
  ERROR: stateSet('UPLOADING', 'COMPLETING', 'VALIDATING', 'CANCELED'),
  CANCELED: stateSet('VALIDATING', 'ERROR'),
  FILE_COMPENSATION_REQUIRED: stateSet(),
  DEPENDENCY_UNAVAILABLE: stateSet(
    'UPLOADING', 'COMPLETING', 'VALIDATING', 'CANCELED',
  ),
});

export class FileUploadTransitionError extends Error {
  override readonly name = 'FileUploadTransitionError';
}

export function assertFileUploadTransition(
  previous: FileUploadSnapshot,
  next: FileUploadSnapshot,
  options: Readonly<{ completeValidated?: boolean }> = {},
): void {
  if (previous.state !== next.state
    && !FILE_UPLOAD_TRANSITIONS[previous.state].has(next.state)) {
    throw new FileUploadTransitionError(
      `invalid_file_upload_transition:${previous.state}:${next.state}`,
    );
  }
  if (next.state === 'COMPLETING'
    && next.slots.some((slot) => slot.state !== 'UPLOADED')) {
    throw new FileUploadTransitionError('complete_requires_all_slots_uploaded');
  }
  if (next.state === 'VERIFIED'
    && (options.completeValidated !== true || next.manifest === null)) {
    throw new FileUploadTransitionError('verified_requires_valid_complete_manifest');
  }
}
