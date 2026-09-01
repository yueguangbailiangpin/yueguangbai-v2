import type {
  BuyerMarketplaceCorrectionResult,
  MarketplaceCode,
  SqlDatabase,
  SqlStatement,
  StaffPermissionCode,
  StaffRoleCode,
} from '@ygb/contracts';
import { hashCanonicalJson } from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  markIdempotencyFailed,
} from '../foundation/idempotency';
import { resolveMarketplace } from './registry';

export interface BuyerMarketplaceCorrectionActor {
  staffId: string;
  roles: readonly StaffRoleCode[];
  permissions: ReadonlySet<StaffPermissionCode>;
}

export class BuyerMarketplaceCorrectionError extends Error {
  constructor(
    public readonly code:
      | 'VALIDATION_ERROR'
      | 'FORBIDDEN'
      | 'NOT_FOUND'
      | 'VERSION_CONFLICT'
      | 'STATE_CONFLICT'
      | 'IDEMPOTENCY_CONFLICT'
      | 'REQUEST_IN_PROGRESS'
      | 'DEPENDENCY_UNAVAILABLE',
    public readonly status: 400 | 403 | 404 | 409 | 503,
  ) {
    super(code);
    this.name = 'BuyerMarketplaceCorrectionError';
  }
}

interface BuyerMarketplaceRow {
  buyer_customer_id: string;
  marketplace_code: 'AMAZON_JP' | 'AMAZON_US' | 'COUPANG_KR';
  version: number;
}

export async function correctBuyerMarketplace(
  database: SqlDatabase,
  input: {
    buyerCustomerId: string;
    marketplaceCode: MarketplaceCode;
    expectedVersion: number;
    reason: string;
  },
  command: {
    actor: BuyerMarketplaceCorrectionActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<BuyerMarketplaceCorrectionResult> {
  requireOwner(command.actor);
  const buyerId = cleanText(input.buyerCustomerId, 120);
  const reason = cleanText(input.reason, 1000);
  if (!Number.isSafeInteger(input.expectedVersion)
    || input.expectedVersion < 1) {
    throw new BuyerMarketplaceCorrectionError('VALIDATION_ERROR', 400);
  }
  const now = command.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new BuyerMarketplaceCorrectionError('VALIDATION_ERROR', 400);
  }
  const marketplace = await resolveCorrectionTarget(
    database,
    input.marketplaceCode,
  );

  const requestHash = await hashCanonicalJson({
    action: 'CORRECT_BUYER_MARKETPLACE',
    buyer_customer_id: buyerId,
    marketplace_code: marketplace.code,
    expected_version: input.expectedVersion,
    reason,
  });
  const acquired = await acquireIdempotency<BuyerMarketplaceCorrectionResult>(
    database,
    {
      actorType: 'STAFF',
      actorId: command.actor.staffId,
      action: 'CORRECT_BUYER_MARKETPLACE',
      targetType: 'BUYER_CUSTOMER',
      targetId: buyerId,
      idempotencyKey: command.idempotencyKey,
      requestHash,
    },
    { now },
  );
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }

  try {
    const current = await database.prepare(`
      SELECT buyer_customer_id, marketplace_code, version
      FROM buyer_marketplace_assignments
      WHERE buyer_customer_id=?
    `).bind(buyerId).first<BuyerMarketplaceRow>();
    if (!current) throw new BuyerMarketplaceCorrectionError('NOT_FOUND', 404);
    if (current.version !== input.expectedVersion) {
      throw new BuyerMarketplaceCorrectionError('VERSION_CONFLICT', 409);
    }
    if (current.marketplace_code === marketplace.code) {
      throw new BuyerMarketplaceCorrectionError('VALIDATION_ERROR', 400);
    }
    if (await hasFormalFacts(database, buyerId)) {
      throw new BuyerMarketplaceCorrectionError('STATE_CONFLICT', 409);
    }

    const response: BuyerMarketplaceCorrectionResult = {
      buyer_customer_id: buyerId,
      previous_marketplace_code: current.marketplace_code,
      marketplace_code: marketplace.code,
      version: current.version + 1,
      corrected_at: now,
      replayed: false,
    };
    const statements: SqlStatement[] = [
      database.prepare(`
        UPDATE buyer_marketplace_assignments
        SET marketplace_code=?, version=version+1, updated_at=?
        WHERE buyer_customer_id=? AND version=?
          AND NOT EXISTS (
            SELECT 1 FROM product_reservations WHERE buyer_customer_id=?
          )
          AND NOT EXISTS (
            SELECT 1 FROM order_evidence_submissions WHERE buyer_customer_id=?
          )
          AND NOT EXISTS (
            SELECT 1 FROM formal_orders WHERE buyer_customer_id=?
          )
          AND NOT EXISTS (
            SELECT 1 FROM review_cases WHERE buyer_customer_id=?
          )
          AND NOT EXISTS (
            SELECT 1 FROM formal_order_financial_snapshots
            WHERE buyer_customer_id=?
          )
      `).bind(
        marketplace.code,
        now,
        buyerId,
        current.version,
        buyerId,
        buyerId,
        buyerId,
        buyerId,
        buyerId,
      ),
      database.prepare(`
        INSERT INTO buyer_marketplace_correction_events (
          id, buyer_customer_id, previous_marketplace_code,
          next_marketplace_code, previous_version, next_version,
          actor_staff_id, reason, idempotency_key, created_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE changes()=1
      `).bind(
        crypto.randomUUID(), buyerId, current.marketplace_code,
        marketplace.code, current.version, response.version,
        command.actor.staffId, reason, acquired.claim.idempotencyKey, now,
      ),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'BUYER_CUSTOMER',
        aggregateId: buyerId,
        eventType: 'BUYER_MARKETPLACE_CORRECTED',
        actor: {
          type: 'STAFF', id: command.actor.staffId,
          roles: command.actor.roles,
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: {
          marketplace_code: current.marketplace_code,
          version: current.version,
        },
        nextState: {
          marketplace_code: marketplace.code,
          version: response.version,
          reason,
        },
        createdAt: now,
      }),
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: { buyer_customer_id: buyerId }, now,
      }),
      database.prepare(`
        INSERT INTO transaction_assertions (assertion_value)
        SELECT CASE WHEN
          EXISTS (
            SELECT 1 FROM buyer_marketplace_assignments
            WHERE buyer_customer_id=? AND marketplace_code=? AND version=?
          )
          AND EXISTS (
            SELECT 1 FROM buyer_marketplace_correction_events
            WHERE buyer_customer_id=? AND next_marketplace_code=?
              AND next_version=? AND idempotency_key=?
          )
        THEN 1 ELSE 0 END
      `).bind(
        buyerId, marketplace.code, response.version,
        buyerId, marketplace.code, response.version,
        acquired.claim.idempotencyKey,
      ),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ];
    await database.batch(statements);
    return response;
  } catch (error) {
    const normalized = normalizeError(error);
    await markIdempotencyFailed(
      database,
      acquired.claim,
      normalized.code,
      now,
    );
    throw normalized;
  }
}

