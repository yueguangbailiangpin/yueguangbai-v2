import type {
  SellerBusinessCompletionComponentStatus,
  SellerBusinessCompletionDto,
} from '@ygb/contracts';

export interface SellerBusinessCompletionFacts {
  reviewStatus: string | null;
  principalExpectedCnyFen: bigint;
  principalStatus: string | null;
  serviceFeeExpectedCnyFen: bigint;
  serviceFeeStatus: string | null;
}

export function sellerBusinessCompletion(
  facts: SellerBusinessCompletionFacts,
): SellerBusinessCompletionDto {
  const review = facts.reviewStatus === 'APPROVED'
    ? 'COMPLETE'
    : 'PENDING';
  const sellerPrincipal = financialComponent(
    true,
    facts.principalExpectedCnyFen,
    facts.principalStatus,
    'PAID',
  );
  const sellerServiceFee = financialComponent(
    facts.reviewStatus === 'APPROVED',
    facts.serviceFeeExpectedCnyFen,
    facts.serviceFeeStatus,
    'PAID',
  );
  const components = [
    review,
    sellerPrincipal,
    sellerServiceFee,
  ];
  return Object.freeze({
    status: components.every((value) => value !== 'PENDING')
      ? 'COMPLETE'
      : 'IN_PROGRESS',
    review,
    seller_principal: sellerPrincipal,
    seller_service_fee: sellerServiceFee,
  });
}

function financialComponent(
  prerequisiteComplete: boolean,
  expectedCnyFen: bigint,
  actualStatus: string | null,
  completedStatus: string,
): SellerBusinessCompletionComponentStatus {
  if (expectedCnyFen < 0n) throw new RangeError('NEGATIVE_FINANCIAL_FACT');
  if (!prerequisiteComplete) return 'PENDING';
  if (expectedCnyFen === 0n) return 'NOT_APPLICABLE';
  return actualStatus === completedStatus ? 'COMPLETE' : 'PENDING';
}
