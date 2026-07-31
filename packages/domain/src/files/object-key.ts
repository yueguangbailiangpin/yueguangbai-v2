import type { FilePurpose } from '@ygb/contracts';

export function generateFileObjectKey(
  purpose: FilePurpose,
  now = Date.now(),
): string {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error('invalid_object_key_time');
  }
  const date = new Date(now);
  const year = date.getUTCFullYear().toString().padStart(4, '0');
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const purposeSegment = purpose
    .toLocaleLowerCase('en-US')
    .replaceAll('_', '-');
  const uuid = crypto.randomUUID().replaceAll('-', '');
  const entropy = new Uint8Array(16);
  crypto.getRandomValues(entropy);
  const randomHex = Array.from(
    entropy,
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');

  return `files/v1/${year}/${month}/${purposeSegment}/${uuid}${randomHex}`;
}

export function isSystemGeneratedFileObjectKey(value: string): boolean {
  return /^files\/v1\/[0-9]{4}\/[0-9]{2}\/[a-z0-9-]+\/[0-9a-f]{64}$/u
    .test(value);
}
