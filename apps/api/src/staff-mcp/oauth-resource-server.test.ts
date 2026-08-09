import { beforeAll, describe, expect, it } from 'vitest';
import {
  ProductionStaffMcpOAuthVerifier,
  ServiceBindingStaffMcpTokenStatusProvider,
} from './oauth-resource-server';
import type { StaffMcpIdentityStore } from './security-state';
import {
  ANONYMOUS_OAUTH_CONFIG,
  ANONYMOUS_ACTIVE_TOKEN_STATUS,
  AnonymousDocumentProvider,
  anonymousSigningFixture,
  signAnonymousToken,
} from './test-helpers';

describe('Staff MCP OAuth resource server', () => {
  let fixture: Awaited<ReturnType<typeof anonymousSigningFixture>>;

  beforeAll(async () => { fixture = await anonymousSigningFixture(); });

  it('accepts only exact RS256, issuer, audience, resource, lifetime and scope', async () => {
    const documents = new AnonymousDocumentProvider(fixture.jwk);
    const identities: StaffMcpIdentityStore = {
      async resolveActiveStaff(input) {
        return input.subject === 'anonymous-subject'
          && input.jti === 'anonymous-jti' ? 'staff-active' : null;
      },
    };
    const verifier = new ProductionStaffMcpOAuthVerifier(
      ANONYMOUS_OAUTH_CONFIG,
      documents,
      identities,
      ANONYMOUS_ACTIVE_TOKEN_STATUS,
    );
    const valid = await verifier.verifyAccessToken(
      await signAnonymousToken(fixture.privateKey, fixture.kid),
      1_000_000,
    );
    expect(valid).toMatchObject({
      staffId: 'staff-active',
      scopes: ['staff:mcp'],
      expiresAt: 1_600_000,
    });
    expect(valid?.clientId).toMatch(/^client-[0-9a-f]{32}$/u);
    expect(valid?.sessionId).toMatch(/^session-[0-9a-f]{32}$/u);

    for (const overrides of [
      { iss: 'https://wrong-issuer.invalid/' },
      { aud: 'https://wrong-resource.invalid/mcp' },
      { resource: 'https://wrong-resource.invalid/mcp' },
      { scope: 'staff:other' },
      { exp: 900 },
      { nbf: 1_120 },
      { iat: 1_000, exp: 5_000 },
    ]) {
      expect(await verifier.verifyAccessToken(
        await signAnonymousToken(fixture.privateKey, fixture.kid, overrides),
        1_000_000,
      )).toBeNull();
    }
  });

  it('refreshes once for rotation and fails closed on metadata/JWKS outage', async () => {
    const rotated = await anonymousSigningFixture('anonymous-key-2');
    const documents = new AnonymousDocumentProvider(fixture.jwk);
    documents.refreshedJwks = { keys: [rotated.jwk] };
    const verifier = new ProductionStaffMcpOAuthVerifier(
      ANONYMOUS_OAUTH_CONFIG,
      documents,
      { async resolveActiveStaff() { return 'staff-active'; } },
      ANONYMOUS_ACTIVE_TOKEN_STATUS,
    );
    expect(await verifier.verifyAccessToken(
      await signAnonymousToken(rotated.privateKey, rotated.kid),
      1_000_000,
    )).not.toBeNull();
    expect(documents.forceRefreshes).toBe(1);

    documents.metadataFailure = true;
    await expect(verifier.verifyAccessToken(
      await signAnonymousToken(rotated.privateKey, rotated.kid),
      1_000_000,
    )).rejects.toThrow('anonymous_metadata_outage');
    documents.metadataFailure = false;
    documents.jwksFailure = true;
    await expect(verifier.verifyAccessToken(
      await signAnonymousToken(rotated.privateKey, rotated.kid),
      1_000_000,
    )).rejects.toThrow('anonymous_jwks_outage');
  });

  it('rejects PKCE plain, ambiguous keys, private JWK material and revoked binding', async () => {
    const documents = new AnonymousDocumentProvider(fixture.jwk);
    const verifier = new ProductionStaffMcpOAuthVerifier(
      ANONYMOUS_OAUTH_CONFIG,
      documents,
      { async resolveActiveStaff() { return null; } },
      ANONYMOUS_ACTIVE_TOKEN_STATUS,
    );
    expect(await verifier.verifyAccessToken(
      await signAnonymousToken(fixture.privateKey, fixture.kid),
      1_000_000,
    )).toBeNull();

    const statusOutage = new ProductionStaffMcpOAuthVerifier(
      ANONYMOUS_OAUTH_CONFIG,
      new AnonymousDocumentProvider(fixture.jwk),
      { async resolveActiveStaff() { return 'staff-active'; } },
      { async isActive() { throw new Error('anonymous_status_outage'); } },
    );
    await expect(statusOutage.verifyAccessToken(
      await signAnonymousToken(fixture.privateKey, fixture.kid),
      1_000_000,
    )).rejects.toThrow('anonymous_status_outage');

    documents.metadata = {
      ...(documents.metadata as object),
      code_challenge_methods_supported: ['S256', 'plain'],
    };
    expect(await verifier.verifyAccessToken(
      await signAnonymousToken(fixture.privateKey, fixture.kid),
      1_000_000,
    )).toBeNull();
    documents.metadata = {
      ...(documents.metadata as object),
      code_challenge_methods_supported: ['S256'],
    };
    documents.jwks = { keys: [fixture.jwk, fixture.jwk] };
    expect(await verifier.verifyAccessToken(
      await signAnonymousToken(fixture.privateKey, fixture.kid),
      1_000_000,
    )).toBeNull();
    documents.jwks = { keys: [{ ...fixture.jwk, d: 'private' }] };
    expect(await verifier.verifyAccessToken(
      await signAnonymousToken(fixture.privateKey, fixture.kid),
      1_000_000,
    )).toBeNull();
  });

  it('uses a bounded zero-network Service Binding with hashed identifiers only', async () => {
    let serializedRequest = '';
    const provider = new ServiceBindingStaffMcpTokenStatusProvider({
      async fetch(request) {
        serializedRequest = await request.text();
        const body = JSON.parse(serializedRequest) as Record<string, unknown>;
        return Response.json({
          active: true,
          jti_hash: body['jti_hash'],
          expires_at: body['expires_at'],
          checked_at: body['checked_at'],
        });
      },
    }, 'anonymous-token-status-hash-secret-000001');
    await expect(provider.isActive(tokenStatusInput())).resolves.toBe(true);
    expect(serializedRequest).not.toMatch(
      /anonymous-issuer|anonymous-subject|anonymous-jti|anonymous-client/iu,
    );
    expect(JSON.parse(serializedRequest)).toMatchObject({
      issuer_hash: expect.stringMatching(/^[0-9a-f]{64}$/u),
      subject_hash: expect.stringMatching(/^[0-9a-f]{64}$/u),
      jti_hash: expect.stringMatching(/^[0-9a-f]{64}$/u),
      client_id_hash: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
  });

  it('fails closed on token-status timeout, redirect, size, content and body drift', async () => {
    const redirected = Response.json({
      active: true, jti_hash: 'x', expires_at: 2, checked_at: 1,
    });
    Object.defineProperty(redirected, 'redirected', { value: true });
    const cases = [
      new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } }),
      new Response('{}', { headers: { 'Content-Type': 'text/plain' } }),
      new Response('{}', {
        headers: { 'Content-Type': 'application/json', 'Content-Length': '9000' },
      }),
      new Response('{', { headers: { 'Content-Type': 'application/json' } }),
      redirected,
    ];
    for (const response of cases) {
      const provider = new ServiceBindingStaffMcpTokenStatusProvider({
        async fetch() { return response; },
      }, 'anonymous-token-status-hash-secret-000001');
      await expect(provider.isActive(tokenStatusInput())).rejects.toThrow();
    }
    const inactive = new ServiceBindingStaffMcpTokenStatusProvider({
      async fetch(request) {
        const body = await request.json() as Record<string, unknown>;
        return Response.json({
          active: false,
          jti_hash: body['jti_hash'],
          expires_at: body['expires_at'],
          checked_at: body['checked_at'],
        });
      },
    }, 'anonymous-token-status-hash-secret-000001');
    await expect(inactive.isActive(tokenStatusInput())).resolves.toBe(false);
    const timedOutRequests: Request[] = [];
    const timeout = new ServiceBindingStaffMcpTokenStatusProvider({
      fetch(request) {
        timedOutRequests.push(request);
        return new Promise<Response>(() => undefined);
      },
    }, 'anonymous-token-status-hash-secret-000001', 50);
    await expect(timeout.isActive(tokenStatusInput()))
      .rejects.toThrow('staff_mcp_token_status_timeout');
    expect(timedOutRequests).toHaveLength(1);
    expect(timedOutRequests[0]?.signal.aborted).toBe(true);
  });
});

function tokenStatusInput() {
  return {
    issuer: 'https://anonymous-issuer.invalid/',
    subject: 'anonymous-subject',
    jti: 'anonymous-jti',
    clientId: 'anonymous-client',
    issuedAt: 1,
    expiresAt: 2,
    now: 1,
  };
}
