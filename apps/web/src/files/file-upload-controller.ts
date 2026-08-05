import type { QueryClient } from '@tanstack/react-query';
import {
  FrontendApiError,
  isCanceledFrontendError,
  normalizeFrontendControllerError,
} from '../api/errors';
import { completePurposeBoundUploadIntent, createPurposeBoundUploadIntent } from './file-upload-api';
import type { UploadedFileReceipt } from './file-contracts';
import { validateFileSelection, type ValidatedFileSelection } from './file-descriptor';
import {
  initialFileUploadSnapshot,
  type FileUploadSlotState,
  type FileUploadSnapshot,
  type SafeFileUploadError,
} from './file-upload-operation';
import {
  requireFileUploadWorkflow,
  type FileUploadWorkflow,
  type FileUploadWorkflowKey,
} from './file-purpose-config';
import { uploadSingleFileMultipart, type UploadProgress } from './file-upload-transport';
import {
  assertFileUploadTransition,
  FileUploadTransitionError,
} from './file-transfer-machine';

type PrivateSlot = {
  slotNo: number;
  fileObjectId: string;
  uploadToken: string | null;
  idempotencyKey: string | null;
  selection: ValidatedFileSelection;
  receipt: UploadedFileReceipt | null;
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

  start(workflowKey: unknown, files: readonly File[]): Promise<void> {
    if (this.active) return this.active;
    if (!this.snapshot.canStartNewOperation) {
      return Promise.resolve();
    }
    let workflow: FileUploadWorkflow;
    try {
      workflow = requireFileUploadWorkflow(workflowKey);
    } catch (error: unknown) {
      if (!(error instanceof TypeError)) throw error;
      this.publishFailure(
        new FrontendApiError(
          'VALIDATION_ERROR', 0, null, 'VALIDATION', null,
          Object.freeze({ field: 'workflow', reason: 'unsupported_workflow' }),
        ),
        'ERROR',
        false,
        false,
      );
      return Promise.resolve();
    }
    this.releasePrivateState(true);
    const validatedWorkflowKey = workflowKey as FileUploadWorkflowKey;
    this.workflowKey = validatedWorkflowKey;
    this.workflow = workflow;
    this.publish({
      ...initialFileUploadSnapshot,
      workflow: validatedWorkflowKey,
      state: 'VALIDATING',
    });
    try {
      this.selections = validateFileSelection(this.workflow, files);
    } catch (error: unknown) {
      this.publishFailure(error, 'ERROR', false, false);
      return Promise.resolve();
    }
    this.publishSelection('CREATING_INTENT');
    return this.run(() => this.createAndUpload());
  }

  async replaceFiles(
    workflowKey: unknown,
    files: readonly File[],
  ): Promise<void> {
    if (!this.snapshot.canReplaceFiles) return this.active ?? Promise.resolve();
    if (this.active) {
      const previous = this.active;
      this.cancel();
      await previous;
    } else if (this.snapshot.canCancel) {
      this.cancel();
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
    if (this.active || this.isCompleteRecoveryLocked()
      || !this.snapshot.restartRequired
      || !this.workflow || !this.workflowKey || !this.selections) {
      return this.active ?? Promise.resolve();
    }
    this.releaseIntentSecrets();
    this.publishSelection('CREATING_INTENT');
    return this.run(() => this.createAndUpload());
  }

  cancel(): void {
    if (!this.snapshot.canCancel) return;
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
          receipt: null,
          state: 'PENDING',
        })),
      };
      this.publishSlots('INTENT_READY', result.requestId);
      await this.uploadRemaining();
    } catch (error: unknown) {
      if (error instanceof FileUploadTransitionError) throw error;
      if (isCanceledFrontendError(error)) this.cancelFromFailure(error);
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
        slot.receipt = Object.freeze({
          detectedMime: result.data.detected_mime,
          byteSize: result.data.byte_size,
          sha256: result.data.sha256,
          uploadedVersion: result.data.version,
        });
        slot.uploadToken = null;
        slot.idempotencyKey = null;
        this.publishSlots('UPLOADING', result.requestId);
      } catch (error: unknown) {
        if (error instanceof FileUploadTransitionError) throw error;
        if (isCanceledFrontendError(error)) {
          slot.state = 'CANCELED';
          this.cancelFromFailure(error);
          return;
        }
        slot.state = 'FAILED';
        this.publishSlots('UPLOADING', this.snapshot.requestId);
        this.handleUploadFailure(error);
        return;
      }
    }
    await this.complete();
  }

  private async complete(): Promise<void> {
    if (!this.workflow || !this.intent
      || this.intent.slots.some(
        (slot) => slot.state !== 'UPLOADED' || slot.receipt === null,
      )) return;
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
        uploadedReceipts: new Map(this.intent.slots.map((slot) => [
          slot.fileObjectId,
          slot.receipt!,
        ])),
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
      this.releasePrivateState(true);
      this.publish({
        ...this.snapshot,
        state: 'VERIFIED',
        requestId: result.requestId,
        error: null,
        manifest,
        canRetry: false,
        restartRequired: false,
        requiresFileReselection: false,
      }, { completeValidated: true });
    } catch (error: unknown) {
      if (error instanceof FileUploadTransitionError) throw error;
      if (isCanceledFrontendError(error)) this.cancelFromFailure(error);
      else this.handleCompleteFailure(error);
    }
  }

  private handleUploadFailure(error: unknown): void {
    const apiError = normalizeFrontendControllerError(error);
    if (isAmbiguousRemoteResult(apiError)
      || apiError.code === 'REQUEST_IN_PROGRESS'
      || apiError.code === 'DEPENDENCY_UNAVAILABLE') {
      this.retryStage = 'UPLOAD';
      this.publishFailure(
        apiError,
        apiError.code === 'DEPENDENCY_UNAVAILABLE'
          ? 'DEPENDENCY_UNAVAILABLE'
          : 'ERROR',
        true,
        false,
      );
      return;
    }
    if (apiError.code === 'FILE_COMPENSATION_REQUIRED') {
      this.releasePrivateState(true);
      this.publishFailure(apiError, 'FILE_COMPENSATION_REQUIRED', false, false);
      return;
    }
    if (apiError.code === 'FILE_VALIDATION_FAILED') {
      this.releasePrivateState(true);
      this.publishFailure(apiError, 'ERROR', false, false, true);
      return;
    }
    const restart = apiError.code === 'UNAUTHENTICATED'
      || apiError.code === 'FORBIDDEN'
      || apiError.code === 'NOT_FOUND'
      || apiError.code === 'FILE_UPLOAD_EXPIRED'
      || apiError.code === 'VERSION_CONFLICT'
      || apiError.code === 'IDEMPOTENCY_CONFLICT'
      || apiError.code === 'FILE_STORAGE_CONFLICT'
      || apiError.category === 'CONTRACT';
    this.releaseIntentSecrets();
    this.publishFailure(
      apiError,
      restart ? 'RESTART_REQUIRED' : 'ERROR',
      false,
      restart,
    );
  }

  private handleCompleteFailure(error: unknown): void {
    const apiError = normalizeFrontendControllerError(error);
    if (isAmbiguousRemoteResult(apiError)
      || apiError.code === 'REQUEST_IN_PROGRESS'
      || apiError.code === 'DEPENDENCY_UNAVAILABLE') {
      this.retryStage = 'COMPLETE';
      this.publishFailure(
        apiError,
        apiError.code === 'DEPENDENCY_UNAVAILABLE'
          ? 'DEPENDENCY_UNAVAILABLE'
          : 'ERROR',
        true,
        false,
      );
      return;
    }
    if (apiError.code === 'FILE_COMPENSATION_REQUIRED') {
      this.releasePrivateState(true);
      this.publishFailure(apiError, 'FILE_COMPENSATION_REQUIRED', false, false);
      return;
    }
    if (apiError.code === 'FILE_NOT_VERIFIED') {
      this.releaseIntentSecrets();
      this.publishFailure(apiError, 'FILE_NOT_VERIFIED', false, true);
      return;
    }
    if (apiError.code === 'FILE_VALIDATION_FAILED') {
      this.releasePrivateState(true);
      this.publishFailure(apiError, 'ERROR', false, false, true);
      return;
    }
    const restart = apiError.code === 'UNAUTHENTICATED'
      || apiError.code === 'FORBIDDEN'
      || apiError.code === 'NOT_FOUND'
      || apiError.code === 'FILE_UPLOAD_EXPIRED'
      || apiError.code === 'VERSION_CONFLICT'
      || apiError.code === 'IDEMPOTENCY_CONFLICT'
      || apiError.code === 'FILE_STORAGE_CONFLICT'
      || apiError.category === 'CONTRACT';
    this.releaseIntentSecrets();
    this.publishFailure(
      apiError,
      restart ? 'RESTART_REQUIRED' : 'ERROR',
      false,
      restart,
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
      requiresFileReselection: false,
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
    requiresFileReselection = false,
  ): void {
    const projected = safeError(normalizeFrontendControllerError(error));
    this.publish({
      ...this.snapshot,
      workflow: this.workflowKey,
      state,
      requestId: projected.requestId,
      error: projected,
      canRetry,
      restartRequired,
      requiresFileReselection,
      manifest: null,
      progress: Object.freeze({ ...this.snapshot.progress, currentSlot: null }),
    });
  }

  private cancelFromFailure(error: unknown): void {
    this.releasePrivateState(true);
    this.publishFailure(error, 'CANCELED', false, false);
  }

  private releaseIntentSecrets(): void {
    this.releaseAllSlotAuthorities();
    this.intent = null;
    this.createKey = null;
    this.completeKey = null;
    this.retryStage = null;
    this.abortController = null;
  }

  private releaseAllSlotAuthorities(): void {
    if (!this.intent) return;
    for (const slot of this.intent.slots) {
      slot.uploadToken = null;
      slot.idempotencyKey = null;
    }
  }

  private releasePrivateState(releaseFiles: boolean): void {
    this.releaseIntentSecrets();
    if (releaseFiles) this.selections = null;
  }

  private publish(
    snapshot: FileUploadSnapshot,
    options: Readonly<{ completeValidated?: boolean }> = {},
  ): void {
    const prepared = Object.freeze({
      ...snapshot,
      canCancel: this.canCancel(snapshot),
      canStartNewOperation: this.canStartNewOperation(snapshot),
      canReplaceFiles: this.canReplaceFiles(snapshot),
    });
    assertFileUploadTransition(this.snapshot, prepared, options);
    this.snapshot = prepared;
    for (const listener of this.listeners) listener();
  }

  private canCancel(snapshot: FileUploadSnapshot): boolean {
    if (snapshot.state === 'VALIDATING'
      || snapshot.state === 'CREATING_INTENT'
      || snapshot.state === 'INTENT_READY'
      || snapshot.state === 'UPLOADING') return true;
    if (snapshot.state === 'ERROR') return this.retryStage === 'UPLOAD';
    return snapshot.state === 'DEPENDENCY_UNAVAILABLE'
      && this.retryStage === 'UPLOAD';
  }

  private canStartNewOperation(snapshot: FileUploadSnapshot): boolean {
    if (this.isCompleteRecoveryLocked(snapshot)
      || snapshot.state === 'FILE_COMPENSATION_REQUIRED') return false;
    if (snapshot.state === 'IDLE'
      || snapshot.state === 'CANCELED'
      || snapshot.state === 'VERIFIED'
      || snapshot.state === 'RESTART_REQUIRED'
      || snapshot.state === 'FILE_NOT_VERIFIED') return true;
    return snapshot.state === 'ERROR'
      && (snapshot.requiresFileReselection || this.retryStage === null);
  }

  private canReplaceFiles(snapshot: FileUploadSnapshot): boolean {
    if (this.isCompleteRecoveryLocked(snapshot)
      || snapshot.state === 'FILE_COMPENSATION_REQUIRED') return false;
    if (snapshot.state === 'VALIDATING'
      || snapshot.state === 'CREATING_INTENT'
      || snapshot.state === 'INTENT_READY'
      || snapshot.state === 'UPLOADING') return true;
    if ((snapshot.state === 'ERROR' || snapshot.state === 'DEPENDENCY_UNAVAILABLE')
      && this.retryStage === 'UPLOAD') return true;
    return this.canStartNewOperation(snapshot);
  }

  private isCompleteRecoveryLocked(snapshot = this.snapshot): boolean {
    return snapshot.state === 'COMPLETING'
      || ((snapshot.state === 'ERROR'
        || snapshot.state === 'DEPENDENCY_UNAVAILABLE')
        && this.retryStage === 'COMPLETE');
  }
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

function isAmbiguousRemoteResult(error: FrontendApiError): boolean {
  return error.code === 'NETWORK_FAILURE'
    || (error.code === 'MALFORMED_RESPONSE'
      && error.httpStatus >= 200
      && error.httpStatus < 300);
}
