import type { QueryClient } from '@tanstack/react-query';
import { FrontendApiError, isFrontendApiError } from '../api/errors';
import { completePurposeBoundUploadIntent, createPurposeBoundUploadIntent } from './file-upload-api';
import { validateFileSelection, type ValidatedFileSelection } from './file-descriptor';
import {
  initialFileUploadSnapshot,
  type FileUploadSlotState,
  type FileUploadSnapshot,
  type SafeFileUploadError,
} from './file-upload-operation';
import {
  fileUploadWorkflows,
  requireFileUploadWorkflow,
  type FileUploadWorkflow,
  type FileUploadWorkflowKey,
} from './file-purpose-config';
import { uploadSingleFileMultipart, type UploadProgress } from './file-upload-transport';

type PrivateSlot = {
  slotNo: number;
  fileObjectId: string;
  uploadToken: string | null;
  idempotencyKey: string | null;
  selection: ValidatedFileSelection;
  state: FileUploadSlotState;
};

type PrivateIntent = {
  id: string;
  version: number;
  slots: PrivateSlot[];
};

type RetryStage = 'UPLOAD' | 'COMPLETE' | null;

export class FileUploadController {
  private snapshot: FileUploadSnapshot = initialFileUploadSnapshot;
  private readonly listeners = new Set<() => void>();
  private workflowKey: FileUploadWorkflowKey | null = null;
  private workflow: FileUploadWorkflow | null = null;
  private selections: readonly ValidatedFileSelection[] | null = null;
  private intent: PrivateIntent | null = null;
  private createKey: string | null = null;
  private completeKey: string | null = null;
  private abortController: AbortController | null = null;
  private active: Promise<void> | null = null;
  private retryStage: RetryStage = null;

