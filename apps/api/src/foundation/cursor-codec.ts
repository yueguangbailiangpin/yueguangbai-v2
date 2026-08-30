/**
 * Shared cursor wire primitives.
 *
 * This module deliberately does not validate cursor payloads, versions,
 * lengths, filters, ordering keys, or error semantics. Those rules remain in
 * each route family's typed codec.
 */

export function encodeBase64UrlBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return encodeBase64UrlBinary(binary);
}

export function decodeBase64UrlBytes(value: string): Uint8Array {
  return Uint8Array.from(decodeBase64UrlBinary(value), (character) => character.charCodeAt(0));
}

/** Preserves the legacy btoa(JSON.stringify(...)) byte semantics. */
export function encodeBase64UrlBinary(value: string): string {
  return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

export function decodeBase64UrlBinary(value: string): string {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  return atob(value.replaceAll('-', '+').replaceAll('_', '/') + padding);
}

export function encodeBase64UrlJson(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) throw new TypeError('cursor_json_undefined');
  return encodeBase64UrlBytes(new TextEncoder().encode(json));
}

export function decodeBase64UrlJson(value: string): unknown {
  return JSON.parse(new TextDecoder().decode(decodeBase64UrlBytes(value))) as unknown;
}