async function resolveCorrectionTarget(
  database: SqlDatabase,
  marketplaceCode: MarketplaceCode,
) {
  try {
    return await resolveMarketplace(database, marketplaceCode, {
      requireActive: true,
      requireAdapter: true,
    });
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === 'MARKETPLACE_NOT_FOUND'
      || code === 'MARKETPLACE_DISABLED'
      || code === 'MARKETPLACE_ADAPTER_UNAVAILABLE') {
      throw new BuyerMarketplaceCorrectionError('VALIDATION_ERROR', 400);
    }
    throw new BuyerMarketplaceCorrectionError('DEPENDENCY_UNAVAILABLE', 503);
  }
}

function requireOwner(actor: BuyerMarketplaceCorrectionActor): void {
  if (!actor.roles.includes('owner')
    || !actor.permissions.has('BUYER_IDENTITY_HIGH_RISK_MANAGE')) {
    throw new BuyerMarketplaceCorrectionError('FORBIDDEN', 403);
  }
}

async function hasFormalFacts(
  database: SqlDatabase,
  buyerId: string,
): Promise<boolean> {
  const row = await database.prepare(`
    SELECT EXISTS (
      SELECT 1 FROM product_reservations WHERE buyer_customer_id=?
      UNION ALL SELECT 1 FROM order_evidence_submissions WHERE buyer_customer_id=?
      UNION ALL SELECT 1 FROM formal_orders WHERE buyer_customer_id=?
      UNION ALL SELECT 1 FROM review_cases WHERE buyer_customer_id=?
      UNION ALL SELECT 1 FROM formal_order_financial_snapshots
        WHERE buyer_customer_id=?
    ) AS found
  `).bind(buyerId, buyerId, buyerId, buyerId, buyerId)
    .first<{ found: number }>();
  return row?.found === 1;
}

function cleanText(value: string, maximum: number): string {
  if (typeof value !== 'string') {
    throw new BuyerMarketplaceCorrectionError('VALIDATION_ERROR', 400);
  }
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length < 1 || normalized.length > maximum
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new BuyerMarketplaceCorrectionError('VALIDATION_ERROR', 400);
  }
  return normalized;
}

function normalizeError(error: unknown): BuyerMarketplaceCorrectionError {
  if (error instanceof BuyerMarketplaceCorrectionError) return error;
  const code = (error as { code?: string })?.code;
  if (code === 'IDEMPOTENCY_CONFLICT') {
    return new BuyerMarketplaceCorrectionError('IDEMPOTENCY_CONFLICT', 409);
  }
  if (code === 'REQUEST_IN_PROGRESS') {
    return new BuyerMarketplaceCorrectionError('REQUEST_IN_PROGRESS', 409);
  }
  if (String(error).includes('transaction_assertion_failed')) {
    return new BuyerMarketplaceCorrectionError('STATE_CONFLICT', 409);
  }
  return new BuyerMarketplaceCorrectionError('DEPENDENCY_UNAVAILABLE', 503);
}
