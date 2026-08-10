import {
  STAFF_MCP_TOOL_NAMES,
  type SqlDatabase,
  type StaffMcpToolName,
} from '@ygb/contracts';
import { D1StaffMcpApplicationService } from './d1-application-service';
import {
  FetchStaffMcpOAuthDocumentProvider,
  ProductionStaffMcpOAuthVerifier,
  ServiceBindingStaffMcpTokenStatusProvider,
  assertStaffMcpOAuthConfig,
  type StaffMcpOAuthConfig,
  type StaffMcpOAuthDocumentProvider,
  type StaffMcpTokenStatusServiceBinding,
} from './oauth-resource-server';
import {
  D1StaffMcpControlStore,
  D1StaffMcpCleanup,
  D1StaffMcpIdentityStore,
  D1StaffMcpRateLimiter,
  D1StaffMcpReplayStore,
} from './security-state';
import { StaffMcpServerAdapter } from './server-adapter';

export interface StaffMcpLocalRuntimeBindings {
  STAFF_MCP_ENABLED?: string;
  STAFF_MCP_LOCAL_MOCK_ENABLED?: string;
  STAFF_MCP_DISABLED_TOOLS?: string;
  STAFF_MCP_ADAPTER?: StaffMcpServerAdapter;
}

export interface StaffMcpProductionRuntimeBindings
extends StaffMcpLocalRuntimeBindings {
  DB?: SqlDatabase;
  STAFF_MCP_PRODUCTION_TRANSPORT_ENABLED?: string;
  STAFF_MCP_ENABLED_TOOLS?: string;
  STAFF_MCP_RESOURCE?: string;
  STAFF_MCP_RESOURCE_DOCUMENTATION_URL?: string;
  STAFF_MCP_RESOURCE_POLICY_URL?: string;
  STAFF_MCP_OAUTH_AUDIENCE?: string;
  STAFF_MCP_OAUTH_ISSUER?: string;
  STAFF_MCP_OAUTH_METADATA_URL?: string;
  STAFF_MCP_OAUTH_AUTHORIZATION_ENDPOINT?: string;
  STAFF_MCP_OAUTH_TOKEN_ENDPOINT?: string;
  STAFF_MCP_OAUTH_JWKS_URI?: string;
  STAFF_MCP_OAUTH_REVOCATION_ENDPOINT?: string;
  STAFF_MCP_BINDING_HASH_SECRET?: string;
  STAFF_MCP_CLEANUP_ENABLED?: string;
  STAFF_MCP_CLEANUP_LIMIT?: string;
  STAFF_MCP_GLOBAL_RATE_LIMIT_PER_MINUTE?: string;
  STAFF_MCP_TOOL_RATE_LIMIT_PER_MINUTE?: string;
  STAFF_MCP_OAUTH_DOCUMENT_PROVIDER?: StaffMcpOAuthDocumentProvider;
  STAFF_MCP_TOKEN_STATUS_SERVICE?: StaffMcpTokenStatusServiceBinding;
  STAFF_MCP_TOKEN_STATUS_TIMEOUT_MS?: string;
}

/** Local mock mode remains explicit and cannot become a production verifier. */
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

export function staffMcpProductionRuntime(
  bindings: StaffMcpProductionRuntimeBindings,
) {
  if (bindings.STAFF_MCP_ENABLED !== 'true'
    || bindings.STAFF_MCP_PRODUCTION_TRANSPORT_ENABLED !== 'true'
    || bindings.STAFF_MCP_LOCAL_MOCK_ENABLED !== 'false'
    || bindings.STAFF_MCP_CLEANUP_ENABLED !== 'true'
    || !isSqlDatabase(bindings.DB)
    || !isTokenStatusServiceBinding(bindings.STAFF_MCP_TOKEN_STATUS_SERVICE)
    || typeof bindings.STAFF_MCP_BINDING_HASH_SECRET !== 'string'
    || bindings.STAFF_MCP_BINDING_HASH_SECRET.length < 32) return null;
  const config = oauthConfig(bindings);
  if (!config) return null;
  const globalRateLimit = optionalLimit(
    bindings.STAFF_MCP_GLOBAL_RATE_LIMIT_PER_MINUTE,
    120,
  );
  const toolRateLimit = optionalLimit(
    bindings.STAFF_MCP_TOOL_RATE_LIMIT_PER_MINUTE,
    30,
  );
  const cleanupLimit = optionalLimit(bindings.STAFF_MCP_CLEANUP_LIMIT, 100);
  const tokenStatusTimeout = boundedInteger(
    bindings.STAFF_MCP_TOKEN_STATUS_TIMEOUT_MS,
    3_000,
    50,
    10_000,
  );
  if (!globalRateLimit || !toolRateLimit || !cleanupLimit || !tokenStatusTimeout) {
    return null;
  }
  const secret = bindings.STAFF_MCP_BINDING_HASH_SECRET;
  const controlStore = new D1StaffMcpControlStore(bindings.DB);
  const documents = bindings.STAFF_MCP_OAUTH_DOCUMENT_PROVIDER
    ?? new FetchStaffMcpOAuthDocumentProvider(config);
  const verifier = new ProductionStaffMcpOAuthVerifier(
    config,
    documents,
    new D1StaffMcpIdentityStore(bindings.DB, secret),
    new ServiceBindingStaffMcpTokenStatusProvider(
      bindings.STAFF_MCP_TOKEN_STATUS_SERVICE,
      secret,
      tokenStatusTimeout,
    ),
  );
  const enabledTools = parseConfiguredTools(bindings.STAFF_MCP_ENABLED_TOOLS, false);
  const configuredDisabledTools = parseConfiguredTools(
    bindings.STAFF_MCP_DISABLED_TOOLS,
    true,
  );
  if (!enabledTools || !configuredDisabledTools
    || enabledTools.has('read_task_screenshot_v1')
    || enabledTools.has('list_staff_exceptions_v1')) return null;
  const disabledTools = new Set<StaffMcpToolName>(configuredDisabledTools);
  for (const toolName of STAFF_MCP_TOOL_NAMES) {
    if (!enabledTools.has(toolName)) disabledTools.add(toolName);
  }
  disabledTools.add('read_task_screenshot_v1');
  disabledTools.add('list_staff_exceptions_v1');
  const effectiveEnabledTools = [...enabledTools]
    .filter((toolName) => !disabledTools.has(toolName));
  if (effectiveEnabledTools.length === 0) return null;
  const adapter = new StaffMcpServerAdapter({
    database: bindings.DB,
    oauthVerifier: verifier,
    applicationService: new D1StaffMcpApplicationService(bindings.DB),
    rateLimiter: new D1StaffMcpRateLimiter(bindings.DB, secret),
    replayStore: new D1StaffMcpReplayStore(bindings.DB, secret),
    controlStore,
    enabled: true,
    disabledTools,
    globalRateLimitPerMinute: globalRateLimit,
    toolRateLimitPerMinute: toolRateLimit,
  });
  return Object.freeze({
    config,
    controlStore,
    cleanup: new D1StaffMcpCleanup(bindings.DB),
    cleanupLimit,
    adapter,
    enabledTools: Object.freeze(effectiveEnabledTools),
    productionActivationSupported: true as const,
  });
}

