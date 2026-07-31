import { createApp } from './app';
import { registerBuyerPortalRoutes } from './buyer-portal';
import { registerCustomerAuthRoutes } from './http-auth';

const app = createApp();
registerCustomerAuthRoutes(app);
registerBuyerPortalRoutes(app);

export default app;
