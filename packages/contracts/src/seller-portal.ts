import type {
  ProductColorSpecMode,
  ProductStatus,
  SellerStoreStatus,
} from './catalog';
import type { SellerMemberRole } from './customer';
import type { CanonicalMarketplaceCode } from './customer';
import type { CurrencyCode, CurrencyExponent } from './marketplace-money';
import type { DemandBatchStatus, DemandTaskType } from './demand';
import type { ProductApplicationStatus } from './product-application';

export const SELLER_PORTAL_HTTP_PATHS = Object.freeze({
  me: '/api/seller-portal/me',
  stores: '/api/seller-portal/stores',
  products: '/api/seller-portal/products',
  product: '/api/seller-portal/products/:id',
  productVersions: '/api/seller-portal/products/:id/versions',
  productApplications: '/api/seller-portal/product-applications',
  productApplication: '/api/seller-portal/product-applications/:id',
  withdrawProductApplication:
    '/api/seller-portal/product-applications/:id/withdraw',
  demandBatches: '/api/seller-portal/demand-batches',
  demandBatch: '/api/seller-portal/demand-batches/:id',
  withdrawDemandBatch:
    '/api/seller-portal/demand-batches/:id/withdraw',
});

export const SELLER_PORTAL_DEFAULT_PAGE_SIZE = 25;
export const SELLER_PORTAL_MAX_PAGE_SIZE = 100;

export interface SellerPortalPageInfo {
  limit: number;
  next_cursor: string | null;
}

export interface SellerPortalPage<T> {
  items: readonly T[];
  page: SellerPortalPageInfo;
}

export interface SellerPortalMeDto {
  account_id: string;
  member: {
    id: string;
    display_name: string;
    role: SellerMemberRole;
    primary_owner: boolean;
  };
  organization: {
    id: string;
    seller_code: string;
    name: string;
    marketplace_code: 'JP';
    status: 'ACTIVE';
  };
  access: {
    read_scope: 'ORGANIZATION' | 'ASSIGNED_STORES';
    store_ids: readonly string[];
    can_submit_product_applications: boolean;
    can_submit_demand_batches: boolean;
  };
}

export interface SellerPortalStoreDto {
  id: string;
  marketplace_code: 'JP';
  canonical_marketplace_code: CanonicalMarketplaceCode;
  transaction_currency_code: CurrencyCode;
  transaction_currency_exponent: CurrencyExponent;
  marketplace_status: 'ACTIVE' | 'DISABLED';
  adapter_status: 'AVAILABLE' | 'UNAVAILABLE';
  display_name: string;
  status: SellerStoreStatus;
  version: number;
  created_at: number;
  updated_at: number;
}

export interface SellerPortalProductVersionDto {
  id: string;
  version_no: number;
  product_name: string;
  search_keywords: readonly string[];
  ordering_guide_expected_amount_jpy: number | null;
  color_spec_mode: ProductColorSpecMode | null;
  main_image: { file_entity_link_id: string } | null;
  product_url: string | null;
  buyer_visible_notes: string | null;
  created_at: number;
}

export interface SellerPortalProductDto {
  id: string;
  store: {
    id: string;
    display_name: string;
  };
  marketplace_code: 'JP';
  seller_code: string;
  asin: string;
  status: ProductStatus;
  current_version_no: number;
  version: number;
  created_at: number;
  updated_at: number;
  current_version: SellerPortalProductVersionDto;
}

export interface SellerPortalProductApplicationDto {
  id: string;
  store: {
    id: string;
    display_name: string;
  };
  marketplace_code: 'JP';
  asin: string;
  product_name: string;
  search_keywords: readonly string[];
  product_url: string | null;
  buyer_visible_notes: string | null;
  seller_notes: string | null;
  ordering_guide_expected_amount_jpy: number | null;
  status: ProductApplicationStatus;
  review_reason: string | null;
  product_id: string | null;
  version: number;
  submitted_at: number;
  updated_at: number;
  reviewed_at: number | null;
  withdrawn_at: number | null;
}

export interface SellerPortalDemandBatchDto {
  id: string;
  store: {
    id: string;
    display_name: string;
  };
  product: {
    id: string;
    version_no: number;
    asin: string;
    product_name: string;
    search_keywords: readonly string[];
    product_url: string | null;
  };
  marketplace_code: 'JP';
  task_type: DemandTaskType;
  target_quantity: number;
  held_quantity: number;
  approved_quantity: number;
  remaining_quantity: number;
  buyer_visible_notes: string | null;
  seller_notes: string | null;
  open_at: number;
  reservation_deadline: number;
  order_deadline: number;
  status: DemandBatchStatus;
  review_reason: string | null;
  close_reason: string | null;
  version: number;
  submitted_at: number;
  updated_at: number;
  reviewed_at: number | null;
  published_at: number | null;
  withdrawn_at: number | null;
  closed_at: number | null;
}

export interface SubmitSellerPortalProductApplicationBody {
  store_id: string;
  asin: string;
  product_name: string;
  search_keywords: readonly string[];
  product_url: string | null;
  buyer_visible_notes: string | null;
  seller_notes: string | null;
  ordering_guide_expected_amount_jpy: number;
  image_files: readonly {
    file_object_id: string;
    expected_file_version: number;
  }[];
}

export interface WithdrawSellerPortalResourceBody {
  expected_version: number;
}

export interface SubmitSellerPortalDemandBatchBody {
  product_id: string;
  task_type: DemandTaskType;
  target_quantity: number;
  buyer_visible_notes: string | null;
  seller_notes: string | null;
  open_at: number;
  reservation_deadline: number;
  order_deadline: number;
}
