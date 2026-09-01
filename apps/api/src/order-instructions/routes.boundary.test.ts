import { afterEach, describe, expect, it } from 'vitest';
import { STAFF_SESSION_COOKIE_NAME } from '@ygb/contracts';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import { createApp } from '../app';
import { staffSessionMiddleware } from '../middleware/staff-auth';
import { generateStaffOpaqueToken } from '../staff-auth/crypto';
import { createInternalStaffSession } from '../staff-auth/repository';
import { registerOrderInstructionRoutes } from './routes';

const ORIGIN = 'https://staff.local.test';

let database: SqliteDatabase | null = null;
let staffToken = '';

afterEach(() => {
  database?.close();
  database = null;
});

describe('order instruction strict write boundary', () => {
  it('enforces same-origin and exact bodies on every staff write route', async () => {
    database = createMigratedTestDatabase();
    staffToken = await seedOwnerSession();
    const app = testApp();
    const cases = [
      {
        path: '/api/staff/order-instructions/missing/publish',
        body: { expected_version: 1 },
        validStatus: 404,
      },
      {
        path: '/api/staff/order-instructions/missing/cancel',
        body: { expected_version: 1, reason: '测试取消' },
        validStatus: 404,
      },
      {
        path: '/api/staff/order-instructions/expiry-scan/run',
        body: {},
        validStatus: 200,
      },
      {
        path: '/api/staff/order-instructions/reconciliation/run',
        body: {},
        validStatus: 200,
      },
    ] as const;

    for (const [index, testCase] of cases.entries()) {
      const missingOrigin = await writeRequest(app, testCase.path, testCase.body, {
        'Idempotency-Key': `order-boundary-missing-${index}`,
      });
      expect(missingOrigin.status, testCase.path).toBe(403);

      const foreignOrigin = await writeRequest(app, testCase.path, testCase.body, {
        Origin: 'https://attacker.invalid',
        'Sec-Fetch-Site': 'cross-site',
        'Idempotency-Key': `order-boundary-foreign-${index}`,
      });
      expect(foreignOrigin.status, testCase.path).toBe(403);

      const extraBodyKey = await writeRequest(
        app,
        testCase.path,
        { ...testCase.body, unexpected: true },
        sameOriginHeaders(`order-boundary-extra-${index}`),
      );
      expect(extraBodyKey.status, testCase.path).toBe(400);

      const validSameOrigin = await writeRequest(
        app,
        testCase.path,
        testCase.body,
        sameOriginHeaders(`order-boundary-valid-${index}`),
      );
      expect(validSameOrigin.status, testCase.path).toBe(testCase.validStatus);
    }
  });
});

function testApp() {
  const app = createApp();
  app.use('/api/staff/*', staffSessionMiddleware());
  registerOrderInstructionRoutes(app);
  return app;
}

async function seedOwnerSession(): Promise<string> {
  if (!database) throw new Error('test_database_missing');
  database.exec(
    `INSERT INTO staff_users(id,display_name,status,authorization_version,version,created_at,updated_at,disabled_at,session_version) VALUES('order-boundary-owner','Order Boundary Owner','ACTIVE',1,1,1000,1000,NULL,1);INSERT INTO staff_role_assignments(staff_id,role_code,status,assigned_by_staff_id,assigned_at,revoked_at,created_at,updated_at) VALUES('order-boundary-owner','owner','ACTIVE',NULL,1000,NULL,1000,1000);`,
  );
  const token = generateStaffOpaqueToken(),
    now = Date.now();
  await createInternalStaffSession(database, {
    token,
    identity: {
      identity_id: 'order-boundary-identity',
      staff_id: 'order-boundary-owner',
      identity_status: 'ACTIVE',
      identity_user_id: null,
      display_name: 'Order Boundary Owner',
      staff_status: 'ACTIVE',
      authorization_version: 1,
      session_version: 1,
    },
    requestId: 'order-boundary-session',
    now,
    expiresAt: now + 60_000,
  });
  return token;
}

function sameOriginHeaders(idempotencyKey: string): Record<string, string> {
  return {
    Origin: ORIGIN,
    'Sec-Fetch-Site': 'same-origin',
    'Idempotency-Key': idempotencyKey,
  };
}

async function writeRequest(
  app: ReturnType<typeof testApp>,
  path: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<Response> {
  if (!database) throw new Error('test_database_missing');
  return app.request(
    `${ORIGIN}${path}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${STAFF_SESSION_COOKIE_NAME}=${staffToken}`,
        ...headers,
      },
      body: JSON.stringify(body),
    },
    {
      DB: database,
    } as any,
  );
}
