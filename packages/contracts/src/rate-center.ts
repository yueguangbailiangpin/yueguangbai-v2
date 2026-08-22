import type { BuyerDailyExchangeRateReadDto } from './pricing';
import type { SellerPrincipalRatePolicyReadDto } from './seller-principal-rate-policy';

export interface StaffRateCenterSellerOrganizationDto {
  seller_organization_id: string;
  seller_organization_name: string;
  marketplace_code: string;
}

export interface StaffRateCenterReadDto {
  business_date: string;
  source_currency_code: 'JPY';
  quote_currency_code: 'CNY';
  base_rate: BuyerDailyExchangeRateReadDto;
  seller_organizations: readonly StaffRateCenterSellerOrganizationDto[];
  policies: SellerPrincipalRatePolicyReadDto;
}
