import { createApp } from './app';
import { registerBuyerPortalRoutes } from './buyer-portal';
import { registerCustomerAuthRoutes } from './http-auth';
import { registerSellerPortalRoutes } from './seller-portal';

const app = createApp();
registerCustomerAuthRoutes(app);
registerBuyerPortalRoutes(app);
registerSellerPortalRoutes(app);

export default app;
