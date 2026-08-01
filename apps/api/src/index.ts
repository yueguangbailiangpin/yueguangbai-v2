import { createApp } from './app';
import { registerBuyerFormalOrderRoutes } from './buyer-formal-orders';
import { registerBuyerRefundStatusRoutes } from './buyer-refund-status';
import { registerBuyerOrderEvidencePortalRoutes } from './buyer-order-evidence-portal';
import { registerBuyerPortalRoutes } from './buyer-portal';
import { registerBuyerReviewRoutes } from './buyer-reviews';
import { registerBuyerSelfRegistrationRoutes } from './buyer-self-registration';
import { registerCustomerAuthRoutes } from './http-auth';
import { registerSellerFormalOrderRoutes } from './seller-formal-orders';
import { registerSellerReviewRoutes } from './seller-reviews';
import { registerSellerPortalRoutes } from './seller-portal';

const app = createApp();
registerCustomerAuthRoutes(app);
registerBuyerSelfRegistrationRoutes(app);
registerBuyerPortalRoutes(app);
registerBuyerOrderEvidencePortalRoutes(app);
registerBuyerFormalOrderRoutes(app);
registerBuyerRefundStatusRoutes(app);
registerBuyerReviewRoutes(app);
registerSellerPortalRoutes(app);
registerSellerFormalOrderRoutes(app);
registerSellerReviewRoutes(app);

export default app;
