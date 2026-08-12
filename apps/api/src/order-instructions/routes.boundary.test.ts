import { afterEach, describe, expect, it } from 'vitest';
import {
  createMigratedTestDatabase,
  type SqliteDatabase,
} from '@ygb/testkit';
import { createApp } from '../app';
import { calculateEffectiveStaffAuthorization } from '../staff/authorization-policy';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { registerOrderInstructionRoutes } from './routes';

const ORIGIN = 'https://staff.local.test';

let database: SqliteDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe('order instruction strict write boundary', () => {
  it('enforces same-origin and exact bodies on every staff write route', async () => {
    database = createMigratedTestDatabase();
    const app = testApp(owner());
    const cases = [
      {
        path: '/api/staff/order-instructions/missing/assets/prepare',
        body: { expected_version: 1 },
        validStatus: 503,
      },
      {
        path: '/api/staff/order-instructions/missing/publish',
        body: { asset_batch_id: 'missing-batch', expected_version: 1 },
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
        path: '/api/staff/order-instructions/assets/reconciliation/run',
        body: {},
        validStatus: 503,
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

function testApp(actor: AssignmentStaffAuthorization) {
  const app = createApp();
  app.use('*', async (context, next) => {
    context.set('staffAuthorization', actor);
    await next();
  });
  registerOrderInstructionRoutes(app);
  return app;
}

function owner(): AssignmentStaffAuthorization {
  const effective = calculateEffectiveStaffAuthorization({
    roles: new Set(['owner']),
    grants: new Set(),
    denies: new Set(),
    memberTeamIds: [],
    leaderTeamIds: [],
  });
  return {
    staffId: 'order-boundary-owner',
    displayName: 'Order Boundary Owner',
    staffStatus: 'ACTIVE',
    authorizationVersion: 1,
    ...effective,
  };
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
  return app.request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  }, {
    DB: database,
  } as any);
}
