const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/u;

export function parseIdempotencyKey(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim();
  return trimmed && IDEMPOTENCY_KEY_PATTERN.test(trimmed)
    ? trimmed
    : null;
}
