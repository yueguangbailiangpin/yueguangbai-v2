import type { QueryClient } from '@tanstack/react-query';
import { approvedApiPath } from '../config/runtime-config';
import { FrontendApiError } from '../api/errors';
import { withIdentity401Invalidation, type RequestIdentity } from '../api/identity-request';
import {
  normalizeResponseError,
  parseApiFailureEnvelope,
  parseApiSuccessEnvelope,
} from '../api/transport';
import {
  uploadContentResponseSchema,
  type UploadContentResponse,
} from './file-contracts';

export type UploadProgress = Readonly<{
  mode: 'DETERMINATE' | 'INDETERMINATE';
  loadedBytes: number | null;
  totalBytes: number | null;
  percent: number | null;
}>;

export type UploadTransportResult = Readonly<{
  data: UploadContentResponse;
  requestId: string;
}>;

export function measuredUploadProgress(event: Readonly<{
  lengthComputable: boolean;
  loaded: number;
  total: number;
}>): UploadProgress {
  if (!event.lengthComputable || event.total <= 0) {
    return Object.freeze({
      mode: 'INDETERMINATE', loadedBytes: null, totalBytes: null, percent: null,
    });
  }
  const loadedBytes = Math.min(Math.max(event.loaded, 0), event.total);
  return Object.freeze({
    mode: 'DETERMINATE',
    loadedBytes,
    totalBytes: event.total,
    percent: Math.min(100, Math.max(0, (loadedBytes / event.total) * 100)),
  });
}

export function uploadSingleFileMultipart(input: {
  client: QueryClient;
  identity: RequestIdentity;
  lifecyclePrefix: '/api/buyer-portal' | '/api/seller-portal' | '/api/staff';
  intentId: string;
  fileObjectId: string;
  file: File;
  uploadToken: string;
  idempotencyKey: string;
  signal: AbortSignal;
  onProgress: (progress: UploadProgress) => void;
}): Promise<UploadTransportResult> {
  return withIdentity401Invalidation(input.identity, input.client, () => {
    const path = `${input.lifecyclePrefix}/file-uploads/${input.fileObjectId}/content`;
    if (!approvedApiPath(path)) {
      return Promise.reject(new FrontendApiError('INVALID_PATH', 0, null, 'CONTRACT'));
    }
    return xhrUpload(path, input);
  });
}

function xhrUpload(
  path: string,
  input: Parameters<typeof uploadSingleFileMultipart>[0],
): Promise<UploadTransportResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    const finishReject = (error: unknown) => {
      if (settled) return;
      settled = true;
      input.signal.removeEventListener('abort', abort);
      reject(normalizeResponseError(error, input.signal));
    };
    const abort = () => xhr.abort();
    xhr.open('PUT', path);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('X-Upload-Token', input.uploadToken);
    xhr.setRequestHeader('Idempotency-Key', input.idempotencyKey);
    xhr.upload.onprogress = (event) => {
      input.onProgress(measuredUploadProgress(event));
    };
    xhr.onerror = () => finishReject(new TypeError('upload_network_failure'));
    xhr.onabort = () => finishReject(new DOMException('Upload canceled', 'AbortError'));
    xhr.onload = () => {
      if (settled) return;
      let payload: unknown = null;
      try {
        payload = JSON.parse(xhr.responseText) as unknown;
      } catch {
        payload = null;
      }
      try {
        const result = xhr.status >= 200 && xhr.status < 300
          ? parseApiSuccessEnvelope(payload, xhr.status, uploadContentResponseSchema)
          : parseApiFailureEnvelope(payload, xhr.status, xhr.getResponseHeader('Retry-After'));
        if (result.data.file_object_id !== input.fileObjectId
          || result.data.upload_intent_id !== input.intentId
          || result.data.byte_size !== input.file.size
          || result.data.detected_mime !== input.file.type) {
          throw new FrontendApiError(
            'MALFORMED_RESPONSE', xhr.status, result.requestId, 'CONTRACT',
          );
        }
        settled = true;
        input.signal.removeEventListener('abort', abort);
        resolve(result);
      } catch (error: unknown) {
        finishReject(error);
      }
    };
    if (input.signal.aborted) {
      finishReject(new DOMException('Upload canceled', 'AbortError'));
      return;
    }
    input.signal.addEventListener('abort', abort, { once: true });
    const formData = new FormData();
    formData.append('file', input.file);
    xhr.send(formData);
  });
}
