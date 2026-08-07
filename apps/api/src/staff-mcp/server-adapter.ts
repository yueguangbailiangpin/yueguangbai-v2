import {
  isStaffMcpToolName,
  STAFF_MCP_PROTOCOL_VERSION,
  STAFF_MCP_REQUIRED_OAUTH_SCOPE,
  STAFF_MCP_TOOL_VERSION,
  type SqlDatabase,
  type StaffMcpCurrentActor,
  type StaffMcpOAuthVerifier,
  type StaffMcpOutcome,
  type StaffMcpStructuredResult,
  type StaffMcpToolName,
  type StaffMcpToolResult,
  type StaffMcpVerifiedSession,
} from '@ygb/contracts';
import { hashCanonicalJson } from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import {
  resolveAssignmentStaffAuthorization,
  resolveStaffDataScope,
} from '../staff-assignment';
import {
  StaffMcpApplicationError,
  type StaffMcpApplicationOutput,
  type StaffMcpApplicationService,
} from './application-service';
import type { StaffMcpRateLimiter } from './rate-limit';
import type { StaffMcpReplayStore } from './replay';
import {
  parseStaffMcpArguments,
  STAFF_MCP_TOOL_DEFINITIONS,
  StaffMcpValidationError,
} from './tools';

const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const RATE_WINDOW_MS = 60_000;

export interface StaffMcpServerOptions {
  database: SqlDatabase;
  oauthVerifier: StaffMcpOAuthVerifier;
  applicationService: StaffMcpApplicationService;
  rateLimiter: StaffMcpRateLimiter;
  replayStore: StaffMcpReplayStore;
  enabled: boolean;
  disabledTools?: ReadonlySet<StaffMcpToolName>;
  globalRateLimitPerMinute?: number;
  toolRateLimitPerMinute?: number;
  now?: () => number;
  idFactory?: () => string;
}

export interface StaffMcpInvokeInput {
  accessToken: string;
  requestId: string;
  toolName: string;
  argumentsValue: unknown;
}

interface AuditContext {
  requestId: string;
  toolName: string;
  outcome: StaffMcpOutcome;
  session: StaffMcpVerifiedSession | null;
  actor: StaffMcpCurrentActor | null;
  scopeType: string;
  scopeId: string;
  now: number;
}

export class StaffMcpServerAdapter {
  private readonly database: SqlDatabase;
  private readonly oauthVerifier: StaffMcpOAuthVerifier;
  private readonly applicationService: StaffMcpApplicationService;
  private readonly rateLimiter: StaffMcpRateLimiter;
  private readonly replayStore: StaffMcpReplayStore;
  private readonly enabled: boolean;
  private readonly disabledTools: ReadonlySet<StaffMcpToolName>;
  private readonly globalRateLimit: number;
  private readonly toolRateLimit: number;
  private readonly now: () => number;
  private readonly idFactory: () => string;

  constructor(options: StaffMcpServerOptions) {
    this.database = options.database;
    this.oauthVerifier = options.oauthVerifier;
    this.applicationService = options.applicationService;
    this.rateLimiter = options.rateLimiter;
    this.replayStore = options.replayStore;
    this.enabled = options.enabled;
    this.disabledTools = options.disabledTools ?? new Set();
    this.globalRateLimit = positiveLimit(options.globalRateLimitPerMinute ?? 120);
    this.toolRateLimit = positiveLimit(options.toolRateLimitPerMinute ?? 30);
    this.now = options.now ?? Date.now;
    this.idFactory = options.idFactory ?? (() => crypto.randomUUID());
  }

  listTools() {
    if (!this.enabled) return [];
    return STAFF_MCP_TOOL_DEFINITIONS.filter(
      (definition) => !this.disabledTools.has(definition.name),
    );
  }

