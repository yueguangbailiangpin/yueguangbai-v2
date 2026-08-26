import { z } from 'zod';
import type { OrderCommunicationScreenshotReadIntentDto } from '@ygb/contracts';

const integerString = z.string().regex(/^(0|[1-9][0-9]*)$/u);
const epoch = z.number().int().nonnegative();
const page = z
  .object({ limit: z.number().int().positive(), next_cursor: z.string().nullable() })
  .strict();
const component = z.enum(['PENDING', 'COMPLETE', 'NOT_APPLICABLE']);

export const sellerOrderChatScreenshotReadIntentResponseSchema = z
  .object({
    read_intent_id: z.string().min(1).max(120),
    access_token: z.string().min(32).max(512).nullable(),
    access_token_available: z.boolean(),
    expires_at: epoch,
    replayed: z.boolean(),
  })
  .strict() satisfies z.ZodType<OrderCommunicationScreenshotReadIntentDto>;

export const sellerMeSchema = z
  .object({
    me: z
      .object({
        account_id: z.string(),
        member: z
          .object({
            id: z.string(),
            display_name: z.string(),
            role: z.enum(['OWNER', 'OPERATIONS', 'FINANCE', 'VIEWER']),
            primary_owner: z.boolean(),
          })
          .strict(),
        organization: z
          .object({
            id: z.string(),
            seller_code: z.string(),
            name: z.string(),
            marketplace_code: z.literal('AMAZON_JP'),
            status: z.literal('ACTIVE'),
            settlement_account_name: z.string().nullable(),
            settlement_account_identifier: z.string().nullable(),
          })
          .strict(),
        access: z
          .object({
            read_scope: z.enum(['ORGANIZATION', 'ASSIGNED_STORES']),
            store_ids: z.array(z.string()),
            can_submit_product_applications: z.boolean(),
            can_submit_demand_batches: z.boolean(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export const sellerStoresSchema = z
  .object({
    items: z.array(
      z
        .object({
          id: z.string(),
          marketplace_code: z.literal('AMAZON_JP'),
          display_name: z.string(),
          canonical_marketplace_code: z.enum([
            'AMAZON_JP',
            'AMAZON_US',
            'COUPANG_KR',
            'RAKUTEN_JP',
            'TIKTOK_JP',
          ]),
          transaction_currency_code: z.enum(['JPY', 'USD', 'KRW', 'CNY']),
          transaction_currency_exponent: z.union([z.literal(0), z.literal(2)]),
          marketplace_status: z.enum(['ACTIVE', 'DISABLED']),
          adapter_status: z.enum(['AVAILABLE', 'UNAVAILABLE']),
          status: z.enum(['ACTIVE', 'DISABLED']),
          version: z.number().int(),
          created_at: epoch,
          updated_at: epoch,
        })
        .strict(),
    ),
    page,
  })
  .strict();

export const sellerStoreMutationSchema = z
  .object({
    store: z
      .object({
        store_id: z.string(),
        seller_organization_id: z.string(),
        marketplace_code: z.enum([
          'AMAZON_JP',
          'AMAZON_US',
          'COUPANG_KR',
          'RAKUTEN_JP',
          'TIKTOK_JP',
        ]),
        display_name: z.string(),
        status: z.literal('ACTIVE'),
        version: z.literal(1),
        replayed: z.boolean(),
      })
      .strict(),
  })
  .strict();

const canonicalMarketplace = z.enum([
  'AMAZON_JP',
  'AMAZON_US',
  'COUPANG_KR',
  'RAKUTEN_JP',
  'TIKTOK_JP',
]);
const sellerFormalOrderCommon = {
  formal_order_id: z.string(),
  status: z.literal('CONFIRMED'),
  platform_order_identifier: z.string(),
  store: z.object({ id: z.string(), display_name: z.string() }).strict(),
  platform_product_identifier: z.string(),
  product_name: z.string(),
  main_image: z
    .object({
      file_object_id: z.string(),
      file_version: z.number().int().positive(),
      client_file_name: z.string(),
    })
    .strict()
    .nullable(),
  order_screenshot: z
    .object({
      file_object_id: z.string(),
      file_version: z.number().int().positive(),
    })
    .strict()
    .nullable(),
  communication_screenshots: z
    .array(
      z
        .object({
          file_object_id: z.string().min(1).max(120),
          file_version: z.number().int().positive(),
          purpose: z.literal('ORDER_COMMUNICATION_SCREENSHOT'),
          visibility: z.literal('SELLER_VISIBLE'),
        })
        .strict(),
    )
    .readonly(),
  confirmed_at: epoch,
} as const;
const sellerAmazonFormalOrderSchema = z
  .object({
    ...sellerFormalOrderCommon,
    legacy_projection: z.literal('AMAZON'),
    marketplace_code: z.literal('AMAZON_JP'),
    canonical_marketplace_code: z.enum(['AMAZON_JP', 'AMAZON_US']),
    amazon_order_number: z.string(),
    asin: z.string(),
    product_version: z.object({ id: z.string(), version_no: z.number().int().positive() }).strict(),
    review_type: z.enum(['RATING', 'TEXT', 'IMAGE', 'VIDEO']),
    final_paid_jpy: integerString,
    payment: z
      .object({
        amount_minor: integerString,
        currency_code: z.enum(['JPY', 'USD', 'KRW', 'CNY']),
        currency_exponent: z.union([z.literal(0), z.literal(2)]),
      })
      .strict(),
    seller_expected_principal_cny_fen: integerString,
    seller_principal_rate_snapshot: z
      .object({
        platform_order_date: z.string(),
        payment_amount_minor: integerString,
        payment_currency_code: z.enum(['JPY', 'USD', 'KRW', 'CNY']),
        base_rate_version_id: z.string(),
        base_rate_business_date: z.string(),
        base_rate_confirmed_at: epoch,
        base_rate_value: integerString,
        base_rate_scale: integerString,
        policy_version_id: z.string(),
        policy_scope_type: z.enum(['CURRENCY_PAIR_DEFAULT', 'SELLER_ORGANIZATION']),
        policy_seller_organization_id: z.string().nullable(),
        policy_version_no: z.number().int().positive(),
        policy_effective_from: epoch,
        policy_confirmed_at: epoch,
        markup_rate_value: integerString,
        markup_rate_scale: integerString,
        final_rate_value: integerString,
        final_rate_scale: integerString,
        rounding_rule: z.literal('HALF_UP'),
        seller_expected_principal_amount_minor: integerString,
      })
      .strict(),
    locked_service_fee_snapshot: z
      .object({
        fee_version_id: z.string(),
        version_no: z.number().int().positive(),
        review_type: z.string(),
        service_fee_cny_fen: integerString,
        effective_from: epoch,
        confirmed_at: epoch,
        marketplace_code: canonicalMarketplace,
        currency_code: z.literal('CNY'),
        currency_exponent: z.literal(2),
      })
      .strict(),
    business_completion: z
      .object({
        status: z.enum(['IN_PROGRESS', 'COMPLETE']),
        review: component,
        seller_principal: component,
        seller_service_fee: component,
      })
      .strict(),
    confirmed_business_date: z.string(),
  })
  .strict();
const sellerPlatformFormalOrderSchema = z
  .object({
    ...sellerFormalOrderCommon,
    legacy_projection: z.literal('NONE'),
    marketplace_code: z.null(),
    canonical_marketplace_code: z.enum(['RAKUTEN_JP', 'TIKTOK_JP']),
    amazon_order_number: z.null(),
    asin: z.null(),
    product_version: z.null(),
    review_type: z.enum(['RATING', 'TEXT', 'IMAGE', 'VIDEO']).nullable(),
    final_paid_jpy: z.null(),
    payment: z.null(),
    seller_expected_principal_cny_fen: z.null(),
    seller_principal_rate_snapshot: z.null(),
    locked_service_fee_snapshot: z.null(),
    business_completion: z.null(),
    confirmed_business_date: z.string().nullable(),
  })
  .strict();
export const sellerFormalOrdersSchema = z
  .object({
    items: z.array(
      z.discriminatedUnion('legacy_projection', [
        sellerAmazonFormalOrderSchema,
        sellerPlatformFormalOrderSchema,
      ]),
    ),
    page,
  })
  .strict();

export const sellerSettlementSummarySchema = z
  .object({
    settlement: z
      .object({
        outstanding_principal_cny_fen: integerString,
        outstanding_service_fee_cny_fen: integerString,
        total_outstanding_cny_fen: integerString,
        unallocated_credit_cny_fen: integerString,
        settlement_account_name: z.string().nullable(),
        settlement_account_identifier: z.string().nullable(),
      })
      .strict(),
  })
  .strict();

const productVersion = z
  .object({
    id: z.string(),
    version_no: z.number().int().positive(),
    product_name: z.string(),
    search_keywords: z.array(z.string()),
    ordering_guide_expected_amount_jpy: z.number().int().nullable(),
    color_spec_mode: z.enum(['MAIN_IMAGE_VARIANT', 'ANY_VARIANT']).nullable(),
    main_image: z.object({ file_entity_link_id: z.string() }).strict().nullable(),
    product_url: z.string().nullable(),
    buyer_visible_notes: z.string().nullable(),
    created_at: epoch,
  })
  .strict();

export const sellerProductsSchema = z
  .object({
    items: z.array(
      z
        .object({
          id: z.string(),
          store: z.object({ id: z.string(), display_name: z.string() }).strict(),
          marketplace_code: z.literal('AMAZON_JP'),
          seller_code: z.string(),
          asin: z.string(),
          status: z.enum(['ACTIVE', 'DISABLED']),
          current_version_no: z.number().int().positive(),
          version: z.number().int().positive(),
          created_at: epoch,
          updated_at: epoch,
          current_version: productVersion,
        })
        .strict(),
    ),
    page,
  })
  .strict();
export type SellerProductStatus = z.infer<typeof sellerProductsSchema>['items'][number]['status'];

const sellerApplication = z
  .object({
    id: z.string(),
    store: z.object({ id: z.string(), display_name: z.string() }).strict(),
    marketplace_code: z.literal('AMAZON_JP'),
    asin: z.string(),
    product_name: z.string(),
    search_keywords: z.array(z.string()),
    product_url: z.string().nullable(),
    buyer_visible_notes: z.string().nullable(),
    seller_notes: z.string().nullable(),
    ordering_guide_expected_amount_jpy: z.number().int().positive().nullable(),
    status: z.enum(['SUBMITTED', 'APPROVED', 'REJECTED', 'WITHDRAWN']),
    review_reason: z.string().nullable(),
    product_id: z.string().nullable(),
    version: z.number().int().positive(),
    submitted_at: epoch,
    updated_at: epoch,
    reviewed_at: epoch.nullable(),
    withdrawn_at: epoch.nullable(),
  })
  .strict();
export const sellerApplicationsSchema = z
  .object({ items: z.array(sellerApplication), page })
  .strict();
export const sellerApplicationMutationSchema = z
  .object({
    application: sellerApplication,
    replayed: z.boolean(),
  })
  .strict();
export const sellerApplicationDetailSchema = z.object({ application: sellerApplication }).strict();

export const sellerDemandsSchema = z
  .object({
    items: z.array(
      z
        .object({
          id: z.string(),
          store: z.object({ id: z.string(), display_name: z.string() }).strict(),
          product: z
            .object({
              id: z.string(),
              version_no: z.number().int().positive(),
              asin: z.string(),
              product_name: z.string(),
              search_keywords: z.array(z.string()),
              product_url: z.string().nullable(),
            })
            .strict(),
          marketplace_code: z.literal('AMAZON_JP'),
          task_type: z.enum(['RATING', 'TEXT', 'IMAGE', 'VIDEO']),
          target_quantity: z.number().int(),
          held_quantity: z.number().int(),
          approved_quantity: z.number().int(),
          remaining_quantity: z.number().int(),
          buyer_visible_notes: z.string().nullable(),
          seller_notes: z.string().nullable(),
          open_at: epoch,
          reservation_deadline: epoch,
          order_deadline: epoch,
          status: z.enum(['SUBMITTED', 'PUBLISHED', 'REJECTED', 'WITHDRAWN', 'CLOSED']),
          review_reason: z.string().nullable(),
          close_reason: z.string().nullable(),
          version: z.number().int().positive(),
          submitted_at: epoch,
          updated_at: epoch,
          reviewed_at: epoch.nullable(),
          published_at: epoch.nullable(),
          withdrawn_at: epoch.nullable(),
          closed_at: epoch.nullable(),
        })
        .strict(),
    ),
    page,
  })
  .strict();
export type SellerDemandStatus = z.infer<typeof sellerDemandsSchema>['items'][number]['status'];
export const sellerDemandMutationSchema = z
  .object({ demand_batch: sellerDemandsSchema.shape.items.element, replayed: z.boolean() })
  .strict();

export const sellerReviewsSchema = z
  .object({
    items: z.array(
      z
        .object({
          review_case_id: z.string(),
          formal_order: z.object({ id: z.string(), amazon_order_number: z.string() }).strict(),
          store: z.object({ id: z.string(), display_name: z.string() }).strict(),
          marketplace_code: z.literal('AMAZON_JP'),
          asin: z.string(),
          product_name: z.string(),
          review_type: z.enum(['RATING', 'TEXT', 'IMAGE', 'VIDEO']),
          status: z.enum([
            'PENDING_REVIEW',
            'CHANGES_REQUESTED',
            'REJECTED',
            'WITHDRAWN',
            'APPROVED',
          ]),
          version: z.number().int().positive(),
          review_url: z.string().nullable(),
          submitted_at: epoch,
          approved_at: epoch.nullable(),
          evidence: z
            .object({
              version_id: z.string(),
              version_no: z.number().int().positive(),
              submitted_at: epoch,
              files: z.array(
                z
                  .object({
                    file_entity_link_id: z.string(),
                    file_version: z.number().int().positive(),
                    content_type: z.enum([
                      'image/jpeg',
                      'image/png',
                      'image/webp',
                      'application/pdf',
                    ]),
                    byte_size: z.number().int().nonnegative(),
                    created_at: epoch,
                  })
                  .strict(),
              ),
            })
            .strict(),
          service_fee_accrued: z
            .object({ amount_cny_fen: integerString, accrued_at: epoch })
            .strict()
            .nullable(),
          allowed_actions: z.array(z.enum(['VIEW', 'READ_EVIDENCE'])),
        })
        .strict(),
    ),
    page,
  })
  .strict();
export type SellerReviewStatus = z.infer<typeof sellerReviewsSchema>['items'][number]['status'];
export const sellerPaymentsSchema = z
  .object({
    items: z.array(
      z
        .object({
          payment_id: z.string(),
          amount_cny_fen: integerString,
          paid_at: epoch,
          recorded_at: epoch,
          allocated_amount_cny_fen: integerString,
          unallocated_amount_cny_fen: integerString,
          status: z.enum(['REVERSED', 'UNALLOCATED', 'PARTIALLY_ALLOCATED', 'FULLY_ALLOCATED']),
          version: z.number().int().positive(),
          allocations: z.array(
            z
              .object({
                allocation_id: z.string(),
                payable_id: z.string(),
                payable_type: z.enum(['SELLER_PRINCIPAL', 'SELLER_SERVICE_FEE']),
                allocated_amount_cny_fen: integerString,
                reversed_amount_cny_fen: integerString,
                net_amount_cny_fen: integerString,
                allocated_at: epoch,
              })
              .strict(),
          ),
        })
        .strict(),
    ),
    page,
  })
  .strict();
export const sellerPayablesSchema = z
  .object({
    items: z.array(
      z
        .object({
          payable_id: z.string(),
          formal_order_id: z.string(),
          payable_type: z.enum(['SELLER_PRINCIPAL', 'SELLER_SERVICE_FEE']),
          amazon_order_number: z.string(),
          store: z.object({ id: z.string(), display_name: z.string() }).strict(),
          product: z.object({ id: z.string(), asin: z.string(), name: z.string() }).strict(),
          due_amount_cny_fen: integerString,
          paid_amount_cny_fen: integerString,
          outstanding_amount_cny_fen: integerString,
          status: z.enum(['UNPAID', 'PARTIALLY_PAID', 'PAID']),
          due_at: epoch,
          created_at: epoch,
        })
        .strict(),
    ),
    page,
  })
  .strict();
