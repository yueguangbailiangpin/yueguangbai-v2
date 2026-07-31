import type {
  ProductVersionFields,
} from '@ygb/contracts';

export class ProductVersionFieldsError extends Error {
  constructor(
    public readonly reason:
      | 'invalid_product_name'
      | 'invalid_search_keyword'
      | 'too_many_search_keywords'
      | 'invalid_product_url'
      | 'invalid_buyer_visible_notes'
      | 'invalid_internal_notes',
  ) {
    super(reason);
    this.name = 'ProductVersionFieldsError';
  }
}

export function normalizeProductVersionFields(
  input: ProductVersionFields,
): ProductVersionFields {
  const productName = cleanRequired(
    input.productName,
    200,
    'invalid_product_name',
  );

  if (!Array.isArray(input.searchKeywords)
    || input.searchKeywords.length > 20) {
    throw new ProductVersionFieldsError(
      'too_many_search_keywords',
    );
  }

  const searchKeywords = [...new Set(
    input.searchKeywords.map((keyword) =>
      cleanRequired(
        keyword,
        100,
        'invalid_search_keyword',
      )),
  )];

  const productUrl = normalizeProductUrl(input.productUrl);
  const buyerVisibleNotes = cleanOptional(
    input.buyerVisibleNotes,
    2000,
    'invalid_buyer_visible_notes',
  );
  const internalNotes = cleanOptional(
    input.internalNotes,
    4000,
    'invalid_internal_notes',
  );

  return {
    productName,
    searchKeywords,
    productUrl,
    buyerVisibleNotes,
    internalNotes,
  };
}

function normalizeProductUrl(
  value: string | null,
): string | null {
  if (value === null) return null;
  const cleaned = value.normalize('NFKC').trim();
  if (cleaned.length < 1 || cleaned.length > 2048) {
    throw new ProductVersionFieldsError(
      'invalid_product_url',
    );
  }

  try {
    const url = new URL(cleaned);
    if (url.protocol !== 'https:'
      || url.username !== ''
      || url.password !== '') {
      throw new Error('invalid');
    }
    url.hash = '';
    return url.toString();
  } catch {
    throw new ProductVersionFieldsError(
      'invalid_product_url',
    );
  }
}

function cleanRequired(
  value: string,
  maximum: number,
  reason: ProductVersionFieldsError['reason'],
): string {
  if (typeof value !== 'string') {
    throw new ProductVersionFieldsError(reason);
  }
  const normalizedInput = value.normalize('NFKC').trim();
  if (/[\u0000-\u001f\u007f]/u.test(normalizedInput)) {
    throw new ProductVersionFieldsError(reason);
  }
  const cleaned = normalizedInput.replace(/\p{Zs}+/gu, ' ');
  if (cleaned.length < 1
    || cleaned.length > maximum) {
    throw new ProductVersionFieldsError(reason);
  }
  return cleaned;
}

function cleanOptional(
  value: string | null,
  maximum: number,
  reason: ProductVersionFieldsError['reason'],
): string | null {
  if (value === null) return null;
  const cleaned = value.normalize('NFKC').trim();
  if (cleaned.length === 0) return null;
  if (cleaned.length > maximum
    || /[\u0000-\u001f\u007f]/u.test(cleaned)) {
    throw new ProductVersionFieldsError(reason);
  }
  return cleaned;
}