  async invoke(input: StaffMcpInvokeInput): Promise<StaffMcpToolResult> {
    const now = this.now();
    const requestId = safeRequestId(input.requestId);
    const toolName = input.toolName;
    let session: StaffMcpVerifiedSession | null = null;
    let actor: StaffMcpCurrentActor | null = null;
    let replayKey: string | null = null;
    let requestHash: string | null = null;

    if (!requestId) {
      return this.errorWithAudit(
        'VALIDATION_REJECTED',
        `invalid-${crypto.randomUUID()}`,
        input.toolName,
        session,
        actor,
        now,
      );
    }
    if (!this.enabled) {
      return this.errorWithAudit('DISABLED', requestId, toolName, session, actor, now);
    }
    if (!isStaffMcpToolName(toolName)) {
      return this.errorWithAudit(
        'VALIDATION_REJECTED', requestId, toolName, session, actor, now,
      );
    }

    let args: Readonly<Record<string, unknown>>;
    try {
      args = parseStaffMcpArguments(toolName, input.argumentsValue);
    } catch (error) {
      if (!(error instanceof StaffMcpValidationError)) throw error;
      return this.errorWithAudit(
        'VALIDATION_REJECTED', requestId, toolName, session, actor, now,
      );
    }

    try {
      session = await this.oauthVerifier.verifyAccessToken(input.accessToken, now);
    } catch {
      return this.errorWithAudit(
        'PROVIDER_UNAVAILABLE', requestId, toolName, session, actor, now,
      );
    }
    if (!session
      || session.expiresAt <= now
      || !session.scopes.includes(STAFF_MCP_REQUIRED_OAUTH_SCOPE)) {
      return this.errorWithAudit(
        'UNAUTHENTICATED', requestId, toolName, session, actor, now,
      );
    }

    const current = await resolveAssignmentStaffAuthorization(
      this.database,
      session.staffId,
    );
    if (!current) {
      return this.errorWithAudit(
        'UNAUTHENTICATED', requestId, toolName, session, actor, now,
      );
    }
    const dataScope = await resolveStaffDataScope(this.database, current);
    actor = Object.freeze({
      staffId: current.staffId,
      displayName: current.displayName,
      authorizationVersion: current.authorizationVersion,
      roles: current.roles,
      permissions: current.permissions,
      dataScope,
      memberTeamIds: current.memberTeamIds,
      leaderTeamIds: current.leaderTeamIds,
    });

    if (this.disabledTools.has(toolName)) {
      return this.errorWithAudit(
        'DISABLED', requestId, toolName, session, actor, now,
      );
    }
    const globalKey = `${session.clientId}:${session.sessionId}:global`;
    const toolKey = `${session.clientId}:${session.sessionId}:${actor.staffId}:${toolName}`;
    if (!this.rateLimiter.take(globalKey, now, this.globalRateLimit, RATE_WINDOW_MS)
      || !this.rateLimiter.take(toolKey, now, this.toolRateLimit, RATE_WINDOW_MS)) {
      return this.errorWithAudit(
        'RATE_LIMITED', requestId, toolName, session, actor, now,
      );
    }

    requestHash = await hashCanonicalJson({ tool_name: toolName, arguments: args });
    replayKey = `${session.clientId}:${session.sessionId}:${requestId}`;
    const acquired = this.replayStore.acquire(replayKey, requestHash);
    if (acquired.kind === 'CONFLICT') {
      return this.errorWithAudit(
        'REPLAY_CONFLICT', requestId, toolName, session, actor, now,
      );
    }
    if (acquired.kind === 'IN_PROGRESS') {
      return this.errorWithAudit(
        'IN_PROGRESS', requestId, toolName, session, actor, now,
      );
    }
    if (acquired.kind === 'REPLAY') {
      await this.safeAudit({
        requestId,
        toolName,
        outcome: 'REPLAYED',
        session,
        actor,
        scopeType: 'REPLAY',
        scopeId: requestId,
        now,
      });
      return acquired.result;
    }

    try {
      const output = await this.applicationService.execute(toolName, args, actor);
      const result = buildSuccessResult(output, requestId, now);
      assertSafeToolResult(result);
      await this.safeAudit({
        requestId,
        toolName,
        outcome: 'SUCCEEDED',
        session,
        actor,
        scopeType: output.auditScope.type,
        scopeId: output.auditScope.id,
        now,
      });
      this.replayStore.complete(replayKey, requestHash, result);
      return result;
    } catch (error) {
      this.replayStore.fail(replayKey, requestHash);
      if (error instanceof StaffMcpApplicationError) {
        const outcome = error.code === 'NOT_FOUND'
          ? 'NOT_FOUND'
          : error.code === 'PROVIDER_UNAVAILABLE'
            ? 'PROVIDER_UNAVAILABLE'
            : 'INTERNAL_ERROR';
        return this.errorWithAudit(
          outcome, requestId, toolName, session, actor, now,
        );
      }
      if (error instanceof StaffMcpAuditUnavailableError) {
        return errorResult('AUDIT_UNAVAILABLE', requestId);
      }
      return this.errorWithAudit(
        'INTERNAL_ERROR', requestId, toolName, session, actor, now,
      );
    }
  }

