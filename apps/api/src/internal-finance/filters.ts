import {
  FINANCE_DATE_BASES,
  type FinanceDateBasis,
  type FinanceStatus,
  type FinancialExportType,
  type InternalFinanceFilters,
  type OrderFinanceDateBasis,
  isFinanceDateBasis,
  isFinanceStatus,
  isOrderFinanceDateBasis,
  isPricingReviewType,
} from '@ygb/contracts';
import {
  chinaBusinessDate,
  chinaBusinessDateStartEpoch,
  normalizeAmazonOrderNumber,
  normalizeAsin,
  parseChinaBusinessDate,
} from '@ygb/domain';
import { InternalFinanceError, validation } from './shared';

export const FINANCE_QUERY_KEYS = Object.freeze([
  'from_date',
  'to_date',
  'date_basis',
  'seller_organization_id',
  'store_id',
  'product_id',
  'asin',
  'formal_order_id',
  'amazon_order_number',
  'review_type',
  'finance_status',
  'limit',
  'cursor',
  'group_by',
] as const);

const MAX_RANGE_DAYS = 3660;
const DAY_MS = 86_400_000;

export function assertExactQueryParameters(
  url: URL,
  allowed: readonly string[],
): void {
  const allow = new Set(allowed);
  for (const key of new Set(url.searchParams.keys())) {
    if (!allow.has(key) || url.searchParams.getAll(key).length !== 1) {
      validation();
    }
  }
}

export function normalizeFinanceQuery(
  url: URL,
  now = Date.now(),
): InternalFinanceFilters {
  return normalizeFinanceFilters(Object.fromEntries(url.searchParams), now);
}

export function normalizeFinanceFilters(
  input: Record<string, unknown>,
  now = Date.now(),
  forcedBasis?: FinanceDateBasis,
): InternalFinanceFilters {
  const allowed = new Set<string>(FINANCE_QUERY_KEYS.filter(
    (key) => key !== 'limit' && key !== 'cursor' && key !== 'group_by',
  ));
  if (Object.keys(input).some((key) => !allowed.has(key))) validation();

  const today = chinaBusinessDate(now);
  const defaultFrom = chinaBusinessDate(
    chinaBusinessDateStartEpoch(today) - 29 * DAY_MS,
  );
  const fromDate = date(input['from_date'] ?? defaultFrom);
  const toDate = date(input['to_date'] ?? today);
  const fromEpoch = chinaBusinessDateStartEpoch(fromDate);
  const toEpoch = chinaBusinessDateStartEpoch(toDate);
  if (fromEpoch > toEpoch || (toEpoch - fromEpoch) / DAY_MS > MAX_RANGE_DAYS) {
    validation();
  }

  const hasInputBasis = Object.hasOwn(input, 'date_basis');
  let basisValue: unknown;
  if (forcedBasis === undefined) {
    if (!hasInputBasis) validation();
    basisValue = input['date_basis'];
  } else {
    if (hasInputBasis) validation();
    basisValue = forcedBasis;
  }
  if (!isFinanceDateBasis(basisValue)) validation();

  const reviewType = nullable(input['review_type']);
  if (reviewType !== null && !isPricingReviewType(reviewType)) validation();
  const status = nullable(input['finance_status']);
  if (status !== null && !isFinanceStatus(status)) validation();

  return Object.freeze({
    from_date: fromDate,
    to_date: toDate,
    date_basis: basisValue,
    seller_organization_id: identifier(input['seller_organization_id']),
    store_id: identifier(input['store_id']),
    product_id: identifier(input['product_id']),
    asin: normalizeNullable(input['asin'], normalizeAsin),
    formal_order_id: identifier(input['formal_order_id']),
    amazon_order_number: normalizeNullable(
      input['amazon_order_number'],
      normalizeAmazonOrderNumber,
    ),
    review_type: reviewType,
    finance_status: status as FinanceStatus | null,
  });
}

export function assertOrderFinanceDateBasis(
  filters: InternalFinanceFilters,
): asserts filters is InternalFinanceFilters & {
  date_basis: OrderFinanceDateBasis;
} {
  if (!isOrderFinanceDateBasis(filters.date_basis)) validation();
}

export function assertCashFinanceDateBasis(
  filters: InternalFinanceFilters,
): asserts filters is InternalFinanceFilters & { date_basis: 'CASH' } {
  if (filters.date_basis !== 'CASH') validation();
}

export function assertFinancialExportDateBasis(
  exportType: FinancialExportType,
  basis: FinanceDateBasis,
): void {
  if (exportType === 'CASH_FLOW') {
    if (basis !== 'CASH') validation();
    return;
  }
  if (!isOrderFinanceDateBasis(basis)) validation();
}

export function financeDateColumn(basis: OrderFinanceDateBasis): string {
  if (!(FINANCE_DATE_BASES as readonly string[]).includes(basis)) {
    throw new InternalFinanceError('VALIDATION_ERROR', 400);
  }
  return basis === 'CONFIRMED'
    ? 'position.confirmed_business_date'
    : 'position.review_approved_business_date';
}

function date(value: unknown): string {
  if (typeof value !== 'string') return validation();
  try {
    return parseChinaBusinessDate(value);
  } catch {
    return validation();
  }
}

function nullable(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return validation();
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length < 1 || normalized.length > 200) return validation();
  return normalized;
}

function identifier(value: unknown): string | null {
  const normalized = nullable(value);
  if (normalized === null) return null;
  if (/[\u0000-\u001f\u007f]/u.test(normalized)) return validation();
  return normalized;
}

function normalizeNullable(
  value: unknown,
  normalizer: (raw: string) => string,
): string | null {
  const normalized = nullable(value);
  if (normalized === null) return null;
  try {
    return normalizer(normalized);
  } catch {
    return validation();
  }
}
