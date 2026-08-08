import type { StaffDataScope } from './staff-assignment';
import type { StaffPermissionCode, StaffRoleCode } from './staff';

export const STAFF_MCP_PROTOCOL_VERSION = '2025-11-25' as const;
export const STAFF_MCP_TOOL_VERSION = 'v1' as const;
export const STAFF_MCP_DEFAULT_LIMIT = 20;
export const STAFF_MCP_MAX_LIMIT = 50;

export const STAFF_MCP_TOOL_NAMES = [
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
] as const;

export type StaffMcpToolName = typeof STAFF_MCP_TOOL_NAMES[number];
export type StaffMcpResultKind = 'FACT' | 'DRAFT' | 'WARNING';
export type StaffMcpOutcome =
  | 'SUCCEEDED'
  | 'REPLAYED'
  | 'UNAUTHENTICATED'
  | 'NOT_FOUND'
  | 'VALIDATION_REJECTED'
  | 'RATE_LIMITED'
  | 'DISABLED'
  | 'IN_PROGRESS'
  | 'REPLAY_CONFLICT'
  | 'PROVIDER_UNAVAILABLE'
  | 'AUDIT_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export interface StaffMcpSourceReference {
  object_type: string;
  object_id: string;
  version: number | null;
}

export interface StaffMcpNextStep {
  kind: 'NONE' | 'WEB_CONFIRMATION_REQUIRED';
  label: string;
  web_path: string | null;
}

export interface StaffMcpStructuredResult {
  kind: StaffMcpResultKind;
  tool_version: typeof STAFF_MCP_TOOL_VERSION;
  generated_at: number;
  display_timezone: 'Asia/Shanghai';
  request_id: string;
  source_references: readonly StaffMcpSourceReference[];
  data: Record<string, unknown>;
  warnings: readonly string[];
  next_step: StaffMcpNextStep;
}

export interface StaffMcpTextContent {
  type: 'text';
  text: string;
}

export interface StaffMcpImageContent {
  type: 'image';
  data: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  annotations: {
    audience: readonly ['user', 'assistant'];
  };
}

export interface StaffMcpToolResult {
  content: readonly (StaffMcpTextContent | StaffMcpImageContent)[];
  structuredContent?: StaffMcpStructuredResult;
  isError: boolean;
}

export interface StaffMcpJsonSchema {
  readonly [key: string]: unknown;
}

export interface StaffMcpToolDefinition {
  name: StaffMcpToolName;
  title: string;
  description: string;
  inputSchema: StaffMcpJsonSchema;
  outputSchema: StaffMcpJsonSchema;
  annotations: {
    readOnlyHint: true;
    destructiveHint: false;
    openWorldHint: false;
  };
  execution: {
    taskSupport: 'forbidden';
  };
}

export interface StaffMcpCurrentActor {
  staffId: string;
  displayName: string;
  authorizationVersion: number;
  role: StaffRoleCode;
  permissions: ReadonlySet<StaffPermissionCode>;
  dataScope: StaffDataScope;
  memberTeamIds: readonly string[];
  leaderTeamIds: readonly string[];
}

export interface StaffMcpVerifiedSession {
  clientId: string;
  sessionId: string;
  staffId: string;
  expiresAt: number;
  scopes: readonly string[];
}

export interface StaffMcpOAuthVerifier {
  verifyAccessToken(
    accessToken: string,
    now: number,
  ): Promise<StaffMcpVerifiedSession | null>;
}

export const STAFF_MCP_REQUIRED_OAUTH_SCOPE = 'staff:mcp' as const;

export function isStaffMcpToolName(value: unknown): value is StaffMcpToolName {
  return typeof value === 'string'
    && (STAFF_MCP_TOOL_NAMES as readonly string[]).includes(value);
}
