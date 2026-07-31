import { describe, expect, it } from 'vitest';
import {
  apiFailure,
  apiSuccess,
  isApiErrorCode,
} from './index';

describe('API contracts', () => {
  it('creates stable success and failure envelopes', () => {
    expect(apiSuccess({ ok: true }, 'request-1')).toEqual({
      data: { ok: true },
      meta: { request_id: 'request-1' },
    });

    expect(apiFailure('VERSION_CONFLICT', 'conflict', 'request-2')).toEqual({
      error: {
        code: 'VERSION_CONFLICT',
        message: 'conflict',
        details: null,
      },
      meta: { request_id: 'request-2' },
    });
  });

  it('recognizes only published error codes', () => {
    expect(isApiErrorCode('NOT_FOUND')).toBe(true);
    expect(isApiErrorCode('UNKNOWN_INTERNAL_ERROR')).toBe(false);
    expect(isApiErrorCode(null)).toBe(false);
  });
});
