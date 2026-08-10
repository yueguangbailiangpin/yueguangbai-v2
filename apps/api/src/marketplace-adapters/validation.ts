import type { MarketplaceReadPageInput } from '@ygb/contracts';
import { MarketplaceProviderError } from './error';

const JSON_MEDIA_TYPE = 'application/json';
const MAX_MEDIA_TYPE_LENGTH = 4_096;

export function validateReadPageInput(
  input: MarketplaceReadPageInput,
): Readonly<MarketplaceReadPageInput> {
  if (!input || !Number.isSafeInteger(input.page_size)
    || input.page_size < 1 || input.page_size > 100) {
    throw new MarketplaceProviderError('CONTRACT');
  }
  if (input.cursor !== null && !opaqueProviderCursor(input.cursor)) {
    throw new MarketplaceProviderError('CONTRACT');
  }
  return Object.freeze({ cursor: input.cursor, page_size: input.page_size });
}

export function parseNextProviderCursor(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (!opaqueProviderCursor(value)) {
    throw new MarketplaceProviderError('CONTRACT');
  }
  return value;
}

export function providerRecord(
  value: unknown,
): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function boundedProviderString(
  value: unknown,
  maximum: number,
): value is string {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= maximum
    && !/\p{Cc}/u.test(value);
}

export function normalizedDisplayText(value: unknown, maximum: number): string {
  if (!boundedProviderString(value, maximum)) {
    throw new MarketplaceProviderError('CONTRACT');
  }
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length === 0 || normalized.length > maximum) {
    throw new MarketplaceProviderError('CONTRACT');
  }
  return normalized;
}

export function boundedInteger(
  value: number | undefined,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || value === undefined
    || value < minimum || value > maximum) {
    throw new MarketplaceProviderError('CONFIGURATION');
  }
  return value;
}

export async function readBoundedProviderJson(
  response: Response,
  maximumBytes: number,
): Promise<unknown> {
  const contentType = response.headers.get('content-type');
  if (!exactJsonMediaType(contentType)) {
    await discardProviderResponseBody(response);
    throw new MarketplaceProviderError('CONTRACT');
  }
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/u.test(length)
    || Number(length) > maximumBytes)) {
    await discardProviderResponseBody(response);
    throw new MarketplaceProviderError('CONTRACT');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new MarketplaceProviderError('CONTRACT');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maximumBytes) {
        throw new MarketplaceProviderError('CONTRACT');
      }
      chunks.push(next.value);
    }
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // Preserve the original bounded-read failure.
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new MarketplaceProviderError('CONTRACT');
  }
}

export async function discardProviderResponseBody(
  response: Response,
): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The already-classified status remains the authority.
  }
}

function opaqueProviderCursor(value: unknown): value is string {
  return boundedProviderString(value, 2_048);
}

function exactJsonMediaType(value: string | null): boolean {
  if (value === null || value.length === 0
    || value.length > MAX_MEDIA_TYPE_LENGTH) return false;
  let index = skipOptionalWhitespace(value, 0);
  if (value.slice(index, index + JSON_MEDIA_TYPE.length).toLowerCase()
    !== JSON_MEDIA_TYPE) return false;
  index += JSON_MEDIA_TYPE.length;
  index = skipOptionalWhitespace(value, index);

  while (index < value.length) {
    if (value[index] !== ';') return false;
    index = skipOptionalWhitespace(value, index + 1);
    if (index === value.length || value[index] === ';') continue;

    const nameStart = index;
    index = consumeToken(value, index);
    if (index === nameStart || value[index] !== '=') return false;
    index += 1;

    if (value[index] === '"') {
      index = consumeQuotedString(value, index);
      if (index < 0) return false;
    } else {
      const valueStart = index;
      index = consumeToken(value, index);
      if (index === valueStart) return false;
    }
    index = skipOptionalWhitespace(value, index);
  }
  return true;
}

function skipOptionalWhitespace(value: string, start: number): number {
  let index = start;
  while (value[index] === ' ' || value[index] === '\t') index += 1;
  return index;
}

function consumeToken(value: string, start: number): number {
  let index = start;
  while (index < value.length && isTokenCharacter(value.charCodeAt(index))) {
    index += 1;
  }
  return index;
}

function consumeQuotedString(value: string, start: number): number {
  let index = start + 1;
  while (index < value.length) {
    const code = value.charCodeAt(index);
    if (code === 0x22) return index + 1;
    if (code === 0x5c) {
      index += 1;
      if (index >= value.length
        || !isQuotedPairCharacter(value.charCodeAt(index))) return -1;
    } else if (!isQuotedTextCharacter(code)) {
      return -1;
    }
    index += 1;
  }
  return -1;
}

function isTokenCharacter(code: number): boolean {
  return (code >= 0x30 && code <= 0x39)
    || (code >= 0x41 && code <= 0x5a)
    || (code >= 0x61 && code <= 0x7a)
    || "!#$%&'*+-.^_`|~".includes(String.fromCharCode(code));
}

function isQuotedTextCharacter(code: number): boolean {
  return code === 0x09 || code === 0x20 || code === 0x21
    || (code >= 0x23 && code <= 0x5b)
    || (code >= 0x5d && code <= 0x7e)
    || (code >= 0x80 && code <= 0xff);
}

function isQuotedPairCharacter(code: number): boolean {
  return code === 0x09 || code === 0x20
    || (code >= 0x21 && code <= 0x7e)
    || (code >= 0x80 && code <= 0xff);
}
