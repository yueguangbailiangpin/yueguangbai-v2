import type { MarketplaceReadPageInput } from '@ygb/contracts';
import { MarketplaceProviderError } from './error';

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
  if (!contentType?.toLowerCase().includes('application/json')) {
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
