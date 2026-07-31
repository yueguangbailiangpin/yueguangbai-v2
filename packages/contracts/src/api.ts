import type { ApiErrorCode } from './errors';

export interface ApiMeta {
  request_id: string;
}

export interface ApiSuccess<T> {
  data: T;
  meta: ApiMeta;
}

export interface ApiFailure {
  error: {
    code: ApiErrorCode;
    message: string;
    details: unknown | null;
  };
  meta: ApiMeta;
}

export function apiSuccess<T>(
  data: T,
  requestId: string,
): ApiSuccess<T> {
  return {
    data,
    meta: { request_id: requestId },
  };
}

export function apiFailure(
  code: ApiErrorCode,
  message: string,
  requestId: string,
  details: unknown | null = null,
): ApiFailure {
  return {
    error: {
      code,
      message,
      details,
    },
    meta: { request_id: requestId },
  };
}
