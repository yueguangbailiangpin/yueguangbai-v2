import { createApp } from './app';
import { registerBuyerFormalOrderRoutes } from './buyer-formal-orders';
import { registerBuyerOrderEvidencePortalRoutes } from './buyer-order-evidence-portal';
import { registerBuyerPortalRoutes } from './buyer-portal';
import { registerCustomerAuthRoutes } from './http-auth';
import { registerSellerPortalRoutes } from './seller-portal';

const app = createApp();
registerCustomerAuthRoutes(app);
registerBuyerPortalRoutes(app);
registerBuyerOrderEvidencePortalRoutes(app);
registerBuyerFormalOrderRoutes(app);
registerSellerPortalRoutes(app);

export default app;
