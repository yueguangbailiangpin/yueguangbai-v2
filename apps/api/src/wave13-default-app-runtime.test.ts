import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  SqlAllResult,
  SqlDatabase,
  SqlRunResult,
  SqlStatement,
} from '@ygb/contracts';
import {
  createMigratedTestDatabase,
  type SqliteDatabase,
} from '@ygb/testkit';
import app from './index';
import { MockObjectStorage } from './files/mock-object-storage';
import {
  loginThroughDefaultApp,
  onePixelPng,
  runtimeBindings,
  seedWave13RuntimeAuthority,
  Wave13RuntimeDatabase,
  type RuntimeStaff,
} from '../test-support/wave13-runtime';

let base: SqliteDatabase | null = null;
let database: SqlDatabase | null = null;
let storage: MockObjectStorage | null = null;

beforeEach(() => {
  base = createMigratedTestDatabase();
  seedWave13RuntimeAuthority(base);
  seedLegacyScopedFile(base);
  database = new FileAuthorityDatabase(new Wave13RuntimeDatabase(base));
  storage = new MockObjectStorage();
});

afterEach(() => {
  base?.close();
  base = null;
  database = null;
  storage = null;
});

describe('Wave 13 default application runtime boundary', () => {
  it('uses Fake Feishu login, internal Cookie, middleware and all Staff route families', async () => {
    const owner = await login('owner');
    expect((await request(owner, '/api/staff/me/work-items/runtime-work-item')).status)
      .toBe(200);

    const catalog = await request(owner, '/api/staff/catalog/products', {
      method: 'POST',
      headers: jsonHeaders(owner.cookie, 'runtime-catalog-create'),
      body: JSON.stringify({
        store_id: 'runtime-store',
        asin: 'B0RT000001',
        version: {
          product_name: 'Runtime Product',
          search_keywords: ['runtime'],
          product_url: null,
          buyer_visible_notes: null,
          internal_notes: null,
          ordering_guide_expected_amount_jpy: 1980,
          color_spec_mode: 'MAIN_IMAGE_VARIANT',
          default_buyer_self_pay_bps: 0,
        },
      }),
    });
    expect(catalog.status).toBe(201);
    expect((await request(owner, '/api/staff/reviews/runtime-review')).status)
      .toBe(200);
    expect((await request(
      owner,
      '/api/staff/seller-settlements/runtime-org/summary',
    )).status).toBe(200);

    const proof = await createSellerSettlementProof(owner);
    expect([
      proof.intentStatus,
      proof.uploadStatus,
      proof.completeStatus,
      proof.paymentStatus,
    ]).toEqual([200, 200, 200, 201]);
    const proofRead = await request(
      owner,
      `/api/staff/seller-payments/${proof.paymentId}/proof/read-intent`,
      {
        method: 'POST',
        headers: jsonHeaders(owner.cookie, 'runtime-proof-read'),
        body: JSON.stringify({ expected_file_version: proof.fileVersion }),
      },
    );
    expect(proofRead.status).toBe(201);
    expect((await request(owner, '/api/staff/finance/summary')).status).toBe(200);
    expect((await request(
      owner,
      '/api/staff/order-evidence/runtime-evidence',
    )).status).toBe(200);
    expect((await request(
      owner,
      '/api/staff/buyer-refunds/runtime-refund',
    )).status).toBe(200);
  });

  it('returns 401 without a Cookie and ignores client authority headers', async () => {
    for (const input of representativeRequests(null, null)) {
      const response = await app.request(input.request, undefined, input.env);
      expect(response.status, input.family).toBe(401);
    }
    const bypass = await app.request(
      'https://api.example.test/api/staff/finance/summary',
      {
        headers: {
          'X-Staff-Id': 'zz-phase3h-test-owner',
          'X-Staff-Roles': 'owner',
          'X-Staff-Permissions': 'FINANCIAL_VIEW',
        },
      },
      runtimeBindings(database!, 'owner', storage!),
    );
    expect(bypass.status).toBe(401);
  });

  it('returns 403 when the trusted Session lacks the route permission', async () => {
    const owner = await login('owner');
    const proof = await createSellerSettlementProof(owner);
    const limited = await login('limited');
    for (const input of permissionRequests(limited, proof.paymentId)) {
      const response = await app.request(input.request, undefined, limited.env);
      expect(response.status, input.family).toBe(403);
    }
  });

  it('conceals out-of-scope resources with 404; Internal Finance remains owner-global', async () => {
    const owner = await login('owner');
    const proof = await createSellerSettlementProof(owner);
    const scoped = await login('scoped');
    for (const input of scopeRequests(scoped, proof)) {
      const response = await app.request(input.request, undefined, scoped.env);
      expect(response.status, input.family).toBe(input.expected);
    }
  });
});

