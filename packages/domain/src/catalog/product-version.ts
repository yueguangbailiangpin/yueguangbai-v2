import type {
  ProductColorSpecMode,
  ProductDescriptiveFields,
  ProductVersionFields,
} from '@ygb/contracts';
import {
  PRODUCT_COLOR_SPEC_MODES,
} from '@ygb/contracts';

export class ProductVersionFieldsError extends Error {
  constructor(
    public readonly reason:
      | 'invalid_product_name'
      | 'invalid_search_keyword'
      | 'too_many_search_keywords'
      | 'invalid_product_url'
      | 'invalid_buyer_visible_notes'
      | 'invalid_internal_notes'
      | 'invalid_ordering_guide_expected_amount_jpy'
      | 'invalid_color_spec_mode'
      | 'invalid_default_buyer_self_pay_bps',
  ) {
    super(reason);
    this.name = 'ProductVersionFieldsError';
  }
}

export function normalizeProductDescriptiveFields(
  input: ProductDescriptiveFields,
): ProductDescriptiveFields {
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

  // The submitted sequence is authoritative. Validate each value without
  // sorting or deduplicating so repeated terms and original order survive.
  const searchKeywords = input.searchKeywords.map((keyword) =>
    cleanRequired(
      keyword,
      100,
      'invalid_search_keyword',
    ));

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

export function normalizeProductVersionFields(
  input: ProductVersionFields,
): ProductVersionFields {
  const descriptive = normalizeProductDescriptiveFields(input);
  const orderingGuideExpectedAmountJpy =
    input.orderingGuideExpectedAmountJpy;
  if (!Number.isSafeInteger(orderingGuideExpectedAmountJpy)
    || orderingGuideExpectedAmountJpy < 0) {
    throw new ProductVersionFieldsError(
      'invalid_ordering_guide_expected_amount_jpy',
    );
  }
  if (input.defaultBuyerSelfPayBps !== undefined
    && (!Number.isSafeInteger(input.defaultBuyerSelfPayBps)
      || input.defaultBuyerSelfPayBps < 0
      || input.defaultBuyerSelfPayBps > 10_000)) {
    throw new ProductVersionFieldsError(
      'invalid_default_buyer_self_pay_bps',
    );
  }
  if (!isProductColorSpecMode(input.colorSpecMode)) {
    throw new ProductVersionFieldsError(
      'invalid_color_spec_mode',
    );
  }
  return {
    ...descriptive,
    orderingGuideExpectedAmountJpy,
    colorSpecMode: input.colorSpecMode,
    ...(input.defaultBuyerSelfPayBps === undefined
      ? {}
      : { defaultBuyerSelfPayBps: input.defaultBuyerSelfPayBps }),
  };
}

function isProductColorSpecMode(
  value: unknown,
): value is ProductColorSpecMode {
  return typeof value === 'string'
    && (PRODUCT_COLOR_SPEC_MODES as readonly string[])
      .includes(value);
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
