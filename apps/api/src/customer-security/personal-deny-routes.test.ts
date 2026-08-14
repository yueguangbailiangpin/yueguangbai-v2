import { describe, expect, it } from 'vitest';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { createApp } from '../app';
import { registerCustomerLoginIdentifierChangeRoutes } from '../customer-onboarding/login-identifier-change-routes';
import { registerSellerRegistrationRoutes } from '../seller-registration/routes';

const ORIGIN = 'https://api.local.test';
const SECRET = 'personal-deny-test-secret-at-least-32-bytes';

describe('Customer security Staff Personal DENY boundaries', () => {
  it('rejects an owner denied high-risk identity management before D1 access', async () => {
    const app = staffApp(actor('owner', []));
    registerCustomerLoginIdentifierChangeRoutes(app);
    const response = await app.request(
      `${ORIGIN}/api/staff/customer-onboarding/BUYER/buyer-1/change-wechat`,
      {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          new_wechat_id: 'new_wechat',
          verification_note: '人工核验记录完整',
        }),
      },
      deniedDatabaseEnv(),
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'FORBIDDEN' },
    });
  });

  it('rejects denied Seller management issue/read/revoke before D1 access', async () => {
    const app = staffApp(actor('seller_ops', []));
    registerSellerRegistrationRoutes(app);
    const requests: Array<[string, RequestInit]> = [
      ['/api/staff/customer-security/seller-invitations', {
        method: 'POST', headers: headers(), body: JSON.stringify({
          lead_id: 'lead-1', seller_organization_id: null,
          wechat_id: 'seller_wechat', marketplace_code: 'AMAZON_JP',
        }),
      }],
      ['/api/staff/customer-security/seller-invitations/current?lead_id=lead-1', {}],
      ['/api/staff/customer-security/seller-invitations/invitation-1', {}],
      ['/api/staff/customer-security/seller-invitations/invitation-1/revoke', {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ expected_version: 1 }),
      }],
    ];
    for (const [pathname, init] of requests) {
      const response = await app.request(
        `${ORIGIN}${pathname}`,
        init,
        deniedDatabaseEnv(),
      );
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'FORBIDDEN' },
      });
    }
  });

  it('lets the effective permission gate pass before request validation', async () => {
    const identifierApp = staffApp(actor(
      'owner',
      ['BUYER_IDENTITY_HIGH_RISK_MANAGE'],
    ));
    registerCustomerLoginIdentifierChangeRoutes(identifierApp);
    const invalidType = await identifierApp.request(
      `${ORIGIN}/api/staff/customer-onboarding/INVALID/subject/change-wechat`,
      { method: 'POST', headers: headers(), body: '{}' },
      deniedDatabaseEnv(),
    );
    expect(invalidType.status).toBe(400);

    const sellerApp = staffApp(actor('seller_ops', ['SELLER_MANAGE']));
    registerSellerRegistrationRoutes(sellerApp);
    const invalidMarketplace = await sellerApp.request(
      `${ORIGIN}/api/staff/customer-security/seller-invitations`,
      {
        method: 'POST', headers: headers(), body: JSON.stringify({
          lead_id: 'lead-1', seller_organization_id: null,
          wechat_id: 'seller_wechat', marketplace_code: 'INVALID',
        }),
      },
      deniedDatabaseEnv(),
    );
    expect(invalidMarketplace.status).toBe(400);
  });
});

function staffApp(authorization: AssignmentStaffAuthorization) {
  const app = createApp();
  app.use('/api/staff/*', async (context, next) => {
    context.set('staffAuthorization', authorization);
    await next();
  });
  return app;
}

function actor(
  role: 'owner' | 'seller_ops',
  permissions: Array<'BUYER_IDENTITY_HIGH_RISK_MANAGE' | 'SELLER_MANAGE'>,
): AssignmentStaffAuthorization {
  return {
    staffId: `staff-${role}`,
    displayName: role,
    staffStatus: 'ACTIVE',
    authorizationVersion: 1,
    roles: new Set([role]),
    permissions: new Set(permissions),
    memberTeamIds: [],
    leaderTeamIds: [],
  };
}

function headers(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Origin: ORIGIN,
    'Sec-Fetch-Site': 'same-origin',
    'Idempotency-Key': 'personal-deny-route-0001',
  };
}

function deniedDatabaseEnv() {
  const database = new Proxy({}, {
    get() { throw new Error('denied_route_accessed_database'); },
  });
  return {
    DB: database,
    CUSTOMER_SECURITY_TOKEN_SECRET: SECRET,
  } as any;
}
