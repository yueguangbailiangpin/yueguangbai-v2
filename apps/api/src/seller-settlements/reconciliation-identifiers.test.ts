import { describe, expect, it } from 'vitest';
import type {
  SqlDatabase,
  SqlRunResult,
  SqlStatement,
} from '@ygb/contracts';
import { reconcileSellerPayables } from './reconciliation';

interface Candidate {
  entity_key: string;
  entity_type: 'FORMAL_ORDER' | 'REVIEW_CASE';
  entity_id: string;
  formal_order_id: string;
  seller_organization_id: string;
  financial_snapshot_id: string | null;
  snapshot_count: number;
  approval_count: number;
  approval_at: number | null;
  amount_cny_fen: number | null;
  existing_payable_id: string | null;
  organization_consistent: number;
}

interface CapturedStatement {
  sql: string;
  bindings: readonly unknown[];
}

function ownerActor() {
  return {
    staffId: 'owner-1',
    displayName: 'Owner',
    staffStatus: 'ACTIVE' as const,
    authorizationVersion: 1,
    roles: new Set(['owner'] as const),
    permissions: new Set([
      'SELLER_SETTLEMENT_VIEW',
      'SELLER_SETTLEMENT_RECORD',
      'FINANCIAL_CORRECT',
    ] as const),
    deniedPermissions: new Set(),
    memberTeamIds: [] as string[],
    leaderTeamIds: [] as string[],
    isOwner: true,
  };
}

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  const formalOrderId = 'F'.repeat(200);
  return {
    entity_key: `FORMAL_ORDER:${formalOrderId}`,
    entity_type: 'FORMAL_ORDER',
    entity_id: formalOrderId,
    formal_order_id: formalOrderId,
    seller_organization_id: 'seller-1',
    financial_snapshot_id: 'snapshot-1',
    snapshot_count: 1,
    approval_count: 0,
    approval_at: null,
    amount_cny_fen: 12345,
    existing_payable_id: null,
    organization_consistent: 1,
    ...overrides,
  };
}