async function login(staff: RuntimeStaff) {
  return loginThroughDefaultApp(database!, staff, storage!);
}

async function request(
  identity: Awaited<ReturnType<typeof login>>,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has('Cookie')) headers.set('Cookie', identity.cookie);
  return app.request(`https://api.example.test${path}`, {
    ...init,
    headers,
  }, identity.env);
}

function jsonHeaders(cookie: string, idempotencyKey: string): HeadersInit {
  return {
    Cookie: cookie,
    'Content-Type': 'application/json',
    'Idempotency-Key': idempotencyKey,
  };
}

async function createSellerSettlementProof(
  owner: Awaited<ReturnType<typeof login>>,
): Promise<{
  intentStatus: number;
  uploadStatus: number;
  completeStatus: number;
  paymentStatus: number;
  fileObjectId: string;
  fileVersion: number;
  paymentId: string;
}> {
  const png = onePixelPng();
  const intent = await request(
    owner,
    '/api/staff/file-uploads/seller-settlement-proofs/intents',
    {
      method: 'POST',
      headers: jsonHeaders(owner.cookie, 'runtime-proof-intent'),
      body: JSON.stringify({
        files: [{
          client_file_name: 'runtime-proof.png',
          extension: 'png',
          declared_mime: 'image/png',
          byte_size: png.byteLength,
        }],
      }),
    },
  );
  const intentBody = await intent.json() as {
    data: {
      upload_intent_id: string;
      uploads: readonly [{ file_object_id: string; upload_token: string }];
    };
  };
  const fileObjectId = intentBody.data.uploads[0].file_object_id;
  const uploadToken = intentBody.data.uploads[0].upload_token;
  const form = new FormData();
  form.set('file', new File([png], 'runtime-proof.png', { type: 'image/png' }));
  const upload = await request(
    owner,
    `/api/staff/file-uploads/${fileObjectId}/content`,
    {
      method: 'PUT',
      headers: {
        Cookie: owner.cookie,
        'Idempotency-Key': 'runtime-proof-upload',
        'X-Upload-Token': uploadToken,
      },
      body: form,
    },
  );
  const complete = await request(
    owner,
    `/api/staff/file-upload-intents/${intentBody.data.upload_intent_id}/complete`,
    {
      method: 'POST',
      headers: jsonHeaders(owner.cookie, 'runtime-proof-complete'),
      body: JSON.stringify({ expected_version: 1 }),
    },
  );
  const completeBody = await complete.json() as {
    data: { files: readonly [{ version: number }] };
  };
  const fileVersion = completeBody.data.files[0].version;
  const payment = await request(
    owner,
    '/api/staff/seller-settlements/runtime-org/payments',
    {
      method: 'POST',
      headers: jsonHeaders(owner.cookie, 'runtime-seller-payment'),
      body: JSON.stringify({
        amount_cny_fen: '1000',
        paid_at: Date.now(),
        proof_file: {
          file_object_id: fileObjectId,
          expected_file_version: fileVersion,
        },
      }),
    },
  );
  const paymentBody = await payment.json() as {
    data: { payment: { payment_id: string } };
  };
  return {
    intentStatus: intent.status,
    uploadStatus: upload.status,
    completeStatus: complete.status,
    paymentStatus: payment.status,
    fileObjectId,
    fileVersion,
    paymentId: paymentBody.data.payment.payment_id,
  };
}

