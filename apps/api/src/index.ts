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
import {
  registerSellerSettlementRoutes,
  registerStaffSellerSettlementProofRoutes,
  registerStaffSellerSettlementRoutes,
} from './seller-settlements';
import { registerStaffAssignmentRoutes } from './staff-assignment';
import {
  FeishuStaffAuthProvider,
  registerStaffAuthRoutes,
} from './staff-auth';
import { registerStaffCatalogWorkflowRoutes } from './staff-catalog-routes';
import { registerMarketplaceFoundationRoutes } from './marketplaces/routes';
import { registerScheduledOperationRoutes } from './scheduled-operations';

const app = createApp();

// Public authentication endpoints are intentionally registered before the
// protected Staff namespace. They issue the internal Worker session; Staff
// business APIs never consume Feishu headers or Provider tokens directly.
registerCustomerAuthRoutes(app);
registerPublicCustomerSecurityRoutes(app);
registerStaffAuthRoutes(app, {
  providerFactory: (config, context) => (
    context.env.STAFF_AUTH_PROVIDER_ADAPTER
      ?? new FeishuStaffAuthProvider(config)
  ),
});

// This path middleware must precede every /api/staff route registration.
app.use('/api/staff/*', staffSessionMiddleware());
registerStaffAssignmentRoutes(app);
registerStaffCustomerSecurityRoutes(app);
registerStaffCatalogWorkflowRoutes(app);
registerMarketplaceFoundationRoutes(app);
registerStaffReviewRoutes(app);
registerStaffSellerSettlementRoutes(app);
registerStaffSellerSettlementProofRoutes(app);
registerStaffFinanceRoutes(app);
registerStaffOrderEvidenceRoutes(app);
registerStaffBuyerRefundRoutes(app);
registerScheduledOperationRoutes(app);
registerFileHttpRoutes(app);

registerBuyerSelfRegistrationRoutes(app);
registerBuyerPortalRoutes(app);
app.use(
  '/api/buyer-portal/order-evidence',
  exactOneOrderEvidenceScreenshotGuard(),
);
app.use(
  '/api/buyer-portal/order-evidence/:id/resubmit',
  exactOneOrderEvidenceScreenshotGuard(),
);
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
