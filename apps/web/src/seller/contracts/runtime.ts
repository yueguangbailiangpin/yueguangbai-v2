import { z } from 'zod';

const integerString = z.string().regex(/^(0|[1-9][0-9]*)$/u);
const epoch = z.number().int().nonnegative();
const page = z.object({ limit: z.number().int().positive(), next_cursor: z.string().nullable() }).strict();
const component = z.enum(['PENDING', 'COMPLETE', 'NOT_APPLICABLE']);

export const sellerMeSchema = z.object({ me: z.object({
  account_id: z.string(),
  member: z.object({ id: z.string(), display_name: z.string(), role: z.string(), primary_owner: z.boolean() }).strict(),
  organization: z.object({ id: z.string(), seller_code: z.string(), name: z.string(), marketplace_code: z.literal('JP'), status: z.literal('ACTIVE') }).strict(),
  access: z.object({ read_scope: z.enum(['ORGANIZATION', 'ASSIGNED_STORES']), store_ids: z.array(z.string()), can_submit_product_applications: z.boolean(), can_submit_demand_batches: z.boolean() }).strict(),
}).strict() }).strict();

export const sellerStoresSchema = z.object({ items: z.array(z.object({
  id: z.string(), marketplace_code: z.literal('JP'), display_name: z.string(),
  canonical_marketplace_code: z.enum(['AMAZON_JP', 'AMAZON_US', 'COUPANG_KR']),
  transaction_currency_code: z.enum(['JPY', 'USD', 'KRW', 'CNY']),
  transaction_currency_exponent: z.union([z.literal(0), z.literal(2)]),
  marketplace_status: z.enum(['ACTIVE', 'DISABLED']), adapter_status: z.enum(['AVAILABLE', 'UNAVAILABLE']),
  status: z.string(), version: z.number().int(), created_at: epoch, updated_at: epoch,
}).strict()), page }).strict();

export const sellerFormalOrdersSchema = z.object({ items: z.array(z.object({
  formal_order_id: z.string(), status: z.literal('CONFIRMED'), marketplace_code: z.literal('JP'),
  canonical_marketplace_code: z.enum(['AMAZON_JP', 'AMAZON_US', 'COUPANG_KR']),
  amazon_order_number: z.string(), platform_order_identifier: z.string(),
  store: z.object({ id: z.string(), display_name: z.string() }).strict(),
  asin: z.string(), platform_product_identifier: z.string(), product_name: z.string(),
  product_version: z.object({ id: z.string(), version_no: z.number().int().positive() }).strict(),
  review_type: z.enum(['RATING', 'TEXT', 'IMAGE', 'VIDEO']), final_paid_jpy: integerString,
  payment: z.object({ amount_minor: integerString, currency_code: z.enum(['JPY', 'USD', 'KRW', 'CNY']), currency_exponent: z.union([z.literal(0), z.literal(2)]) }).strict(),
  seller_expected_principal_cny_fen: integerString,
  seller_agreement_rate_snapshot: z.object({
    rate_version_id: z.string(), version_no: z.number().int().positive(), cny_per_jpy_e8: integerString,
    effective_from: epoch, confirmed_at: epoch, source_currency_code: z.enum(['JPY', 'USD', 'KRW', 'CNY']),
    quote_currency_code: z.literal('CNY'), source_currency_exponent: z.union([z.literal(0), z.literal(2)]),
    quote_currency_exponent: z.literal(2), rate_value: integerString, rate_scale: integerString,
    rounding_rule: z.literal('HALF_UP'),
  }).strict(),
  locked_service_fee_snapshot: z.object({
    fee_version_id: z.string(), version_no: z.number().int().positive(), review_type: z.string(),
    service_fee_cny_fen: integerString, effective_from: epoch, confirmed_at: epoch,
    marketplace_code: z.enum(['AMAZON_JP', 'AMAZON_US', 'COUPANG_KR']), currency_code: z.literal('CNY'), currency_exponent: z.literal(2),
  }).strict(),
  business_completion: z.object({ status: z.enum(['IN_PROGRESS', 'COMPLETE']), review: component,
    buyer_refund: component, seller_principal: component, seller_service_fee: component }).strict(),
  confirmed_at: epoch, confirmed_business_date: z.string(),
}).strict()), page }).strict();

export const sellerSettlementSummarySchema = z.object({ settlement: z.object({
  outstanding_principal_cny_fen: integerString, outstanding_service_fee_cny_fen: integerString,
  total_outstanding_cny_fen: integerString, unallocated_credit_cny_fen: integerString,
}).strict() }).strict();

const looseItemPage = z.object({ items: z.array(z.object({ id: z.string().optional() }).passthrough()), page }).strict();
export const sellerProductsSchema = looseItemPage;
export const sellerDemandsSchema = looseItemPage;
export const sellerReviewsSchema = z.object({ items: z.array(z.object({
  review_case_id: z.string(), product_name: z.string(), status: z.string(), review_type: z.string(),
  store: z.object({ id: z.string(), display_name: z.string() }).passthrough(),
}).passthrough()), page }).strict();
export const sellerPayablesSchema = z.object({ items: z.array(z.object({
  payable_id: z.string(), formal_order_id: z.string(), payable_type: z.enum(['SELLER_PRINCIPAL', 'SELLER_SERVICE_FEE']),
  due_amount_cny_fen: integerString, paid_amount_cny_fen: integerString,
  outstanding_amount_cny_fen: integerString, status: z.string(),
}).passthrough()), page }).strict();
