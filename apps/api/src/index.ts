import { createApp } from './app';
import { registerBuyerFormalOrderRoutes } from './buyer-formal-orders';
import { registerBuyerRefundStatusRoutes } from './buyer-refund-status';
import { registerBuyerOrderEvidencePortalRoutes } from './buyer-order-evidence-portal';
import { registerOrderInstructionRoutes } from './order-instructions';
import { registerBuyerPortalRoutes } from './buyer-portal';
import { registerBuyerReviewRoutes } from './buyer-reviews';
import { registerBuyerSelfRegistrationRoutes } from './buyer-self-registration';
import { registerCustomerAuthRoutes } from './http-auth';
import { registerStaffFinanceRoutes } from './internal-finance';
import { staffSessionMiddleware } from './middleware/staff-auth';
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
import { registerStaffAuthRoutes } from './staff-auth';
import { registerStaffCatalogWorkflowRoutes } from './staff-catalog-routes';

const app = createApp();

// Public authentication endpoints are intentionally registered before the
// protected Staff namespace. They issue the internal Worker session; Staff
// business APIs never consume Feishu headers or Provider tokens directly.
registerCustomerAuthRoutes(app);
registerStaffAuthRoutes(app);

// This path middleware must precede every /api/staff route registration.
app.use('/api/staff/*', staffSessionMiddleware());
registerStaffAssignmentRoutes(app);
registerStaffCatalogWorkflowRoutes(app);
registerStaffReviewRoutes(app);
registerStaffSellerSettlementRoutes(app);
registerStaffSellerSettlementProofRoutes(app);
registerStaffFinanceRoutes(app);

registerBuyerSelfRegistrationRoutes(app);
registerBuyerPortalRoutes(app);
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
