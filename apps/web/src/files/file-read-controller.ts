import type { QueryClient } from '@tanstack/react-query';
import { FrontendApiError, isFrontendApiError } from '../api/errors';
import type { RequestIdentity } from '../api/identity-request';
import { createIdentityFileReadIntent } from './file-read-api';
import {
  safeFileReferenceSchema,
  type SafeFileReference,
} from './file-read-contracts';
import {
  assertFileReadTransition,
  FileReadTransitionError,
} from './file-read-machine';
import {
  initialFileReadSnapshot,
  type FileReadSnapshot,
  type SafeFileReadError,
} from './file-read-operation';
import { consumeIdentityFileReadIntent } from './file-read-transport';

type PrivateReadIntent = {
  id: string;
  accessToken: string | null;
};

export type ObjectUrlAdapter = Readonly<{
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (objectUrl: string) => void;
}>;

export type FileReadClock = Readonly<{
  now: () => number;
  schedule: (callback: () => void, delay: number) => () => void;
}>;

const browserObjectUrlAdapter: ObjectUrlAdapter = Object.freeze({
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (objectUrl) => URL.revokeObjectURL(objectUrl),
});

const browserFileReadClock: FileReadClock = Object.freeze({
  now: () => Date.now(),
  schedule: (callback, delay) => {
    const timer = window.setTimeout(callback, delay);
    return () => window.clearTimeout(timer);
  },
});

export class FileReadController {
  private snapshot: FileReadSnapshot = initialFileReadSnapshot;
  private readonly listeners = new Set<() => void>();
  private reference: SafeFileReference | null = null;
  private identity: RequestIdentity | null = null;
  private intent: PrivateReadIntent | null = null;
  private createKey: string | null = null;
  private abortController: AbortController | null = null;
  private active: Promise<void> | null = null;
  private mayRetryCurrentToken = false;
  private retryAvailableAt: number | null = null;
  private cancelRetryAvailability: (() => void) | null = null;
  private objectUrl: string | null = null;