function representativeRequests(
  cookie: string | null,
  paymentId: string | null,
): readonly { family: string; request: Request; env: Record<string, unknown> }[] {
  const env = runtimeBindings(database!, 'owner', storage!);
  const headers = cookie ? { Cookie: cookie } : {};
  const id = paymentId ?? 'missing-payment';
  return [
    ['Assignment', '/api/staff/assignment-fallbacks/JP', 'GET'],
    ['Catalog', '/api/staff/catalog/products', 'POST'],
    ['Review', '/api/staff/reviews/runtime-review', 'GET'],
    ['Seller Settlement', '/api/staff/seller-settlements/runtime-org/summary', 'GET'],
    ['Settlement Proof', `/api/staff/seller-payments/${id}/proof/read-intent`, 'POST'],
    ['Internal Finance', '/api/staff/finance/summary', 'GET'],
    ['Staff File', '/api/staff/file-uploads/buyer-refund-proofs/intents', 'POST'],
    ['Order Evidence', '/api/staff/order-evidence/runtime-evidence', 'GET'],
    ['Buyer Refund', '/api/staff/buyer-refunds/runtime-refund', 'GET'],
  ].map(([family, path, method]) => ({
    family,
    request: new Request(`https://api.example.test${path}`, { method, headers }),
    env,
  }));
}

function permissionRequests(
  identity: Awaited<ReturnType<typeof login>>,
  paymentId: string,
) {
  const json = (key: string, body: unknown) => ({
    method: 'POST',
    headers: jsonHeaders(identity.cookie, key),
    body: JSON.stringify(body),
  });
  return [
    { family: 'Assignment', request: new Request(
      'https://api.example.test/api/staff/assignment-fallbacks/JP',
      { headers: { Cookie: identity.cookie } },
    ) },
    { family: 'Catalog', request: new Request(
      'https://api.example.test/api/staff/catalog/products', json('limited-catalog', {}),
    ) },
    { family: 'Review', request: new Request(
      'https://api.example.test/api/staff/reviews/runtime-review',
      { headers: { Cookie: identity.cookie } },
    ) },
    { family: 'Seller Settlement', request: new Request(
      'https://api.example.test/api/staff/seller-settlements/runtime-org/summary',
      { headers: { Cookie: identity.cookie } },
    ) },
    { family: 'Settlement Proof', request: new Request(
      `https://api.example.test/api/staff/seller-payments/${paymentId}/proof/read-intent`,
      json('limited-proof', { expected_file_version: 3 }),
    ) },
    { family: 'Internal Finance', request: new Request(
      'https://api.example.test/api/staff/finance/summary',
      { headers: { Cookie: identity.cookie } },
    ) },
    { family: 'Staff File', request: new Request(
      'https://api.example.test/api/staff/files/runtime-legacy-file/read-intents',
      json('limited-file-read', { expected_file_version: 3 }),
    ) },
    { family: 'Order Evidence', request: new Request(
      'https://api.example.test/api/staff/order-evidence/runtime-evidence',
      { headers: { Cookie: identity.cookie } },
    ) },
    { family: 'Buyer Refund', request: new Request(
      'https://api.example.test/api/staff/buyer-refunds/runtime-refund',
      { headers: { Cookie: identity.cookie } },
    ) },
  ];
}

function scopeRequests(
  identity: Awaited<ReturnType<typeof login>>,
  proof: Awaited<ReturnType<typeof createSellerSettlementProof>>,
) {
  const json = (key: string, body: unknown) => ({
    method: 'POST',
    headers: jsonHeaders(identity.cookie, key),
    body: JSON.stringify(body),
  });
  return [
    { family: 'Assignment', expected: 404, request: new Request(
      'https://api.example.test/api/staff/me/work-items/runtime-work-item',
      { headers: { Cookie: identity.cookie } },
    ) },
    { family: 'Catalog', expected: 404, request: new Request(
      'https://api.example.test/api/staff/catalog/products',
      json('scoped-catalog', {
        store_id: 'runtime-store',
        asin: 'B0RT000002',
        version: {
          product_name: 'Scoped Product', search_keywords: [],
          product_url: null, buyer_visible_notes: null, internal_notes: null,
          ordering_guide_expected_amount_jpy: 1980,
          color_spec_mode: 'MAIN_IMAGE_VARIANT',
        },
      }),
    ) },
    { family: 'Review', expected: 404, request: new Request(
      'https://api.example.test/api/staff/reviews/runtime-review',
      { headers: { Cookie: identity.cookie } },
    ) },
    { family: 'Seller Settlement', expected: 404, request: new Request(
      'https://api.example.test/api/staff/seller-settlements/runtime-org/summary',
      { headers: { Cookie: identity.cookie } },
    ) },
    { family: 'Settlement Proof', expected: 404, request: new Request(
      `https://api.example.test/api/staff/seller-payments/${proof.paymentId}/proof/read-intent`,
      json('scoped-proof', { expected_file_version: proof.fileVersion }),
    ) },
    { family: 'Internal Finance', expected: 403, request: new Request(
      'https://api.example.test/api/staff/finance/summary',
      { headers: { Cookie: identity.cookie } },
    ) },
    { family: 'Staff File', expected: 404, request: new Request(
      'https://api.example.test/api/staff/files/runtime-legacy-file/read-intents',
      json('scoped-file-read', { expected_file_version: 3 }),
    ) },
    { family: 'Order Evidence', expected: 404, request: new Request(
      'https://api.example.test/api/staff/order-evidence/runtime-evidence',
      { headers: { Cookie: identity.cookie } },
    ) },
    { family: 'Buyer Refund', expected: 404, request: new Request(
      'https://api.example.test/api/staff/buyer-refunds/runtime-refund',
      { headers: { Cookie: identity.cookie } },
    ) },
  ];
}