  constructor(
    private readonly client: QueryClient,
    private readonly generateKey: () => string = () => crypto.randomUUID(),
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = (): FileUploadSnapshot => this.snapshot;

  start(workflowKey: FileUploadWorkflowKey, files: readonly File[]): Promise<void> {
    if (this.active) return this.active;
    this.releasePrivateState(true);
    this.workflowKey = workflowKey;
    try {
      this.workflow = requireFileUploadWorkflow(workflowKey);
      this.publish({
        ...initialFileUploadSnapshot,
        workflow: workflowKey,
        state: 'VALIDATING',
      });
      this.selections = validateFileSelection(this.workflow, files);
      this.publishSelection('CREATING_INTENT');
    } catch (error: unknown) {
      const safe = error instanceof TypeError
        ? new FrontendApiError(
          'VALIDATION_ERROR', 0, null, 'VALIDATION', null,
          Object.freeze({ field: 'workflow', reason: 'unsupported_workflow' }),
        )
        : error;
      this.publishFailure(safe, 'ERROR', false, false);
      return Promise.resolve();
    }
    return this.run(() => this.createAndUpload());
  }

  async replaceFiles(
    workflowKey: FileUploadWorkflowKey,
    files: readonly File[],
  ): Promise<void> {
    if (this.active) {
      const previous = this.active;
      this.cancel();
      await previous;
    }
    await this.start(workflowKey, files);
  }

  retry(): Promise<void> {
    if (this.active || !this.snapshot.canRetry) return this.active ?? Promise.resolve();
    if (this.retryStage === 'UPLOAD') return this.run(() => this.uploadRemaining());
    if (this.retryStage === 'COMPLETE') return this.run(() => this.complete());
    return Promise.resolve();
  }

  restart(): Promise<void> {
    if (this.active || !this.snapshot.restartRequired
      || !this.workflow || !this.workflowKey || !this.selections) {
      return this.active ?? Promise.resolve();
    }
    this.releaseIntentSecrets();
    this.publishSelection('CREATING_INTENT');
    return this.run(() => this.createAndUpload());
  }

  cancel(): void {
    this.abortController?.abort();
    const slots = this.snapshot.slots.map((slot) => Object.freeze({
      ...slot,
      state: slot.state === 'UPLOADED' ? slot.state : 'CANCELED' as const,
    }));
    this.releasePrivateState(true);
    this.publish({
      ...this.snapshot,
      state: 'CANCELED',
      slots: Object.freeze(slots),
      progress: Object.freeze({ ...this.snapshot.progress, currentSlot: null }),
      error: safeError(new FrontendApiError('CANCELED', 0, null, 'CANCELED')),
      canRetry: false,
      restartRequired: false,
    });
  }

  private run(operation: () => Promise<void>): Promise<void> {
    const promise = operation().finally(() => {
      if (this.active === promise) this.active = null;
    });
    this.active = promise;
    return promise;
  }

  private async createAndUpload(): Promise<void> {
    if (!this.workflow || !this.selections) return;
    this.abortController = new AbortController();
    this.createKey = this.generateKey();
    try {
      const result = await createPurposeBoundUploadIntent({
        client: this.client,
        workflow: this.workflow,
        files: this.selections,
        idempotencyKey: this.createKey,
        signal: this.abortController.signal,
      });
      this.createKey = null;
      if (result.data.replayed || result.data.uploads.some(
        (slot) => !slot.upload_token_available || slot.upload_token === null,
      )) {
        this.releaseIntentSecrets();
        this.publishFailure(
          new FrontendApiError('UPLOAD_INTENT_REPLAYED', 409, result.requestId, 'CONFLICT'),
          'RESTART_REQUIRED',
          false,
          true,
        );
        return;
      }
      const ordered = [...result.data.uploads].sort((a, b) => a.slot_no - b.slot_no);
      this.intent = {
        id: result.data.upload_intent_id,
        version: result.data.version,
        slots: ordered.map((slot) => ({
          slotNo: slot.slot_no,
          fileObjectId: slot.file_object_id,
          uploadToken: slot.upload_token,
          idempotencyKey: null,
          selection: this.selections![slot.slot_no - 1]!,
          state: 'PENDING',
        })),
      };
      this.publishSlots('INTENT_READY', result.requestId);
      await this.uploadRemaining();
    } catch (error: unknown) {
      if (isCanceled(error)) this.cancelFromFailure(error);
      else {
        this.createKey = null;
        this.publishFailure(error, 'RESTART_REQUIRED', false, true);
      }
    }
  }

  private async uploadRemaining(): Promise<void> {
    if (!this.workflow || !this.intent) return;
    this.abortController = new AbortController();
    for (const slot of this.intent.slots) {
      if (slot.state === 'UPLOADED') continue;
      if (!slot.uploadToken) {
        this.publishFailure(
          new FrontendApiError('FILE_UPLOAD_EXPIRED', 410, null, 'CONFLICT'),
          'RESTART_REQUIRED', false, true,
        );
        return;
      }
      slot.idempotencyKey ??= this.generateKey();
      slot.state = 'UPLOADING';
      this.publishSlotProgress(slot, {
        mode: 'INDETERMINATE', loadedBytes: null, totalBytes: null, percent: null,
      });
      try {
        const result = await uploadSingleFileMultipart({
          client: this.client,
          identity: this.workflow.identity,
          lifecyclePrefix: this.workflow.lifecyclePrefix,
          intentId: this.intent.id,
          fileObjectId: slot.fileObjectId,
          file: slot.selection.file,
          uploadToken: slot.uploadToken,
          idempotencyKey: slot.idempotencyKey,
          signal: this.abortController.signal,
          onProgress: (progress) => this.publishSlotProgress(slot, progress),
        });
        slot.state = 'UPLOADED';
        slot.uploadToken = null;
        slot.idempotencyKey = null;
        this.publishSlots('UPLOADING', result.requestId);
      } catch (error: unknown) {
        if (isCanceled(error)) {
          slot.state = 'CANCELED';
          this.cancelFromFailure(error);
          return;
        }
        slot.state = 'FAILED';
        this.publishSlots('UPLOADING', this.snapshot.requestId);
        this.handleUploadFailure(error, slot);
        return;
      }
    }
    await this.complete();
  }

  private async complete(): Promise<void> {
    if (!this.workflow || !this.intent
      || this.intent.slots.some((slot) => slot.state !== 'UPLOADED')) return;
    this.abortController = new AbortController();
    this.completeKey ??= this.generateKey();
    this.retryStage = 'COMPLETE';
    this.publishSlots('COMPLETING', this.snapshot.requestId);
    try {
      const result = await completePurposeBoundUploadIntent({
        client: this.client,
        workflow: this.workflow,
        intentId: this.intent.id,
        expectedVersion: this.intent.version,
        fileObjectIds: new Set(this.intent.slots.map((slot) => slot.fileObjectId)),
        idempotencyKey: this.completeKey,
        signal: this.abortController.signal,
      });
      this.completeKey = null;
      this.retryStage = null;
      const manifest = Object.freeze({
        upload_intent_id: result.data.upload_intent_id,
        intent_version: result.data.version,
        request_id: result.requestId,
        files: Object.freeze(result.data.files.map((file) => Object.freeze({
          file_object_id: file.file_object_id,
          file_version: file.version,
          purpose: file.purpose,
          visibility: file.visibility,
          detected_mime: file.detected_mime,
          byte_size: file.byte_size,
          sha256: file.sha256,
        }))),
      });
      this.selections = null;
      this.intent = null;
      this.publish({
        ...this.snapshot,
        state: 'VERIFIED',
        requestId: result.requestId,
        error: null,
        manifest,
        canRetry: false,
        restartRequired: false,
      });
    } catch (error: unknown) {
      if (isCanceled(error)) this.cancelFromFailure(error);
      else this.handleCompleteFailure(error);
    }
  }

  private handleUploadFailure(error: unknown, slot: PrivateSlot): void {
    const apiError = normalized(error);
    const restart = apiError.code === 'FILE_UPLOAD_EXPIRED'
      || apiError.code === 'FORBIDDEN'
      || apiError.code === 'VERSION_CONFLICT'
      || apiError.code === 'IDEMPOTENCY_CONFLICT'
      || apiError.code === 'FILE_STORAGE_CONFLICT';
    if (restart) {
      this.releaseIntentSecrets();
      this.publishFailure(apiError, 'RESTART_REQUIRED', false, true);
      return;
    }
    if (apiError.code === 'FILE_COMPENSATION_REQUIRED') {
      this.releaseIntentSecrets();
      this.publishFailure(apiError, 'FILE_COMPENSATION_REQUIRED', false, false);
      return;
    }
    const retryable = apiError.code === 'NETWORK_FAILURE'
      || apiError.code === 'REQUEST_IN_PROGRESS'
      || apiError.code === 'DEPENDENCY_UNAVAILABLE';
    this.retryStage = retryable ? 'UPLOAD' : null;
    if (!retryable) {
      slot.idempotencyKey = null;
      slot.uploadToken = null;
    }
    const state = apiError.code === 'DEPENDENCY_UNAVAILABLE'
      ? 'DEPENDENCY_UNAVAILABLE'
      : 'ERROR';
    this.publishFailure(apiError, state, retryable, false);
  }

  private handleCompleteFailure(error: unknown): void {
    const apiError = normalized(error);
    if (apiError.code === 'FILE_COMPENSATION_REQUIRED') {
      this.releaseIntentSecrets();
      this.publishFailure(apiError, 'FILE_COMPENSATION_REQUIRED', false, false);
      return;
    }
    const restart = apiError.code === 'FILE_UPLOAD_EXPIRED'
      || apiError.code === 'VERSION_CONFLICT'
      || apiError.code === 'IDEMPOTENCY_CONFLICT'
      || apiError.code === 'FILE_STORAGE_CONFLICT';
    if (restart) {
      this.releaseIntentSecrets();
      this.publishFailure(apiError, 'RESTART_REQUIRED', false, true);
      return;
    }
    const retryable = apiError.code === 'NETWORK_FAILURE'
      || apiError.code === 'REQUEST_IN_PROGRESS'
      || apiError.code === 'DEPENDENCY_UNAVAILABLE';
    this.retryStage = retryable ? 'COMPLETE' : null;
    if (!retryable) this.completeKey = null;
    this.publishFailure(
      apiError,
      apiError.code === 'DEPENDENCY_UNAVAILABLE' ? 'DEPENDENCY_UNAVAILABLE' : 'ERROR',
      retryable,
      false,
    );
  }

  private publishSelection(state: FileUploadSnapshot['state']): void {
    const selections = this.selections ?? [];
    this.publish({
      ...initialFileUploadSnapshot,
      workflow: this.workflowKey,
      state,
      slots: Object.freeze(selections.map((selection, index) => Object.freeze({
        slotNo: index + 1,
        fileObjectId: null,
        clientFileName: selection.descriptor.client_file_name,
        state: 'PENDING' as const,
      }))),
      progress: Object.freeze({
        ...initialFileUploadSnapshot.progress,
        totalSlots: selections.length,
      }),
    });
  }

  private publishSlots(state: FileUploadSnapshot['state'], requestId: string | null): void {
    const intent = this.intent;
    if (!intent) return;
    this.publish({
      ...this.snapshot,
      state,
      slots: Object.freeze(intent.slots.map((slot) => Object.freeze({
        slotNo: slot.slotNo,
        fileObjectId: slot.fileObjectId,
        clientFileName: slot.selection.descriptor.client_file_name,
        state: slot.state,
      }))),
      progress: Object.freeze({
        ...this.snapshot.progress,
        currentSlot: state === 'UPLOADING' ? this.snapshot.progress.currentSlot : null,
        completedSlots: intent.slots.filter((slot) => slot.state === 'UPLOADED').length,
        totalSlots: intent.slots.length,
      }),
      requestId,
      error: null,
      canRetry: false,
      restartRequired: false,
    });
  }

  private publishSlotProgress(slot: PrivateSlot, progress: UploadProgress): void {
    this.publishSlots('UPLOADING', this.snapshot.requestId);
    this.publish({
      ...this.snapshot,
      progress: Object.freeze({
        ...progress,
        currentSlot: slot.slotNo,
        completedSlots: this.intent?.slots.filter(
          (candidate) => candidate.state === 'UPLOADED',
        ).length ?? 0,
        totalSlots: this.intent?.slots.length ?? 0,
      }),
    });
  }

  private publishFailure(
    error: unknown,
    state: FileUploadSnapshot['state'],
    canRetry: boolean,
    restartRequired: boolean,
  ): void {
    const projected = safeError(normalized(error));
    this.publish({
      ...this.snapshot,
      workflow: this.workflowKey,
      state,
      requestId: projected.requestId,
      error: projected,
      canRetry,
      restartRequired,
      manifest: null,
      progress: Object.freeze({ ...this.snapshot.progress, currentSlot: null }),
    });
  }

  private cancelFromFailure(error: unknown): void {
    this.releasePrivateState(true);
    this.publishFailure(error, 'CANCELED', false, false);
  }

  private releaseIntentSecrets(): void {
    if (this.intent) {
      for (const slot of this.intent.slots) {
        slot.uploadToken = null;
        slot.idempotencyKey = null;
      }
    }
    this.intent = null;
    this.createKey = null;
    this.completeKey = null;
    this.retryStage = null;
    this.abortController = null;
  }

  private releasePrivateState(releaseFiles: boolean): void {
    this.releaseIntentSecrets();
    if (releaseFiles) this.selections = null;
  }

  private publish(snapshot: FileUploadSnapshot): void {
    this.snapshot = Object.freeze(snapshot);
    for (const listener of this.listeners) listener();
  }
}

function normalized(error: unknown): FrontendApiError {
  if (isFrontendApiError(error)) return error;
  return new FrontendApiError('MALFORMED_RESPONSE', 0, null, 'CONTRACT');
}

function safeError(error: FrontendApiError): SafeFileUploadError {
  return Object.freeze({
    code: error.code,
    httpStatus: error.httpStatus,
    category: error.category,
    requestId: error.requestId,
    safeDetails: error.safeDetails,
  });
}

function isCanceled(error: unknown): boolean {
  return isFrontendApiError(error) && error.code === 'CANCELED';
}

export function workflowForTest(key: FileUploadWorkflowKey): FileUploadWorkflow {
  return fileUploadWorkflows[key];
}
