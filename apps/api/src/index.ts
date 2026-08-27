import { createApp } from './app';
import { registerBuyerFormalOrderRoutes } from './buyer-formal-orders';
import { registerBuyerRefundStatusRoutes } from './buyer-refund-status';
import { registerBuyerOrderEvidencePortalRoutes } from './buyer-order-evidence-portal';
import { registerOrderInstructionRoutes } from './order-instructions';
import { registerBuyerPortalRoutes } from './buyer-portal';
import { registerBuyerReviewRoutes } from './buyer-reviews';
import { registerBuyerSelfRegistrationRoutes } from './buyer-self-registration';
import { registerStaffBuyerRefundRoutes } from './buyer-refunds/staff-routes';
import { registerFileHttpRoutes } from './files';
import { registerCustomerAuthRoutes } from './http-auth';
import {
  registerPublicCustomerSecurityRoutes,
  registerStaffCustomerSecurityRoutes,
} from './customer-security';
import { registerBuyerInvitationDutyGuard } from './customer-onboarding/buyer-invitation-guard';
import { registerNewBuyerRegistrationInvitationRoute } from './customer-onboarding/buyer-registration-route';
import { registerLegacyPasswordResetOwnerGuard } from './customer-onboarding/legacy-password-reset-guard';
import { registerCustomerOnboardingRoutes } from './customer-onboarding/routes';
import { registerScopedCustomerPasswordResetRoutes } from './customer-onboarding/password-reset-routes';
import { registerIdentityResolutionRoutes } from './customer-onboarding/identity-resolution-routes';
import { registerCustomerLoginIdentifierChangeRoutes } from './customer-onboarding/login-identifier-change-routes';
import { registerStaffFinanceRoutes } from './internal-finance';
import { staffSessionMiddleware } from './middleware/staff-auth';
import {
  exactOneOrderEvidenceScreenshotGuard,
  registerStaffOrderEvidenceRoutes,
} from './order-evidence';
import { registerStaffReviewRoutes } from './reviews';
import { registerSellerFormalOrderRoutes } from './seller-formal-orders';
import { registerSellerReviewRoutes } from './seller-reviews';
import { registerSellerPortalRoutes } from './seller-portal';
import { registerSellerMemberRoutes } from './seller-portal/member-routes';
import { registerOrderCommunicationScreenshotRoutes } from './order-communication-screenshots';
import { registerSellerRegistrationRoutes } from './seller-registration/routes';
import {
  registerSellerSettlementRoutes,
  registerStaffSellerSettlementProofRoutes,
  registerStaffSellerSettlementRoutes,
} from './seller-settlements';
import { registerStaffAssignmentRoutes } from './staff-assignment';
import { registerCloudflareStaffAuthRoutes } from './staff-auth/access-routes';
import { registerStaffCatalogWorkflowRoutes } from './staff/catalog-routes';
import { registerStaffWorkflowClosureRoutes } from './staff/workflow-closure-routes';
import { registerMarketplaceFoundationRoutes } from './marketplaces/routes';
import { registerScheduledOperationRoutes } from './scheduled-operations';
import { registerColdImageArchiveRoutes } from './cold-image-archive';
import { registerAdminBusinessDashboardRoutes } from './admin-business-dashboard';
import { registerStaffAccessManagementRoutes } from './staff/access-management';
import { registerSellerPrincipalRatePolicyRoutes } from './pricing/routes';
import { registerSellerServiceFeeRoutes } from './pricing/seller-service-fee-routes';
import { registerStaffRateCenterRoutes } from './pricing/rate-center-routes';
import { registerOperationalReadinessRoutes } from './operational-readiness/routes';
import { registerOperationalAlertAttestationRoutes } from './operational-readiness/alert-attestation';
import { registerOperatingIntegrityRoutes } from './operating-integrity/routes';
import { registerStaffOrderDetailRoutes } from './staff-order-detail/routes';
import { registerStaffSearchRoutes } from './staff-search/routes';
import { registerProductionRecoveryAttestationRoutes } from './production-readiness/recovery-attestation-routes';
import { registerFormalOrderPolicyGuards } from './formal-order-policy-routes';

const app = createApp();

registerOperationalReadinessRoutes(app);
registerCustomerAuthRoutes(app);
registerPublicCustomerSecurityRoutes(app);
registerCloudflareStaffAuthRoutes(app);
registerSellerMemberRoutes(app);

app.use('/api/staff/*', staffSessionMiddleware());
registerOrderCommunicationScreenshotRoutes(app);
registerFormalOrderPolicyGuards(app);
registerSellerRegistrationRoutes(app);
registerStaffAssignmentRoutes(app);
registerSellerPrincipalRatePolicyRoutes(app);
registerSellerServiceFeeRoutes(app);
registerStaffRateCenterRoutes(app);
registerBuyerInvitationDutyGuard(app);
registerLegacyPasswordResetOwnerGuard(app);
registerStaffCustomerSecurityRoutes(app);
registerNewBuyerRegistrationInvitationRoute(app);
registerCustomerOnboardingRoutes(app);
registerScopedCustomerPasswordResetRoutes(app);
registerIdentityResolutionRoutes(app);
registerCustomerLoginIdentifierChangeRoutes(app);
registerOperatingIntegrityRoutes(app);
registerStaffOrderDetailRoutes(app);
registerStaffSearchRoutes(app);
registerProductionRecoveryAttestationRoutes(app);
registerOperationalAlertAttestationRoutes(app);
registerAdminBusinessDashboardRoutes(app);
registerStaffAccessManagementRoutes(app);
registerStaffCatalogWorkflowRoutes(app);
registerStaffWorkflowClosureRoutes(app);
registerMarketplaceFoundationRoutes(app);
registerStaffReviewRoutes(app);
registerStaffSellerSettlementRoutes(app);
registerStaffSellerSettlementProofRoutes(app);
registerStaffFinanceRoutes(app);
registerStaffOrderEvidenceRoutes(app);
registerStaffBuyerRefundRoutes(app);
registerScheduledOperationRoutes(app);
registerColdImageArchiveRoutes(app);
registerFileHttpRoutes(app);

registerBuyerSelfRegistrationRoutes(app);
registerBuyerPortalRoutes(app);
app.use('/api/buyer-portal/order-evidence', exactOneOrderEvidenceScreenshotGuard());
app.use('/api/buyer-portal/order-evidence/:id/resubmit', exactOneOrderEvidenceScreenshotGuard());
registerBuyerOrderEvidencePortalRoutes(app);
registerOrderInstructionRoutes(app);
registerBuyerFormalOrderRoutes(app);
registerBuyerRefundStatusRoutes(app);
registerBuyerReviewRoutes(app);
registerSellerPortalRoutes(app);
registerSellerFormalOrderRoutes(app);
registerSellerReviewRoutes(app);
registerSellerSettlementRoutes(app);

export default app;