function seedLegacyScopedFile(target: SqliteDatabase): void {
  target.exec(`
    INSERT INTO file_upload_intents (
      id, owner_actor_type, owner_actor_id, purpose, visibility,
      status, requested_file_count, manifest_hash, version,
      expires_at, failure_code, created_at, updated_at, completed_at
    ) VALUES (
      'runtime-legacy-intent','BUYER_CUSTOMER','runtime-buyer',
      'ORDER_EVIDENCE','BUYER_VISIBLE','VERIFIED',1,
      '${'a'.repeat(64)}',2,9999999999999,NULL,2,3,3
    );
    INSERT INTO file_objects (
      id, upload_intent_id, slot_no, purpose, visibility, object_key,
      client_file_name, extension, declared_mime, expected_byte_size,
      status, upload_token_hash, upload_expires_at,
      uploaded_byte_size, detected_mime, uploaded_sha256,
      failure_code, delete_attempt_count, next_delete_at, version,
      created_at, updated_at, uploaded_at, verified_at, deleted_at
    ) VALUES (
      'runtime-legacy-file','runtime-legacy-intent',1,
      'ORDER_EVIDENCE','BUYER_VISIBLE',
      'files/v1/order_evidence/2026/08/02/runtime_legacy_object_0001',
      'runtime-evidence.png','png','image/png',68,
      'VERIFIED','${'b'.repeat(64)}',9999999999999,
      68,'image/png','${'c'.repeat(64)}',NULL,0,NULL,3,
      2,3,3,3,NULL
    );
    INSERT INTO file_entity_links (
      id, file_object_id, entity_type, entity_id, purpose, visibility,
      linked_by_actor_type, linked_by_actor_id, created_at,
      authorization_mode, expires_at, revoked_at
    ) VALUES (
      'runtime-legacy-link','runtime-legacy-file','ORDER',
      'runtime-evidence-version','ORDER_EVIDENCE','BUYER_VISIBLE',
      'BUYER_CUSTOMER','runtime-buyer',3,'LEGACY_VISIBILITY',NULL,NULL
    );
  `);
}

class FileAuthorityDatabase implements SqlDatabase {
  constructor(private readonly target: SqlDatabase) {}
  prepare(sql: string): SqlStatement {
    const normalized = sql.replace(/\s+/gu, ' ').trim();
    if (normalized.includes('FROM formal_orders WHERE id=?')
      && normalized.includes('FROM order_evidence_versions version')) {
      return new FileAuthorityStatement([]);
    }
    return this.target.prepare(sql);
  }
  batch(statements: readonly SqlStatement[]): Promise<SqlRunResult[]> {
    return this.target.batch(statements);
  }
}

class FileAuthorityStatement implements SqlStatement {
  constructor(private readonly bindings: readonly unknown[]) {}
  bind(...values: unknown[]): SqlStatement {
    return new FileAuthorityStatement(values);
  }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    if (this.bindings.includes('runtime-evidence-version')) {
      return {
        buyer_customer_id: 'runtime-buyer',
        seller_organization_id: 'runtime-org',
      } as T;
    }
    return null;
  }
  async all<T = Record<string, unknown>>(): Promise<SqlAllResult<T>> {
    const first = await this.first<T>();
    return { results: first ? [first] : [] };
  }
  async run(): Promise<SqlRunResult> {
    throw new Error('wave13_file_authority_overlay_is_read_only');
  }
}
