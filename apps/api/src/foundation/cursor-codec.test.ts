import { describe, expect, it } from 'vitest';
import {
  decodeBase64UrlBinary,
  decodeBase64UrlBytes,
  decodeBase64UrlJson,
  encodeBase64UrlBinary,
  encodeBase64UrlBytes,
  encodeBase64UrlJson,
} from './cursor-codec';

describe('shared cursor wire primitives', () => {
  it('round-trips UTF-8 JSON with Unicode and safe integer boundaries', () => {
    const value = {
      text: '月光白・😀',
      min: 0,
      max: Number.MAX_SAFE_INTEGER,
      id: '订单-1',
    };

    const encoded = encodeBase64UrlJson(value);

    expect(encoded).not.toMatch(/[=+/]/u);
    expect(decodeBase64UrlJson(encoded)).toEqual(value);
  });

  it('round-trips arbitrary byte boundaries', () => {
    const bytes = Uint8Array.from([0, 1, 127, 128, 239, 191, 189, 255]);

    expect(decodeBase64UrlBytes(encodeBase64UrlBytes(bytes))).toEqual(bytes);
  });

  it('preserves the existing undefined JSON encoder edge behavior', () => {
    expect(encodeBase64UrlJson(undefined)).toBe('');
  });

  it('preserves the legacy binary-string fixture', () => {
    const json = '{"k":"legacy","id":"row-1"}';
    const fixture = 'eyJrIjoibGVnYWN5IiwiaWQiOiJyb3ctMSJ9';

    expect(encodeBase64UrlBinary(json)).toBe(fixture);
    expect(decodeBase64UrlBinary(fixture)).toBe(json);
  });

  it.each(['%%% ', 'a'])('rejects malformed base64url input: %j', (value) => {
    expect(() => decodeBase64UrlBytes(value)).toThrow();
  });

  it('rejects malformed JSON after valid base64url decoding', () => {
    expect(() => decodeBase64UrlJson('')).toThrow();
    expect(() => decodeBase64UrlJson(encodeBase64UrlBinary('not-json'))).toThrow();
  });
});
