export class AmazonOrderNumberError extends Error {
  constructor(
    public readonly reason:
      | 'invalid_order_number',
  ) {
    super(reason);
    this.name = 'AmazonOrderNumberError';
  }
}

export function normalizeAmazonOrderNumber(raw: string): string {
  if (typeof raw !== 'string') {
    throw new AmazonOrderNumberError('invalid_order_number');
  }

  const normalized = raw
    .normalize('NFKC')
    .replace(/\s+/gu, '')
    .toUpperCase();

  if (!/^[A-Z0-9-]{3,120}$/u.test(normalized)) {
    throw new AmazonOrderNumberError('invalid_order_number');
  }
  return normalized;
}
