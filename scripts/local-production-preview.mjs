import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { build, createServer, preview } from 'vite';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = resolve(repositoryRoot, 'apps/web');
const webConfig = resolve(webRoot, 'vite.config.ts');
const host = '127.0.0.1';
const configuredPort = Number(process.env['LOCAL_PREVIEW_PORT'] ?? '4174');
if (!Number.isSafeInteger(configuredPort) || configuredPort < 1024 || configuredPort > 65_535) {
  throw new Error('LOCAL_PREVIEW_PORT must be an integer from 1024 to 65535');
}

await build({ root: webRoot, configFile: webConfig });

const sourceLoader = await createServer({
  root: repositoryRoot,
  configFile: false,
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
});

const [
  { default: app },
  { loginThroughDefaultApp, runtimeBindings, seedWave13RuntimeAuthority },
  { createBuyerCustomer },
  { createSellerOrganization },
  { activateBuyerCustomer },
  { activateSellerOrganizationOwner },
  { changeCustomerPassword },
  { createMigratedTestDatabase },
] = await Promise.all([
  sourceLoader.ssrLoadModule('/apps/api/src/index.ts'),
  sourceLoader.ssrLoadModule('/apps/api/test-support/wave13-runtime.ts'),
  sourceLoader.ssrLoadModule('/apps/api/src/customers/create-buyer.ts'),
  sourceLoader.ssrLoadModule('/apps/api/src/customers/create-seller-organization.ts'),
  sourceLoader.ssrLoadModule('/apps/api/src/customer-auth/activate-buyer.ts'),
  sourceLoader.ssrLoadModule('/apps/api/src/customer-auth/activate-seller-owner.ts'),
  sourceLoader.ssrLoadModule('/apps/api/src/customer-auth/change-password.ts'),
  sourceLoader.ssrLoadModule('/packages/testkit/src/sqlite-database.ts'),
]);

const database = createMigratedTestDatabase();
seedWave13RuntimeAuthority(database);

const actor = {
  staffId: 'zz-phase3h-test-owner',
  displayName: '本地测试管理员',
  roles: ['owner'],
  permissions: new Set(['BUYER_CREATE', 'BUYER_ACTIVATE_STANDARD', 'SELLER_MANAGE']),
};
const now = Date.now();
database.exec(`
  INSERT INTO buyer_channels (
    id, code, name, status, next_sequence, version,
    created_at, updated_at, disabled_at
  ) VALUES ('local-preview-buyer-channel','DEMO','本地测试渠道',
    'ACTIVE',1,1,${now},${now},NULL);
`);

const buyer = await createBuyerCustomer(database, {
  marketplaceCode: 'AMAZON_JP',
  buyerChannelId: 'local-preview-buyer-channel',
  displayName: '演示买家',
  wechatId: 'buyer_demo',
}, { actor, idempotencyKey: 'local-preview-buyer-create', now });
const buyerActivation = await activateBuyerCustomer(database, {
  buyerCustomerId: buyer.buyer_customer_id,
  passwordIterations: 10_000,
}, { actor, idempotencyKey: 'local-preview-buyer-activate', now: now + 1 });
await changeCustomerPassword(database, {
  accountId: buyerActivation.account_id,
  currentPassword: String(buyerActivation.temporary_password),
  newPassword: 'Moonlight-Buyer-2026!',
  passwordIterations: 10_000,
}, { idempotencyKey: 'local-preview-buyer-password', now: now + 2 });

const seller = await createSellerOrganization(database, {
  marketplaceCode: 'AMAZON_JP',
  sellerChannelId: 'seller-channel-ido-mango',
  organizationName: '月光白演示店铺',
  ownerDisplayName: '演示卖家',
  ownerWechatId: 'seller_demo',
}, { actor, idempotencyKey: 'local-preview-seller-create', now: now + 3 });
const sellerActivation = await activateSellerOrganizationOwner(database, {
  sellerOrganizationId: seller.seller_organization_id,
  passwordIterations: 10_000,
}, { actor, idempotencyKey: 'local-preview-seller-activate', now: now + 4 });
await changeCustomerPassword(database, {
  accountId: sellerActivation.account_id,
  currentPassword: String(sellerActivation.temporary_password),
  newPassword: 'Moonlight-Seller-2026!',
  passwordIterations: 10_000,
}, { idempotencyKey: 'local-preview-seller-password', now: now + 5 });

const env = {
  ...runtimeBindings(database, 'owner'),
  STAFF_AUTH_ALLOWED_ORIGINS: 'https://api.example.test',
  CUSTOMER_SESSION_SECRET: 'local-preview-customer-session-secret-2026',
  CUSTOMER_SECURITY_TOKEN_SECRET: 'local-preview-security-token-secret-2026',
};

async function appResponse(url, init = {}) {
  const headers = new Headers(init.headers);
  headers.set('Origin', 'https://api.example.test');
  headers.set('Sec-Fetch-Site', 'same-origin');
  return app.fetch(new Request(`https://api.example.test${url}`, {
    ...init,
    headers,
  }), env);
}

async function localStaffLogin() {
  const identity = await loginThroughDefaultApp(database, 'owner');
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/staff',
      'Set-Cookie': `${identity.cookie}; Path=/; HttpOnly; Secure; SameSite=Lax`,
      'Cache-Control': 'no-store',
    },
  });
}

async function send(response, result) {
  result.statusCode = response.status;
  for (const [name, value] of response.headers) {
    if (name !== 'set-cookie') result.setHeader(name, value);
  }
  const cookies = response.headers.getSetCookie();
  if (cookies.length) result.setHeader('Set-Cookie', cookies);
  result.end(Buffer.from(await response.arrayBuffer()));
}

const localApiPlugin = {
  name: 'local-production-preview-api',
  configurePreviewServer(server) {
    server.middlewares.use((request, result, next) => {
      const url = request.url ?? '/';
      if (url === '/__test/staff-login') {
        void localStaffLogin().then((response) => send(response, result)).catch(next);
        return;
      }
      if (!url.startsWith('/api/')) {
        next();
        return;
      }
      const chunks = [];
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      request.on('end', () => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(request.headers)) {
          if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
          else if (value !== undefined) headers.set(name, value);
        }
        void appResponse(url, {
          method: request.method,
          headers,
          body: request.method === 'GET' || request.method === 'HEAD'
            ? undefined
            : Buffer.concat(chunks),
        }).then((response) => send(response, result)).catch(next);
      });
    });
  },
};

const previewServer = await preview({
  root: webRoot,
  configFile: webConfig,
  plugins: [localApiPlugin],
  preview: { host, port: configuredPort, strictPort: true },
});

console.log(`LOCAL_PRODUCTION_PREVIEW_READY http://${host}:${configuredPort}`);
console.log('BUYER buyer_demo / Moonlight-Buyer-2026!');
console.log('SELLER seller_demo / Moonlight-Seller-2026!');
console.log(`STAFF http://${host}:${configuredPort}/__test/staff-login`);

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  database.close();
  await Promise.allSettled([previewServer.close(), sourceLoader.close()]);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    void close().finally(() => process.exit(0));
  });
}