function oauthConfig(
  bindings: StaffMcpProductionRuntimeBindings,
): StaffMcpOAuthConfig | null {
  const values = [
    bindings.STAFF_MCP_RESOURCE,
    bindings.STAFF_MCP_OAUTH_AUDIENCE,
    bindings.STAFF_MCP_RESOURCE_DOCUMENTATION_URL,
    bindings.STAFF_MCP_RESOURCE_POLICY_URL,
    bindings.STAFF_MCP_OAUTH_ISSUER,
    bindings.STAFF_MCP_OAUTH_METADATA_URL,
    bindings.STAFF_MCP_OAUTH_AUTHORIZATION_ENDPOINT,
    bindings.STAFF_MCP_OAUTH_TOKEN_ENDPOINT,
    bindings.STAFF_MCP_OAUTH_JWKS_URI,
    bindings.STAFF_MCP_OAUTH_REVOCATION_ENDPOINT,
  ];
  if (values.some((value) => typeof value !== 'string')) return null;
  const config: StaffMcpOAuthConfig = {
    resource: values[0]!,
    audience: values[1]!,
    resourceDocumentationUrl: values[2]!,
    resourcePolicyUrl: values[3]!,
    issuer: values[4]!,
    metadataUrl: values[5]!,
    authorizationEndpoint: values[6]!,
    tokenEndpoint: values[7]!,
    jwksUri: values[8]!,
    revocationEndpoint: values[9]!,
  };
  try {
    assertStaffMcpOAuthConfig(config);
    return config;
  } catch {
    return null;
  }
}

function parseDisabledTools(value: string | undefined): Set<StaffMcpToolName> {
  if (!value) return new Set();
  const allowed = new Set<StaffMcpToolName>();
  const known = new Set<string>(STAFF_MCP_TOOL_NAMES);
  for (const part of value.split(',')) {
    const tool = part.trim();
    if (known.has(tool)) allowed.add(tool as StaffMcpToolName);
  }
  return allowed;
}

function parseConfiguredTools(
  value: string | undefined,
  allowEmpty: boolean,
): Set<StaffMcpToolName> | null {
  if (value === undefined) return allowEmpty ? new Set() : null;
  if (!allowEmpty && value.trim() === '') return null;
  if (allowEmpty && value.trim() === '') return new Set();
  const known = new Set<string>(STAFF_MCP_TOOL_NAMES);
  const tools = value.split(',').map((part) => part.trim());
  if (tools.some((tool) => !known.has(tool)) || new Set(tools).size !== tools.length) {
    return null;
  }
  return new Set(tools as StaffMcpToolName[]);
}

function optionalLimit(value: string | undefined, fallback: number): number | null {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d{0,3}$/u.test(value)) return null;
  const parsed = Number(value);
  return parsed <= 10_000 ? parsed : null;
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number | null {
  if (value === undefined) return fallback;
  if (!/^\d{1,5}$/u.test(value)) return null;
  const parsed = Number(value);
  return parsed >= minimum && parsed <= maximum ? parsed : null;
}

function isSqlDatabase(value: unknown): value is SqlDatabase {
  return !!value && typeof value === 'object'
    && typeof (value as Partial<SqlDatabase>).prepare === 'function'
    && typeof (value as Partial<SqlDatabase>).batch === 'function';
}

function isTokenStatusServiceBinding(
  value: unknown,
): value is StaffMcpTokenStatusServiceBinding {
  return !!value && typeof value === 'object'
    && typeof (value as Partial<StaffMcpTokenStatusServiceBinding>).fetch === 'function';
}
