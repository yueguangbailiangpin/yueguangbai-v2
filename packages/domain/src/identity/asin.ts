export class AsinNormalizationError extends Error {
  constructor() {
    super('invalid_asin');
    this.name = 'AsinNormalizationError';
  }
}

export function normalizeAsin(raw: string): string {
  if (typeof raw !== 'string') throw new AsinNormalizationError();
  const normalized = raw.normalize('NFKC').trim().toUpperCase();

  if (!/^[A-Z0-9]{10}$/u.test(normalized)) {
    throw new AsinNormalizationError();
  }
  return normalized;
}