  async handleJsonRpc(
    request: unknown,
    accessToken: string,
  ): Promise<Record<string, unknown>> {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      return protocolError(null, -32600, '无效的 JSON-RPC 请求');
    }
    const value = request as Record<string, unknown>;
    const id = value['id'];
    if (value['jsonrpc'] !== '2.0' || (typeof id !== 'string' && typeof id !== 'number')) {
      return protocolError(null, -32600, '无效的 JSON-RPC 请求');
    }
    if (value['method'] === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: STAFF_MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'yueguangbai-staff-mcp-local', version: '1.0.0-local' },
          instructions: '只处理当前员工已授权的受限读取与草稿。正式动作必须回到受控 Web。',
        },
      };
    }
    if (value['method'] === 'tools/list') {
      const params = value['params'] ?? {};
      if (!params || typeof params !== 'object' || Array.isArray(params)
        || Object.keys(params as object).some((key) => key !== 'cursor')) {
        return protocolError(id, -32602, '工具列表参数不正确');
      }
      if (!await this.catalogAuthorized(accessToken)) {
        return protocolError(id, -32001, '员工身份不可用');
      }
      return { jsonrpc: '2.0', id, result: { tools: this.listTools() } };
    }
    if (value['method'] !== 'tools/call') {
      return protocolError(id, -32601, '方法不存在');
    }
    const params = value['params'];
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      return protocolError(id, -32602, '工具调用参数不正确');
    }
    const call = params as Record<string, unknown>;
    if (typeof call['name'] !== 'string' || !isStaffMcpToolName(call['name'])) {
      return protocolError(id, -32602, '工具未注册');
    }
    const result = await this.invoke({
      accessToken,
      requestId: rpcRequestId(id),
      toolName: call['name'],
      argumentsValue: call['arguments'] ?? {},
    });
    return { jsonrpc: '2.0', id, result };
  }

  private async errorWithAudit(
    outcome: StaffMcpOutcome,
    requestId: string,
    toolName: string,
    session: StaffMcpVerifiedSession | null,
    actor: StaffMcpCurrentActor | null,
    now: number,
  ): Promise<StaffMcpToolResult> {
    try {
      await this.safeAudit({
        requestId,
        toolName,
        outcome,
        session,
        actor,
        scopeType: 'REQUEST',
        scopeId: requestId,
        now,
      });
      return errorResult(outcome, requestId);
    } catch (error) {
      if (error instanceof StaffMcpAuditUnavailableError) {
        return errorResult('AUDIT_UNAVAILABLE', requestId);
      }
      throw error;
    }
  }

  private async catalogAuthorized(accessToken: string): Promise<boolean> {
    if (!this.enabled) return false;
    try {
      const now = this.now();
      const session = await this.oauthVerifier.verifyAccessToken(accessToken, now);
      if (!session
        || session.expiresAt <= now
        || !session.scopes.includes(STAFF_MCP_REQUIRED_OAUTH_SCOPE)) return false;
      return await resolveAssignmentStaffAuthorization(
        this.database,
        session.staffId,
      ) !== null;
    } catch {
      return false;
    }
  }

  private async safeAudit(input: AuditContext): Promise<void> {
    try {
      await createAuditEventStatement(this.database, {
        id: this.idFactory(),
        aggregateType: 'MCP_TOOL_CALL',
        aggregateId: input.requestId,
        eventType: 'STAFF_MCP_TOOL_CALLED',
        actor: {
          type: 'STAFF_MCP',
          id: input.actor?.staffId ?? null,
          roles: input.actor ? [...input.actor.roles] : [],
        },
        requestId: input.requestId,
        previousState: null,
        nextState: {
          client_id: input.session?.clientId ?? 'unverified',
          tool: safeToolLabel(input.toolName),
          tool_version: STAFF_MCP_TOOL_VERSION,
          scope_type: safeScope(input.scopeType),
          scope_id: safeScope(input.scopeId),
          outcome: input.outcome,
        },
        createdAt: input.now,
      }).run();
    } catch {
      throw new StaffMcpAuditUnavailableError();
    }
  }
}

class StaffMcpAuditUnavailableError extends Error {}