describe('seller payable reconciliation opaque ids', () => {
  it('handles a 200-character Formal Order id with UUID primary keys', async () => {
    const database = fakeDatabase({ candidates: [candidate()] });
    const result = await reconcileSellerPayables(database, {
      sellerOrganizationId: 'seller-1',
      limit: 10,
    }, {
      actor: ownerActor() as never,
      idempotencyKey: 'reconcile-max-formal-order',
      now: 1000,
    });
    expect(result).toMatchObject({
      scanned_count: 1,
      created_count: 1,
      conflict_count: 0,
      replayed: false,
    });
    const payable = database.captured.find((entry) =>
      entry.sql.includes('INSERT OR IGNORE INTO seller_payables'));
    const event = database.captured.find((entry) =>
      entry.sql.includes('INSERT OR IGNORE INTO seller_payable_events'));
    expect(String(payable?.bindings[0])).toMatch(UUID_PATTERN);
    expect(String(event?.bindings[0])).toMatch(UUID_PATTERN);
    expect(payable?.bindings).toContain('F'.repeat(200));
    expect(String(payable?.bindings[0])).not.toContain('F'.repeat(20));
  });

  it('handles a 200-character Review Case conflict with a UUID conflict id', async () => {
    const reviewCaseId = 'R'.repeat(200);
    const database = fakeDatabase({ candidates: [candidate({
      entity_key: `REVIEW_CASE:${reviewCaseId}`,
      entity_type: 'REVIEW_CASE',
      entity_id: reviewCaseId,
      snapshot_count: 0,
      financial_snapshot_id: null,
      approval_count: 1,
      approval_at: 900,
      amount_cny_fen: null,
    })] });
    const result = await reconcileSellerPayables(database, {
      sellerOrganizationId: 'seller-1',
      limit: 10,
    }, {
      actor: ownerActor() as never,
      idempotencyKey: 'reconcile-max-review-case',
      now: 1000,
    });
    expect(result).toMatchObject({
      scanned_count: 1,
      created_count: 0,
      conflict_count: 1,
    });
    const conflict = database.captured.find((entry) =>
      entry.sql.includes('seller_payable_reconciliation_conflicts'));
    expect(String(conflict?.bindings[0])).toMatch(UUID_PATTERN);
    expect(conflict?.bindings).toContain(reviewCaseId);
  });

  it('accepts an existing 200-character Payable id without deriving new ids', async () => {
    const database = fakeDatabase({ candidates: [candidate({
      existing_payable_id: 'P'.repeat(200),
    })] });
    const result = await reconcileSellerPayables(database, {
      sellerOrganizationId: 'seller-1',
      limit: 10,
    }, {
      actor: ownerActor() as never,
      idempotencyKey: 'reconcile-max-payable',
      now: 1000,
    });
    expect(result).toMatchObject({
      scanned_count: 1,
      created_count: 0,
      conflict_count: 0,
    });
    expect(database.captured.some((entry) =>
      entry.sql.includes('INSERT OR IGNORE INTO seller_payables'))).toBe(false);
  });

  it('replays the same idempotency record without preparing duplicate facts', async () => {
    const replay = {
      scanned_count: 1,
      created_count: 1,
      conflict_count: 0,
      next_cursor: null,
      replayed: false,
    };
    const database = fakeDatabase({
      candidates: [candidate()],
      replayResponse: replay,
    });
    const result = await reconcileSellerPayables(database, {
      sellerOrganizationId: 'seller-1',
      limit: 10,
    }, {
      actor: ownerActor() as never,
      idempotencyKey: 'reconcile-idempotent-replay',
      now: 1000,
    });
    expect(result).toEqual({ ...replay, replayed: true });
    expect(database.batchCalls).toBe(0);
    expect(database.captured.some((entry) =>
      entry.sql.includes('INSERT OR IGNORE INTO seller_payables'))).toBe(false);
  });
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function fakeDatabase(options: {
  candidates: readonly Candidate[];
  replayResponse?: unknown;
}): SqlDatabase & {
  captured: CapturedStatement[];
  batchCalls: number;
} {
  const captured: CapturedStatement[] = [];
  let requestHash = '';
  const database = {
    captured,
    batchCalls: 0,
    prepare(sql: string): SqlStatement {
      let bindings: readonly unknown[] = [];
      const statement: SqlStatement = {
        bind(...values: unknown[]): SqlStatement {
          bindings = values;
          captured.push({ sql, bindings });
          if (sql.includes('INSERT OR IGNORE INTO command_idempotency_records')) {
            requestHash = String(values[6] ?? '');
          }
          return statement;
        },
        async first<T>(): Promise<T | null> {
          if (sql.includes('FROM command_idempotency_records')) {
            return options.replayResponse === undefined
              ? null
              : {
                  action: 'RECONCILE_SELLER_PAYABLES',
                  target_type: 'SELLER_ORGANIZATION',
                  target_id: 'seller-1',
                  request_hash: requestHash,
                  status: 'COMMITTED',
                  lease_expires_at: 0,
                  response_json: JSON.stringify(options.replayResponse),
                } as T;
          }
          if (sql.includes('SELECT confirmed_at FROM formal_orders')) {
            return { confirmed_at: 900 } as T;
          }
          return null;
        },
        async all<T>(): Promise<{ results: T[] }> {
          if (sql.includes("'FORMAL_ORDER:' || formal_order.id")) {
            return { results: [...options.candidates] as T[] };
          }
          return { results: [] };
        },
        async run(): Promise<SqlRunResult> {
          return {
            meta: { changes: options.replayResponse === undefined ? 1 : 0 },
          };
        },
      };
      return statement;
    },
    async batch(statements: readonly SqlStatement[]): Promise<SqlRunResult[]> {
      database.batchCalls += 1;
      return statements.map(() => ({ meta: { changes: 1 } }));
    },
  };
  return database;
}