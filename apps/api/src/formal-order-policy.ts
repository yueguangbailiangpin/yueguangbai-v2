import type { SqlDatabase } from '@ygb/contracts';

export const FORMAL_ORDER_GATED_ACTIONS = [
  'APPROVE_REVIEW',
  'CREATE_BUYER_REFUND',
  'ACCRUE_SELLER_SERVICE_FEE',
  'RECORD_ADVANCE_PRINCIPAL',
] as const;

export type FormalOrderGatedAction = typeof FORMAL_ORDER_GATED_ACTIONS[number];
export type FormalOrderOperationalState =
  | 'NORMAL'
  | 'PLATFORM_CANCELLED'
  | 'RETURN_REFUND'
  | 'BUSINESS_VOID'
  | 'MANUAL_INVESTIGATION';

export type FormalOrderActionBlockReason =
  | 'ORDER_PLATFORM_CANCELLED'
  | 'ORDER_RETURN_REFUND'
  | 'ORDER_BUSINESS_VOID'
  | 'ORDER_UNDER_INVESTIGATION';

export interface FormalOrderActionCapability {
  action: FormalOrderGatedAction;
  allowed: boolean;
  operational_state: FormalOrderOperationalState;
  reason: FormalOrderActionBlockReason | null;
}

export interface FormalOrderBusinessCapabilities {
  formal_order_id: string;
  operational_state: FormalOrderOperationalState;
  actions: Readonly<Record<FormalOrderGatedAction, FormalOrderActionCapability>>;
}

export class FormalOrderPolicyError extends Error {
  constructor(
    public readonly code: 'FORMAL_ORDER_NOT_FOUND' | 'FORMAL_ORDER_ACTION_BLOCKED',
    public readonly action: FormalOrderGatedAction,
    public readonly state: FormalOrderOperationalState | null,
  ) {
    super(code);
    this.name = 'FormalOrderPolicyError';
  }
}

export async function readFormalOrderBusinessCapabilities(
  database: SqlDatabase,
  formalOrderId: string,
): Promise<FormalOrderBusinessCapabilities> {
  const row = await database.prepare(`
    SELECT formal_order.id,
      COALESCE(state.operational_state,'NORMAL') AS operational_state
    FROM formal_orders formal_order
    LEFT JOIN formal_order_effective_operational_state state
      ON state.formal_order_id=formal_order.id
    WHERE formal_order.id=?
    LIMIT 1
  `).bind(formalOrderId).first<{ id: string; operational_state: string }>();
  if (!row) {
    throw new FormalOrderPolicyError(
      'FORMAL_ORDER_NOT_FOUND',
      'APPROVE_REVIEW',
      null,
    );
  }
  const operationalState = normalizeState(row.operational_state);
  const actions = Object.fromEntries(FORMAL_ORDER_GATED_ACTIONS.map((action) => [
    action,
    Object.freeze({
      action,
      allowed: operationalState === 'NORMAL',
      operational_state: operationalState,
      reason: reasonForState(operationalState),
    } satisfies FormalOrderActionCapability),
  ])) as Record<FormalOrderGatedAction, FormalOrderActionCapability>;
  return Object.freeze({
    formal_order_id: row.id,
    operational_state: operationalState,
    actions: Object.freeze(actions),
  });
}

export async function requireFormalOrderAction(
  database: SqlDatabase,
  formalOrderId: string,
  action: FormalOrderGatedAction,
): Promise<FormalOrderActionCapability> {
  const capabilities = await readFormalOrderBusinessCapabilities(database, formalOrderId);
  const capability = capabilities.actions[action];
  if (!capability.allowed) {
    throw new FormalOrderPolicyError(
      'FORMAL_ORDER_ACTION_BLOCKED',
      action,
      capability.operational_state,
    );
  }
  return capability;
}

function normalizeState(value: string): FormalOrderOperationalState {
  if (value === 'NORMAL'
    || value === 'PLATFORM_CANCELLED'
    || value === 'RETURN_REFUND'
    || value === 'BUSINESS_VOID'
    || value === 'MANUAL_INVESTIGATION') return value;
  throw new Error('invalid_formal_order_operational_state');
}

function reasonForState(
  state: FormalOrderOperationalState,
): FormalOrderActionBlockReason | null {
  if (state === 'NORMAL') return null;
  if (state === 'PLATFORM_CANCELLED') return 'ORDER_PLATFORM_CANCELLED';
  if (state === 'RETURN_REFUND') return 'ORDER_RETURN_REFUND';
  if (state === 'BUSINESS_VOID') return 'ORDER_BUSINESS_VOID';
  return 'ORDER_UNDER_INVESTIGATION';
}
