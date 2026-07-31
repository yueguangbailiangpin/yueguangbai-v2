import { createApp } from './app';
import { registerCustomerAuthRoutes } from './http-auth';

const app = createApp();
registerCustomerAuthRoutes(app);

export default app;