  constructor(
    private readonly client: QueryClient,
    private readonly generateKey: () => string = () => crypto.randomUUID(),
    private readonly objectUrls: ObjectUrlAdapter = browserObjectUrlAdapter,
    private readonly clock: FileReadClock = browserFileReadClock,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = (): FileReadSnapshot => this.snapshot;

  start(identity: unknown, reference: unknown): Promise<void> {
    if (this.active || !this.snapshot.canStartNewOperation) {
      return this.active ?? Promise.resolve();
    }
    this.release();
    this.releaseIntentAuthority();
    if (!isRequestIdentity(identity)) {
      this.publishValidationFailure('identity', 'unsupported_identity');
      return Promise.resolve();
    }
    this.identity = identity;
    this.publish({
      ...initialFileReadSnapshot,
      identity,
      state: 'VALIDATING_REFERENCE',
    });
    const parsed = safeFileReferenceSchema.safeParse(reference);
    if (!parsed.success) {
      this.publishValidationFailure('safeFileReference', 'invalid_reference');
      return Promise.resolve();
    }
    this.reference = Object.freeze(parsed.data);
    this.publish({
      ...this.snapshot,
      safeFileReference: this.reference,
      state: 'CREATING_READ_INTENT',
    });
    return this.run(() => this.createAndDownload());
  }

  retry(): Promise<void> {
    if (this.active || !this.mayRetryCurrentToken) {
      return this.active ?? Promise.resolve();
    }
    if (this.retryAvailableAt !== null) {
      if (this.clock.now() < this.retryAvailableAt) return Promise.resolve();
      this.clearRetryWindow();
      this.publish({ ...this.snapshot, canRetry: true });
    }
    if (!this.snapshot.canRetry) return Promise.resolve();
    return this.run(() => this.download());
  }

  restart(): Promise<void> {
    if (this.active || !this.snapshot.restartRequired
      || !this.identity || !this.reference) {
      return this.active ?? Promise.resolve();
    }
    this.releaseIntentAuthority();
    this.publish({
      ...this.snapshot,
      state: 'CREATING_READ_INTENT',
      safeError: null,
      canRetry: false,
      restartRequired: false,
      progress: initialFileReadSnapshot.progress,
    });
    return this.run(() => this.createAndDownload());
  }

  cancel(): void {
    if (!this.snapshot.canCancel) return;
    this.abortController?.abort();
    this.releaseIntentAuthority();
    this.publishFailure(
      new FrontendApiError('CANCELED', 0, null, 'CANCELED'),
      'CANCELED',
      false,
      true,
    );
  }

  release(): void {
    if (this.objectUrl !== null) {
      this.objectUrls.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    if (this.snapshot.ephemeralObjectUrl !== null) {
      this.publish({
        ...this.snapshot,
        state: 'IDLE',
        contentType: null,
        byteSize: null,
        ephemeralObjectUrl: null,
        progress: initialFileReadSnapshot.progress,
        canRelease: false,
      });
    }
  }

  dispose(): void {
    this.abortController?.abort();
    this.releaseIntentAuthority();
    this.release();
    this.listeners.clear();
  }

  private run(operation: () => Promise<void>): Promise<void> {
    const promise = operation().finally(() => {
      if (this.active === promise) this.active = null;
    });
    this.active = promise;
    return promise;
  }

  private async createAndDownload(): Promise<void> {
    if (!this.identity || !this.reference) return;
    this.abortController = new AbortController();
    this.createKey = this.generateKey();
    try {
      const result = await createIdentityFileReadIntent({
        client: this.client,
        identity: this.identity,
        reference: this.reference,
        idempotencyKey: this.createKey,
        signal: this.abortController.signal,
      });
      this.createKey = null;
      if (result.data.replayed
        || !result.data.access_token_available
        || result.data.access_token === null) {
        this.releaseIntentAuthority();
        this.publishFailure(
          new FrontendApiError(
            'FILE_READ_INTENT_REPLAYED', 409, result.requestId, 'CONFLICT',
          ),
          'RESTART_REQUIRED',
          false,
          true,
        );
        return;
      }
      this.intent = {
        id: result.data.read_intent_id,
        accessToken: result.data.access_token,
      };
      this.publish({
        ...this.snapshot,
        state: 'READ_READY',
        requestId: result.requestId,
        safeError: null,
      });
      await this.download();
    } catch (error: unknown) {
      if (error instanceof FileReadTransitionError) throw error;
      this.createKey = null;
      if (isCanceled(error)) {
        this.releaseIntentAuthority();
        this.publishFailure(error, 'CANCELED', false, true);
      } else {
        this.releaseIntentAuthority();
        this.publishFailure(error, 'RESTART_REQUIRED', false, true);
      }
    }
  }

  private async download(): Promise<void> {
    if (!this.identity || !this.intent?.accessToken) return;
    this.clearRetryWindow();
    this.abortController = new AbortController();
    this.mayRetryCurrentToken = false;
    this.publish({
      ...this.snapshot,
      state: 'DOWNLOADING',
      safeError: null,
      canRetry: false,
      restartRequired: false,
    });
    try {
      const result = await consumeIdentityFileReadIntent({
        client: this.client,
        identity: this.identity,
        readIntentId: this.intent.id,
        accessToken: this.intent.accessToken,
        signal: this.abortController.signal,
        onProgress: (progress) => {
          this.publish({ ...this.snapshot, progress });
        },
      });
      this.intent.accessToken = null;
      const blob = new Blob([result.bytes], { type: result.contentType });
      this.release();
      this.objectUrl = this.objectUrls.createObjectURL(blob);
      this.releaseIntentAuthority();
      this.publish({
        ...this.snapshot,
        state: 'READY',
        contentType: result.contentType,
        byteSize: result.byteSize,
        ephemeralObjectUrl: this.objectUrl,
        progress: Object.freeze({
          loadedBytes: result.byteSize,
          totalBytes: result.byteSize,
          percent: 100,
        }),
        safeError: null,
        canRetry: false,
        restartRequired: false,
      }, true);
    } catch (error: unknown) {
      if (error instanceof FileReadTransitionError) throw error;
      this.handleDownloadFailure(error);
    }
  }

  private handleDownloadFailure(error: unknown): void {
    const apiError = normalized(error);
    if (apiError.httpStatus === 429 || apiError.category === 'RATE_LIMIT') {
      if (apiError.retryAfter === null || apiError.retryAfter <= 0) {
        this.releaseIntentAuthority();
        this.publishFailure(apiError, 'RESTART_REQUIRED', false, true);
        return;
      }
      this.mayRetryCurrentToken = true;
      this.retryAvailableAt = this.clock.now() + apiError.retryAfter;
      this.scheduleRetryAvailability();
      this.publishFailure(
        apiError,
        'DEPENDENCY_UNAVAILABLE',
        false,
        true,
      );
      return;
    }
    if (apiError.code === 'DEPENDENCY_UNAVAILABLE'
      || apiError.httpStatus === 503) {
      this.clearRetryWindow();
      this.mayRetryCurrentToken = true;
      this.publishFailure(apiError, 'DEPENDENCY_UNAVAILABLE', true, false);
      return;
    }
    this.releaseIntentAuthority();
    if (apiError.code === 'FILE_STORAGE_CONFLICT') {
      this.publishFailure(apiError, 'FILE_STORAGE_CONFLICT', false, false);
      return;
    }
    if (apiError.code === 'FILE_UPLOAD_EXPIRED'
      || apiError.code === 'NETWORK_FAILURE'
      || apiError.code === 'MALFORMED_RESPONSE'
      || apiError.code === 'CANCELED') {
      this.publishFailure(
        apiError,
        apiError.code === 'CANCELED' ? 'CANCELED' : 'RESTART_REQUIRED',
        false,
        true,
      );
      return;
    }
    this.publishFailure(apiError, 'ERROR', false, false);
  }

  private publishValidationFailure(field: string, reason: string): void {
    this.publishFailure(new FrontendApiError(
      'VALIDATION_ERROR',
      0,
      null,
      'VALIDATION',
      null,
      Object.freeze({ field, reason }),
    ), 'ERROR', false, false);
  }

  private publishFailure(
    error: unknown,
    state: FileReadSnapshot['state'],
    canRetry: boolean,
    restartRequired: boolean,
  ): void {
    const projected = safeError(normalized(error));
    this.publish({
      ...this.snapshot,
      state,
      requestId: projected.requestId ?? this.snapshot.requestId,
      safeError: projected,
      canRetry,
      restartRequired,
      contentType: null,
      byteSize: null,
      ephemeralObjectUrl: null,
    });
  }

  private releaseIntentAuthority(): void {
    this.clearRetryWindow();
    if (this.intent) this.intent.accessToken = null;
    this.intent = null;
    this.createKey = null;
    this.abortController = null;
    this.mayRetryCurrentToken = false;
  }

  private scheduleRetryAvailability(): void {
    this.cancelRetryAvailability?.();
    const availableAt = this.retryAvailableAt;
    if (availableAt === null) return;
    const delay = Math.max(0, availableAt - this.clock.now());
    this.cancelRetryAvailability = this.clock.schedule(() => {
      this.cancelRetryAvailability = null;
      if (this.retryAvailableAt !== availableAt) return;
      if (this.clock.now() < availableAt) {
        this.scheduleRetryAvailability();
        return;
      }
      this.retryAvailableAt = null;
      if (this.snapshot.state === 'DEPENDENCY_UNAVAILABLE'
        && this.mayRetryCurrentToken
        && this.intent?.accessToken) {
        this.publish({ ...this.snapshot, canRetry: true });
      }
    }, delay);
  }

  private clearRetryWindow(): void {
    this.cancelRetryAvailability?.();
    this.cancelRetryAvailability = null;
    this.retryAvailableAt = null;
  }

  private publish(snapshot: FileReadSnapshot, readyBytesValidated = false): void {
    const prepared = Object.freeze({
      ...snapshot,
      canCancel: snapshot.state === 'CREATING_READ_INTENT'
        || snapshot.state === 'READ_READY'
        || snapshot.state === 'DOWNLOADING'
        || (snapshot.state === 'DEPENDENCY_UNAVAILABLE'
          && this.mayRetryCurrentToken),
      canStartNewOperation: snapshot.state === 'IDLE'
        || snapshot.state === 'READY'
        || snapshot.state === 'RESTART_REQUIRED'
        || snapshot.state === 'ERROR'
        || snapshot.state === 'CANCELED'
        || snapshot.state === 'FILE_STORAGE_CONFLICT'
        || snapshot.state === 'DEPENDENCY_UNAVAILABLE',
      canRelease: snapshot.ephemeralObjectUrl !== null,
    });
    assertFileReadTransition(this.snapshot, prepared, readyBytesValidated);
    this.snapshot = prepared;
    for (const listener of this.listeners) listener();
  }
}

function normalized(error: unknown): FrontendApiError {
  if (isFrontendApiError(error)) return error;
  return new FrontendApiError('MALFORMED_RESPONSE', 0, null, 'CONTRACT');
}

function safeError(error: FrontendApiError): SafeFileReadError {
  return Object.freeze({
    code: error.code,
    httpStatus: error.httpStatus,
    category: error.category,
    requestId: error.requestId,
    retryAfter: error.retryAfter,
    safeDetails: error.safeDetails,
  });
}

function isCanceled(error: unknown): boolean {
  return isFrontendApiError(error) && error.code === 'CANCELED';
}

function isRequestIdentity(value: unknown): value is RequestIdentity {
  return value === 'buyer' || value === 'seller' || value === 'staff';
}
