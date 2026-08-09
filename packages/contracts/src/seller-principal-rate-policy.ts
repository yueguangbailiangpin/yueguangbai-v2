import type { CurrencyCode } from './marketplace-money';
import type { FixedIntegerString } from './pricing';

export const SELLER_PRINCIPAL_RATE_POLICY_HTTP_PATHS = Object.freeze({
  policies: '/api/staff/seller-principal-rate-policies',
  submit: '/api/staff/seller-principal-rate-policies/submit',
  confirm: '/api/staff/seller-principal-rate-policies/:id/confirm',
  reject: '/api/staff/seller-principal-rate-policies/:id/reject',
});

export type SellerPrincipalRatePolicyScope =
  | 'CURRENCY_PAIR_DEFAULT'
  | 'SELLER_ORGANIZATION';

export interface SellerPrincipalRatePolicyVersionDto {
  policy_version_id: string;
  scope_type: SellerPrincipalRatePolicyScope;
  seller_organization_id: string | null;
  source_currency_code: CurrencyCode;
  quote_currency_code: 'CNY';
  version_no: number;
  decision_version: number;
  status: 'SUBMITTED' | 'CONFIRMED' | 'REJECTED';
  markup_rate_value: FixedIntegerString;
  markup_rate_scale: FixedIntegerString;
  effective_from: number;
  submitted_at: number;
  confirmed_at: number | null;
  rejection_reason: string | null;
  replayed: boolean;
}

export interface SellerPrincipalRatePolicyReadDto {
  source_currency_code: CurrencyCode;
  quote_currency_code: 'CNY';
  seller_organization_id: string;
  default_policy: SellerPrincipalRatePolicyVersionDto | null;
  seller_override_policy: SellerPrincipalRatePolicyVersionDto | null;
  default_pending_policy: SellerPrincipalRatePolicyVersionDto | null;
  seller_override_pending_policy: SellerPrincipalRatePolicyVersionDto | null;
  default_next_version: number;
  seller_override_next_version: number;
  selected_policy: SellerPrincipalRatePolicyVersionDto | null;
}

export interface SellerPrincipalRateSnapshotDto {
  platform_order_date: string;
  payment_amount_minor: FixedIntegerString;
  payment_currency_code: CurrencyCode;
  base_rate_version_id: string;
  base_rate_business_date: string;
  base_rate_confirmed_at: number;
  base_rate_value: FixedIntegerString;
  base_rate_scale: FixedIntegerString;
  policy_version_id: string;
  policy_scope_type: SellerPrincipalRatePolicyScope;
  policy_seller_organization_id: string | null;
  policy_version_no: number;
  policy_effective_from: number;
  policy_confirmed_at: number;
  markup_rate_value: FixedIntegerString;
  markup_rate_scale: FixedIntegerString;
  final_rate_value: FixedIntegerString;
  final_rate_scale: FixedIntegerString;
  rounding_rule: 'HALF_UP';
  seller_expected_principal_amount_minor: FixedIntegerString;
}
