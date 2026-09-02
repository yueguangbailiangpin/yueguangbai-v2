export class PlatformIdentifierError extends Error {
  constructor(
    public readonly reason:
      | 'invalid_amazon_asin'
      | 'invalid_rakuten_product_number'
      | 'invalid_temu_product_id'
      | 'invalid_yahoo_jan'
      | 'unsupported_marketplace',
  ) {
    super(reason);
    this.name = 'PlatformIdentifierError';
  }
}

/**
 * D-059 per-marketplace identifier normalization. Amazon keeps the strict
 * 10-char ASIN format; Rakuten accepts alphanumeric+hyphen (R-1, S-1, R-1 PRO);
 * TEMU accepts two-letter+six-digit (FX281259); Yahoo JAN is 13 digits with
 * EAN-13 checksum validation.
 */
export function normalizePlatformIdentifier(
  marketplaceCode: string,
  raw: string,
): string {
  if (typeof raw !== 'string') throw new PlatformIdentifierError('unsupported_marketplace');
  const normalized = raw.normalize('NFKC').trim().toUpperCase();

  switch (marketplaceCode) {
    case 'AMAZON_JP':
    case 'AMAZON_US':
      if (!/^[A-Z0-9]{10}$/u.test(normalized)) {
        throw new PlatformIdentifierError('invalid_amazon_asin');
      }
      return normalized;

    case 'RAKUTEN_JP':
      if (!/^[A-Z0-9][A-Z0-9-]{0,49}$/u.test(normalized)) {
        throw new PlatformIdentifierError('invalid_rakuten_product_number');
      }
      return normalized;

    case 'TEMU_JP':
      if (!/^[A-Z]{2}\d{6}$/u.test(normalized)) {
        throw new PlatformIdentifierError('invalid_temu_product_id');
      }
      return normalized;

    case 'YAHOO_JP':
      if (!/^\d{13}$/u.test(normalized)) {
        throw new PlatformIdentifierError('invalid_yahoo_jan');
      }
      // EAN-13 checksum
      let sum = 0;
      for (let i = 0; i < 12; i++) sum += Number(normalized[i]) * (i % 2 === 0 ? 1 : 3);
      if ((10 - (sum % 10)) % 10 !== Number(normalized[12])) {
        throw new PlatformIdentifierError('invalid_yahoo_jan');
      }
      return normalized;

    default:
      throw new PlatformIdentifierError('unsupported_marketplace');
  }
}
