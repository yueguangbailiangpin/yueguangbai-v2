import type { StaffMcpToolName } from '@ygb/contracts';
import type { StaffMcpServerAdapter } from './server-adapter';

export interface StaffMcpLocalRuntimeBindings {
  STAFF_MCP_ENABLED?: string;
  STAFF_MCP_LOCAL_MOCK_ENABLED?: string;
  STAFF_MCP_DISABLED_TOOLS?: string;
  STAFF_MCP_ADAPTER?: StaffMcpServerAdapter;
}

/**
 * The Change intentionally has no production provider path. Both switches and
 * an injected local adapter are required, so deployment cannot activate MCP.
 */
export function staffMcpLocalRuntime(bindings: StaffMcpLocalRuntimeBindings) {
  const disabledTools = parseDisabledTools(bindings.STAFF_MCP_DISABLED_TOOLS);
  const enabled = bindings.STAFF_MCP_ENABLED === 'true'
    && bindings.STAFF_MCP_LOCAL_MOCK_ENABLED === 'true'
    && bindings.STAFF_MCP_ADAPTER !== undefined;
  return Object.freeze({
    enabled,
    adapter: enabled ? bindings.STAFF_MCP_ADAPTER ?? null : null,
    disabledTools,
    productionActivationSupported: false as const,
  });
}

function parseDisabledTools(value: string | undefined): ReadonlySet<StaffMcpToolName> {
  if (!value) return new Set();
  const allowed = new Set<StaffMcpToolName>();
  const known = new Set<string>([
    'list_staff_tasks_v1',
    'list_staff_exceptions_v1',
    'get_customer_summary_v1',
    'get_order_summary_v1',
    'get_review_summary_v1',
    'get_refund_summary_v1',
    'get_settlement_summary_v1',
    'read_task_screenshot_v1',
    'draft_wechat_message_v1',
    'draft_reconciliation_v1',
    'draft_payment_batch_v1',
    'draft_review_recommendation_v1',
    'get_web_confirmation_step_v1',
  ]);
  for (const part of value.split(',')) {
    const tool = part.trim();
    if (known.has(tool)) allowed.add(tool as StaffMcpToolName);
  }
  return allowed;
}
