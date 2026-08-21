import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import app from '../index';
import { verifyCloudflareAccessIdentity } from './cloudflare-access';

let database: SqliteDatabase | null = null;
afterEach(() => {
  database?.close();
  database = null;
  vi.restoreAllMocks();
});

describe('Cloudflare Access Staff identity', () => {
  it('verifies RS256, issuer, audience, time and normalized email', async () => {
    const fixture = await jwtFixture(
      'https://team-one.cloudflareaccess.com',
      'audience-staff-001',
      ' Staff.Owner@Example.Test ',
    );
    const fetchSpy = mockJwks(fixture.jwk);
    await expect(
      verifyCloudflareAccessIdentity(
        new Request('https://app.example.test', {
          headers: { 'Cf-Access-Jwt-Assertion': fixture.token },
        }),
        {
          STAFF_ACCESS_TEAM_DOMAIN: fixture.issuer,
          STAFF_ACCESS_AUD: fixture.audience,
        },
        fixture.now,
      ),
    ).resolves.toEqual({ email: 'staff.owner@example.test', subject: 'access-subject' });
    expect(fetchSpy).toHaveBeenCalledWith(`${fixture.issuer}/cdn-cgi/access/certs`, {
      method: 'GET',
      redirect: 'manual',
      headers: { Accept: 'application/json' },
    });
  });

  it('fails closed for wrong audience, bad signature and unavailable keys', async () => {
    const fixture = await jwtFixture(
      'https://team-two.cloudflareaccess.com',
      'audience-staff-002',
      'staff@example.test',
    );
    mockJwks(fixture.jwk);
    await expect(
      verifyCloudflareAccessIdentity(
        request(fixture.token),
        { STAFF_ACCESS_TEAM_DOMAIN: fixture.issuer, STAFF_ACCESS_AUD: 'different-audience' },
        fixture.now,
      ),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED', reason: 'AUDIENCE' });
    const tampered = `${fixture.token.slice(0, -2)}aa`;
    await expect(
      verifyCloudflareAccessIdentity(
        request(tampered),
        { STAFF_ACCESS_TEAM_DOMAIN: fixture.issuer, STAFF_ACCESS_AUD: fixture.audience },
        fixture.now,
      ),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED', reason: 'SIGNATURE' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 503 }));
    const third = await jwtFixture(
      'https://team-three.cloudflareaccess.com',
      'audience-staff-003',
      'staff@example.test',
    );
    await expect(
      verifyCloudflareAccessIdentity(
        request(third.token),
        { STAFF_ACCESS_TEAM_DOMAIN: third.issuer, STAFF_ACCESS_AUD: third.audience },
        third.now,
      ),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED', reason: 'JWKS_HTTP' });
  });

  it('rejects a self-origin or arbitrary JWKS authority before fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    for (const teamDomain of [
      'https://app.example.test',
      'https://arbitrary.example.com',
      'https://nested.team.cloudflareaccess.com',
    ]) {
      await expect(
        verifyCloudflareAccessIdentity(new Request('https://app.example.test'), {
          STAFF_ACCESS_TEAM_DOMAIN: teamDomain,
          STAFF_ACCESS_AUD: 'audience-staff-invalid-team',
        }),
      ).rejects.toMatchObject({ code: 'CONFIGURATION', reason: 'BINDINGS' });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('bootstraps only a pre-existing active Moonwhite email identity and issues an opaque session', async () => {
    database = createMigratedTestDatabase();
    database.raw
      .prepare(
        `INSERT INTO staff_email_identities(id,staff_id,normalized_email,status,verified_at,last_login_at,created_at,updated_at,revoked_at)
      VALUES('owner-email-identity-0001','zz-phase3h-test-owner','owner@example.test','ACTIVE',NULL,NULL,1,1,NULL)`,
      )
      .run();
    const fixture = await jwtFixture(
      'https://team-bootstrap.cloudflareaccess.com',
      'audience-bootstrap-001',
      'OWNER@EXAMPLE.TEST',
    );
    mockJwks(fixture.jwk);
    const env = {
      DB: database,
      STAFF_ACCESS_TEAM_DOMAIN: fixture.issuer,
      STAFF_ACCESS_AUD: fixture.audience,
      STAFF_AUTH_ALLOWED_ORIGINS: 'https://app.example.test',
    };
    const response = await app.request(
      'https://app.example.test/api/staff-auth/access/bootstrap',
      {
        method: 'POST',
        headers: { Origin: 'https://app.example.test', 'Cf-Access-Jwt-Assertion': fixture.token },
      },
      env,
    );
    expect(response.status).toBe(200);
    const sessionCookies = response.headers
      .getSetCookie()
      .filter((value) => value.startsWith('__Host-ygb_staff_session='));
    expect(sessionCookies).toHaveLength(1);
    const cookie = sessionCookies[0];
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(
      await database
        .prepare(
          "SELECT status,staff_id FROM staff_sessions WHERE staff_id='zz-phase3h-test-owner'",
        )
        .first(),
    ).toEqual({ status: 'ACTIVE', staff_id: 'zz-phase3h-test-owner' });
    expect(
      await database
        .prepare(
          "SELECT verified_at,last_login_at FROM staff_email_identities WHERE id='owner-email-identity-0001'",
        )
        .first(),
    ).toMatchObject({ verified_at: expect.any(Number), last_login_at: expect.any(Number) });

    const unknown = await jwtFixture(
      'https://team-unknown.cloudflareaccess.com',
      'audience-unknown-001',
      'unknown@example.test',
    );
    mockJwks(unknown.jwk);
    const denied = await app.request(
      'https://app.example.test/api/staff-auth/access/bootstrap',
      {
        method: 'POST',
        headers: { Origin: 'https://app.example.test', 'Cf-Access-Jwt-Assertion': unknown.token },
      },
      { ...env, STAFF_ACCESS_TEAM_DOMAIN: unknown.issuer, STAFF_ACCESS_AUD: unknown.audience },
    );
    expect(denied.status).toBe(401);
    expect(await denied.text()).not.toContain('unknown@example.test');
  });

  it('rejects a foreign Origin before Staff session side effects', async () => {
    database = createMigratedTestDatabase();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const response = await app.request(
      'https://app.example.test/api/staff-auth/access/bootstrap',
      {
        method: 'POST',
        headers: { Origin: 'https://attacker.example.test' },
      },
      {
        DB: database,
        STAFF_ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.com',
        STAFF_ACCESS_AUD: 'audience-staff-foreign-origin',
        STAFF_AUTH_ALLOWED_ORIGINS: 'https://app.example.test',
      },
    );
    expect(response.status).toBe(403);
    expect(await database.prepare('SELECT COUNT(*) AS count FROM staff_sessions').first()).toEqual({
      count: 0,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

function request(token: string) {
  return new Request('https://app.example.test', { headers: { 'Cf-Access-Jwt-Assertion': token } });
}
function mockJwks(jwk: JsonWebKey) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(
      new Response(JSON.stringify({ keys: [jwk] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
}
async function jwtFixture(issuer: string, audience: string, email: string) {
  const now = Date.now();
  const nowSeconds = Math.floor(now / 1000);
  const kid = crypto.randomUUID();
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
  const jwk = {
    ...(await crypto.subtle.exportKey('jwk', pair.publicKey)),
    kid,
    alg: 'RS256',
    use: 'sig',
  };
  const header = encode({ alg: 'RS256', kid, typ: 'JWT' });
  const payload = encode({
    iss: issuer,
    aud: [audience],
    email,
    sub: 'access-subject',
    iat: nowSeconds - 10,
    nbf: nowSeconds - 10,
    exp: nowSeconds + 300,
  });
  const data = new TextEncoder().encode(`${header}.${payload}`);
  const signature = new Uint8Array(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, data),
  );
  return { issuer, audience, now, jwk, token: `${header}.${payload}.${base64url(signature)}` };
}
function encode(value: unknown) {
  return base64url(new TextEncoder().encode(JSON.stringify(value)));
}
function base64url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}
