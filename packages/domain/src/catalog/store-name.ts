export interface NormalizedStoreName {
  display: string;
  normalized: string;
}

export class StoreNameError extends Error {
  constructor() {
    super('invalid_store_name');
    this.name = 'StoreNameError';
  }
}

export function normalizeStoreName(
  raw: string,
): NormalizedStoreName {
  if (typeof raw !== 'string') throw new StoreNameError();

  const normalizedInput = raw.normalize('NFKC').trim();
  if (/[\u0000-\u001f\u007f]/u.test(normalizedInput)) {
    throw new StoreNameError();
  }

  const display = normalizedInput.replace(/\p{Zs}+/gu, ' ');
  if (display.length < 1 || display.length > 200) {
    throw new StoreNameError();
  }

  return {
    display,
    normalized: display.toLocaleLowerCase('en-US'),
  };
}
