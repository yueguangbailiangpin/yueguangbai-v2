import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createMigratedTestDatabase,
  type SqliteDatabase,
} from '@ygb/testkit';
import app from './index';
import { MockObjectStorage } from './files/mock-object-storage';
import {
  loginThroughDefaultApp,
  onePixelPng,
  seedWave13RuntimeAuthority,
  Wave13RuntimeDatabase,
} from '../test-support/wave13-runtime';

let base: SqliteDatabase | null = null;
let database: Wave13RuntimeDatabase | null = null;
let storage: MockObjectStorage | null = null;

beforeEach(() => {
  base = createMigratedTestDatabase();
  seedWave13RuntimeAuthority(base);
  database = new Wave13RuntimeDatabase(base);
  storage = new MockObjectStorage();
});

afterEach(() => {
  base?.close();
  base = null;
  database = null;
  storage = null;
});

describe('Wave 13 recursive DTO runtime isolation', () => {
  it('walks actual Default App response objects instead of source strings', async () => {
    const identity = await loginThroughDefaultApp(
      database!,
      'owner',
      storage!,
    );
    const businessResponses = await Promise.all([
      getJson(identity, '/api/staff-auth/session'),
      getJson(identity, '/api/staff/me/work-items/runtime-work-item'),
      getJson(identity, '/api/staff/reviews/runtime-review'),
      getJson(identity, '/api/staff/seller-settlements/runtime-org/summary'),
      getJson(identity, '/api/staff/finance/summary?date_basis=CONFIRMED'),
      getJson(identity, '/api/staff/order-evidence/runtime-evidence'),
      getJson(identity, '/api/staff/buyer-refunds/runtime-refund'),
    ]);
    for (const value of businessResponses) {
      assertRecursiveDto(value, {
        forbiddenKeys: [
          'object_key', 'token_hash', 'state_hash', 'access_token',
          'upload_token', 'app_secret', 'client_secret', 'provider_token',
          'feishu_access_token', 'network_source_hash', 'origin_hash',
          'password_hash', 'salt_base64url', 'hash_base64url',
        ],
        forbiddenValues: [
          'test-only-runtime-secret',
          'wave13-runtime-hash-secret-at-least-thirty-two-characters',
        ],
      });
    }

    const png = onePixelPng();
    const intent = await app.request(
      'https://api.example.test/api/staff/file-uploads/buyer-refund-proofs/intents',
      {
        method: 'POST',
        headers: {
          Cookie: identity.cookie,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'recursive-dto-file-intent',
        },
        body: JSON.stringify({
          files: [{
            client_file_name: 'recursive-proof.png',
            extension: 'png',
            declared_mime: 'image/png',
            byte_size: png.byteLength,
          }],
        }),
      },
      identity.env,
    );
    expect(intent.status).toBe(200);
    const fileDto = await intent.json();
    assertRecursiveDto(fileDto, {
      forbiddenKeys: [
        'object_key', 'permanent_url', 'signed_url', 'owner_actor_id',
        'staff_id', 'buyer_customer_id', 'seller_organization_id',
        'token_hash', 'state_hash', 'app_secret', 'client_secret',
      ],
      forbiddenValues: [
        'test-only-runtime-secret',
        'wave13-runtime-hash-secret-at-least-thirty-two-characters',
      ],
      allowedSecretPaths: [
        /^data\.uploads\.\d+\.upload_token$/u,
      ],
    });
  });
});

async function getJson(
  identity: Awaited<ReturnType<typeof loginThroughDefaultApp>>,
  path: string,
): Promise<unknown> {
  const response = await app.request(
    `https://api.example.test${path}`,
    { headers: { Cookie: identity.cookie } },
    identity.env,
  );
  expect(response.status, path).toBe(200);
  return response.json();
}

function assertRecursiveDto(
  value: unknown,
  options: {
    forbiddenKeys: readonly string[];
    forbiddenValues: readonly string[];
    allowedSecretPaths?: readonly RegExp[];
  },
): void {
  const forbidden = new Set(options.forbiddenKeys);
  const visit = (current: unknown, path: string): void => {
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}.${index}`));
      return;
    }
    if (current && typeof current === 'object') {
      for (const [key, nested] of Object.entries(
        current as Record<string, unknown>,
      )) {
        const nextPath = path ? `${path}.${key}` : key;
        const allowed = options.allowedSecretPaths?.some(
          (pattern) => pattern.test(nextPath),
        ) ?? false;
        if (!allowed) expect(forbidden.has(key), nextPath).toBe(false);
        visit(nested, nextPath);
      }
      return;
    }
    if (typeof current === 'string') {
      for (const secret of options.forbiddenValues) {
        expect(current.includes(secret), path).toBe(false);
      }
    }
  };
  visit(value, '');
}
