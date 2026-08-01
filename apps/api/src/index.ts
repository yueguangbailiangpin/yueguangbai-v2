import { createApp } from './app';
import { registerBuyerFormalOrderRoutes } from './buyer-formal-orders';
import { registerBuyerOrderEvidencePortalRoutes } from './buyer-order-evidence-portal';
import { registerBuyerPortalRoutes } from './buyer-portal';
import { registerBuyerReviewRoutes } from './buyer-reviews';
import { registerCustomerAuthRoutes } from './http-auth';
import { registerSellerFormalOrderRoutes } from './seller-formal-orders';
import { registerSellerPortalRoutes } from './seller-portal';

const app = createApp();
registerCustomerAuthRoutes(app);
registerBuyerPortalRoutes(app);
registerBuyerOrderEvidencePortalRoutes(app);
registerBuyerFormalOrderRoutes(app);
registerBuyerReviewRoutes(app);
registerSellerPortalRoutes(app);
registerSellerFormalOrderRoutes(app);

export default app;
