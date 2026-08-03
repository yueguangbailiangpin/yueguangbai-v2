import { describe, expect, it } from 'vitest';
import { successEnvelope, retryAfterMilliseconds } from './api/envelopes';
import { startOperation } from './api/idempotency';
import { queryKeys } from './api/query-client';
import { shouldRetryQuery } from './api/retry';
import { FrontendApiError } from './api/errors';
import { fileTransferReducer } from './files/file-transfer-machine';
import { approvedApiPath } from './config/runtime-config';
import { z } from 'zod';

describe('Wave 14A foundation policy', () => {
  it('accepts only origin-relative formal API paths', () => { expect(approvedApiPath('/api/customer-auth/session')).toBe(true); expect(approvedApiPath('/api/v2/session')).toBe(false); expect(approvedApiPath('https://example.test/api/x')).toBe(false); });
  it('validates a success envelope and rejects missing request metadata', () => { const schema = successEnvelope(z.object({ name: z.string() })); expect(schema.safeParse({ data: { name: 'ok' }, meta: { request_id: 'r-1' } }).success).toBe(true); expect(schema.safeParse({ data: { name: 'ok' }, meta: {} }).success).toBe(false); });
  it('bounds Retry-After and semantic retry policy', () => { expect(retryAfterMilliseconds('3')).toBe(3000); expect(retryAfterMilliseconds('61')).toBeNull(); expect(shouldRetryQuery(0, new FrontendApiError('FORBIDDEN', 403, 'r', 'PERMISSION'))).toBe(false); expect(shouldRetryQuery(0, new FrontendApiError('DEPENDENCY_UNAVAILABLE', 503, 'r', 'DEPENDENCY'))).toBe(false); });
  it('keeps query keys identity-rooted', () => { expect(queryKeys.buyer.session[0]).toBe('buyer'); expect(queryKeys.seller.session[0]).toBe('seller'); expect(queryKeys.staff.session[0]).toBe('staff'); });
  it('creates new idempotency keys for new logical operations', () => { expect(startOperation({ value: 1 }).key).not.toBe(startOperation({ value: 1 }).key); });
  it('models cancel and verified file states', () => { expect(fileTransferReducer('IDLE', 'CREATE')).toBe('CREATING_INTENT'); expect(fileTransferReducer('UPLOADING', 'CANCEL')).toBe('CANCELED'); expect(fileTransferReducer('COMPLETING', 'VERIFIED')).toBe('VERIFIED'); });
});
