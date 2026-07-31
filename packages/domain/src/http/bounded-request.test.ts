import { describe, expect, it } from 'vitest';
import {
  readBoundedJson,
  requestBodyIsEmpty,
} from './bounded-request';

describe('bounded requests', () => {
  it('reads an object JSON body within the limit', async () => {
    const request = new Request('https://local.test/input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'ok' }),
    });

    await expect(readBoundedJson(request, 1024)).resolves.toEqual({
      value: 'ok',
    });
  });

  it('rejects arrays, malformed JSON, wrong content type, and oversized bodies', async () => {
    const arrayRequest = new Request('https://local.test/input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '[]',
    });
    await expect(readBoundedJson(arrayRequest, 1024)).resolves.toBeNull();

    const malformedRequest = new Request('https://local.test/input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });
    await expect(readBoundedJson(malformedRequest, 1024))
      .resolves.toBeNull();

    const wrongType = new Request('https://local.test/input', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '{}',
    });
    await expect(readBoundedJson(wrongType, 1024)).resolves.toBeNull();

    const oversized = new Request('https://local.test/input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'x'.repeat(100) }),
    });
    await expect(readBoundedJson(oversized, 16)).resolves.toBeNull();
  });

  it('detects an empty request body', async () => {
    const request = new Request('https://local.test/input', {
      method: 'POST',
    });
    await expect(requestBodyIsEmpty(request)).resolves.toBe(true);
  });
});
