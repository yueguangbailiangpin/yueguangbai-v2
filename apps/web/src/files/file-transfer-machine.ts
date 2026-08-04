import type { FileUploadOperationState as FileTransferState } from './file-upload-operation';
import type { FileUploadSnapshot } from './file-upload-operation';

export type { FileTransferState };

export type FileTransferEvent =
  | 'VALIDATE' | 'CREATE' | 'INTENT_READY' | 'UPLOAD' | 'COMPLETE' | 'VERIFIED'
  | 'RESTART' | 'CANCEL' | 'COMPENSATION' | 'DEPENDENCY' | 'FAIL';

export function fileTransferReducer(state: FileTransferState, event: FileTransferEvent): FileTransferState {
  const transitions: Readonly<Record<FileTransferState, Partial<Record<FileTransferEvent, FileTransferState>>>> = {
    IDLE: { VALIDATE: 'VALIDATING' },
    VALIDATING: { CREATE: 'CREATING_INTENT', FAIL: 'ERROR', CANCEL: 'CANCELED' },
    CREATING_INTENT: { INTENT_READY: 'INTENT_READY', RESTART: 'RESTART_REQUIRED', FAIL: 'ERROR', CANCEL: 'CANCELED' },
    INTENT_READY: { UPLOAD: 'UPLOADING', CANCEL: 'CANCELED' },
    UPLOADING: {
      COMPLETE: 'COMPLETING', RESTART: 'RESTART_REQUIRED', FAIL: 'ERROR',
      CANCEL: 'CANCELED', COMPENSATION: 'FILE_COMPENSATION_REQUIRED',
      DEPENDENCY: 'DEPENDENCY_UNAVAILABLE',
    },
    COMPLETING: { VERIFIED: 'VERIFIED', RESTART: 'RESTART_REQUIRED', COMPENSATION: 'FILE_COMPENSATION_REQUIRED', DEPENDENCY: 'DEPENDENCY_UNAVAILABLE', FAIL: 'ERROR' },
    VERIFIED: { VALIDATE: 'VALIDATING' },
    RESTART_REQUIRED: { VALIDATE: 'VALIDATING', CREATE: 'CREATING_INTENT' },
    FILE_NOT_VERIFIED: { VALIDATE: 'VALIDATING', CREATE: 'CREATING_INTENT' },
    ERROR: { VALIDATE: 'VALIDATING', UPLOAD: 'UPLOADING', COMPLETE: 'COMPLETING', CANCEL: 'CANCELED' },
    CANCELED: { VALIDATE: 'VALIDATING' }, FILE_COMPENSATION_REQUIRED: {},
    DEPENDENCY_UNAVAILABLE: {
      VALIDATE: 'VALIDATING', UPLOAD: 'UPLOADING', COMPLETE: 'COMPLETING',
      CANCEL: 'CANCELED',
    },
  };
  return transitions[state][event] ?? state;
}

const stateSet = (...states: FileTransferState[]): ReadonlySet<FileTransferState> =>
  new Set(states);

const ALLOWED_TRANSITIONS: Readonly<Record<
  FileTransferState,
  ReadonlySet<FileTransferState>
>> = Object.freeze({
  IDLE: stateSet('VALIDATING'),
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
  VERIFIED: stateSet('VALIDATING'),
  RESTART_REQUIRED: stateSet('VALIDATING', 'CREATING_INTENT'),
  FILE_NOT_VERIFIED: stateSet('VALIDATING', 'CREATING_INTENT'),
  ERROR: stateSet('UPLOADING', 'COMPLETING', 'VALIDATING', 'CANCELED'),
  CANCELED: stateSet('VALIDATING'),
  FILE_COMPENSATION_REQUIRED: stateSet(),
  DEPENDENCY_UNAVAILABLE: stateSet(
    'UPLOADING', 'COMPLETING', 'VALIDATING', 'CANCELED',
  ),
});

export function assertFileUploadTransition(
  previous: FileUploadSnapshot,
  next: FileUploadSnapshot,
  options: Readonly<{ completeValidated?: boolean }> = {},
): void {
  if (previous.state !== next.state
    && !ALLOWED_TRANSITIONS[previous.state].has(next.state)) {
    throw new Error(`invalid_file_upload_transition:${previous.state}:${next.state}`);
  }
  if (next.state === 'COMPLETING'
    && next.slots.some((slot) => slot.state !== 'UPLOADED')) {
    throw new Error('complete_requires_all_slots_uploaded');
  }
  if (next.state === 'VERIFIED'
    && (options.completeValidated !== true || next.manifest === null)) {
    throw new Error('verified_requires_valid_complete_manifest');
  }
}
