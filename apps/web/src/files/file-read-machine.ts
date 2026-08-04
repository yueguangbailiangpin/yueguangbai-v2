import type {
  FileReadOperationState,
  FileReadSnapshot,
} from './file-read-operation';

const states = (...values: FileReadOperationState[]):
ReadonlySet<FileReadOperationState> => new Set(values);

export const FILE_READ_TRANSITIONS: Readonly<Record<
  FileReadOperationState,
  ReadonlySet<FileReadOperationState>
>> = Object.freeze({
  IDLE: states('VALIDATING_REFERENCE', 'ERROR'),
  VALIDATING_REFERENCE: states('CREATING_READ_INTENT', 'ERROR', 'CANCELED'),
  CREATING_READ_INTENT: states(
    'READ_READY', 'RESTART_REQUIRED', 'ERROR', 'CANCELED',
  ),
  READ_READY: states('DOWNLOADING', 'RESTART_REQUIRED', 'CANCELED'),
  DOWNLOADING: states(
    'READY', 'RESTART_REQUIRED', 'ERROR', 'CANCELED',
    'DEPENDENCY_UNAVAILABLE', 'FILE_STORAGE_CONFLICT',
  ),
  READY: states('VALIDATING_REFERENCE', 'IDLE'),
  RESTART_REQUIRED: states('CREATING_READ_INTENT', 'VALIDATING_REFERENCE'),
  ERROR: states('VALIDATING_REFERENCE', 'IDLE'),
  CANCELED: states('CREATING_READ_INTENT', 'VALIDATING_REFERENCE', 'IDLE'),
  DEPENDENCY_UNAVAILABLE: states(
    'DOWNLOADING', 'VALIDATING_REFERENCE', 'CANCELED',
  ),
  FILE_STORAGE_CONFLICT: states('VALIDATING_REFERENCE', 'IDLE'),
});

export class FileReadTransitionError extends Error {
  override readonly name = 'FileReadTransitionError';
}

export function assertFileReadTransition(
  previous: FileReadSnapshot,
  next: FileReadSnapshot,
  readyBytesValidated = false,
): void {
  if (previous.state !== next.state
    && !FILE_READ_TRANSITIONS[previous.state].has(next.state)) {
    throw new FileReadTransitionError(
      `invalid_file_read_transition:${previous.state}:${next.state}`,
    );
  }
  if (next.state === 'READY'
    && (!readyBytesValidated
      || next.ephemeralObjectUrl === null
      || next.contentType === null
      || next.byteSize === null
      || next.progress.percent !== 100)) {
    throw new FileReadTransitionError('ready_requires_validated_bytes');
  }
  if (next.state !== 'READY' && next.ephemeralObjectUrl !== null) {
    throw new FileReadTransitionError('object_url_requires_ready');
  }
}