function buildSuccessResult(
  output: StaffMcpApplicationOutput,
  requestId: string,
  now: number,
): StaffMcpToolResult {
  const structuredContent: StaffMcpStructuredResult = {
    kind: output.kind,
    tool_version: STAFF_MCP_TOOL_VERSION,
    generated_at: now,
    display_timezone: 'Asia/Shanghai',
    request_id: requestId,
    source_references: output.sourceReferences,
    data: output.data,
    warnings: output.warnings,
    next_step: output.nextStep,
  };
  const content: StaffMcpToolResult['content'] = [
    { type: 'text', text: JSON.stringify(structuredContent) },
    ...(output.imageContent ? [output.imageContent] : []),
  ];
  return { content, structuredContent, isError: false };
}

function errorResult(outcome: StaffMcpOutcome, requestId: string): StaffMcpToolResult {
  const messages: Readonly<Record<StaffMcpOutcome, string>> = {
    SUCCEEDED: '调用成功',
    REPLAYED: '已安全重放',
    UNAUTHENTICATED: '员工身份不可用或会话已过期',
    NOT_FOUND: '未找到或无权访问该业务对象',
    VALIDATION_REJECTED: '工具参数不符合严格合同',
    RATE_LIMITED: '调用过于频繁，请稍后重试',
    DISABLED: 'Staff MCP 或该工具当前已停用',
    IN_PROGRESS: '相同请求正在处理中',
    REPLAY_CONFLICT: '请求编号与先前调用不一致',
    PROVIDER_UNAVAILABLE: '认证或应用服务暂时不可用',
    AUDIT_UNAVAILABLE: '安全审计不可用，调用已失败关闭',
    INTERNAL_ERROR: '调用失败，未返回业务数据',
  };
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        kind: 'WARNING',
        error_code: outcome,
        message: messages[outcome],
        request_id: requestId,
      }),
    }],
    isError: true,
  };
}

function assertSafeToolResult(result: StaffMcpToolResult): void {
  const structured = result.structuredContent;
  if (!structured) throw new StaffMcpApplicationError('INVALID_RESULT');
  const serialized = JSON.stringify(structured);
  if (serialized.length > 64 * 1024) throw new StaffMcpApplicationError('INVALID_RESULT');
  inspect(structured, 0);
  for (const item of result.content) {
    if (item.type === 'image') {
      if (item.data.length > 8 * 1024 * 1024
        || !/^[A-Za-z0-9+/]*={0,2}$/u.test(item.data)) {
        throw new StaffMcpApplicationError('INVALID_RESULT');
      }
    }
  }
}

function inspect(value: unknown, depth: number): void {
  if (depth > 12) throw new StaffMcpApplicationError('INVALID_RESULT');
  if (typeof value === 'string') {
    if (value.length > 8_000
      || /https?:\/\/|r2:\/\/|drive\.google|Bearer\s|-----BEGIN|\bsk-[A-Za-z0-9]/iu.test(value)) {
      throw new StaffMcpApplicationError('INVALID_RESULT');
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 50) throw new StaffMcpApplicationError('INVALID_RESULT');
    value.forEach((item) => inspect(item, depth + 1));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    if (/password|cookie|session|one.?time|oauth|provider.?token|secret|object.?key|drive.?file.?id|access.?token|refresh.?token/iu.test(key)) {
      throw new StaffMcpApplicationError('INVALID_RESULT');
    }
    inspect(nested, depth + 1);
  }
}

function safeRequestId(value: string): string | null {
  return typeof value === 'string' && REQUEST_ID.test(value) ? value : null;
}

function safeToolLabel(value: string): string {
  return /^[A-Za-z0-9_.-]{1,128}$/u.test(value) ? value : 'invalid_tool';
}

function safeScope(value: string): string {
  return /^[A-Za-z0-9:_-]{1,200}$/u.test(value) ? value : 'redacted';
}

function positiveLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) {
    throw new Error('invalid_staff_mcp_rate_limit');
  }
  return value;
}

function rpcRequestId(id: string | number): string {
  const value = `rpc-${String(id)}`;
  return REQUEST_ID.test(value) ? value : `rpc-${crypto.randomUUID()}`;
}

function protocolError(
  id: string | number | null,
  code: number,
  message: string,
): Record<string, unknown> {
  return { jsonrpc: '2.0', id, error: { code, message } };
}
