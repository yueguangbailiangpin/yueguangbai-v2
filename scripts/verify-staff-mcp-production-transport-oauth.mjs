import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  invariant as assert,
  readRepositoryFile,
  repositoryRoot as root,
  resolveChangeFile,
} from './verifier-utils.mjs';

const read = (file) => readRepositoryFile(file, root);

const migrations = readdirSync(path.join(root, 'migrations'))
  .filter((file) => /^\d{4}_.+\.sql$/u.test(file)).sort();
assert(migrations.length === 39
  && migrations[37] === '0038_staff_mcp_production_transport_oauth.sql'
  && migrations.at(-1) === '0039_staff_access_binding_management.sql'
  && migrations.every((file, index) => Number(file.slice(0, 4)) === index + 1),
'Staff MCP Migration must remain at 0038 in the continuous 0001-0039 chain');

const migration = read('migrations/0038_staff_mcp_production_transport_oauth.sql');
for (const marker of [
  'schema_version=37',
  'CREATE TABLE staff_mcp_subject_bindings',
  'CREATE TABLE staff_mcp_token_revocations',
  'CREATE TABLE staff_mcp_replay_records',
  'CREATE TABLE staff_mcp_rate_limits',
  'CREATE TABLE staff_mcp_runtime_controls',
  "'COMPLETED_NO_RESPONSE'",
  'length(response_json)<=262144',
  "'GLOBAL','staff-mcp',0",
  'SET schema_version=38',
]) assert(migration.includes(marker), `Migration boundary missing: ${marker}`);
for (const forbidden of ['access_token TEXT', 'refresh_token TEXT', 'secret TEXT', 'prompt TEXT']) {
  assert(!migration.toLowerCase().includes(forbidden), `Migration stores forbidden value: ${forbidden}`);
}

const oauth = read('apps/api/src/staff-mcp/oauth-resource-server.ts');
for (const marker of [
  "header['alg'] !== 'RS256'",
  "header['typ'] !== 'at+jwt'",
  'code_challenge_methods_supported',
  "'S256'",
  "'plain'",
  'loadJwks(true)',
  'tokenStatus.isActive',
  "value['resource'] !== config.resource",
  'validAudience',
  'MAX_TOKEN_LIFETIME_MS',
  'ServiceBindingStaffMcpTokenStatusProvider',
  'MAX_TOKEN_STATUS_BYTES',
  'staff_mcp_token_status_timeout',
]) assert(oauth.includes(marker), `OAuth verifier missing: ${marker}`);

const transport = read('apps/api/src/staff-mcp/transport.ts');
for (const marker of [
  "'/.well-known/oauth-protected-resource/mcp'",
  "'/mcp'",
  'WWW-Authenticate',
  'resource_metadata',
  'MAX_BODY_BYTES',
  'isGloballyEnabled',
  'runtime.cleanup.run',
]) assert(transport.includes(marker), `transport missing: ${marker}`);

const securityState = read('apps/api/src/staff-mcp/security-state.ts');
for (const marker of [
  'D1StaffMcpIdentityStore',
  'D1StaffMcpControlStore',
  'D1StaffMcpRateLimiter',
  'D1StaffMcpReplayStore',
  'D1StaffMcpCleanup',
  'staff_mcp_replay_binary_forbidden',
  'MAX_REPLAY_RESPONSE_BYTES',
  "keyedHash(this.hashSecret, 'replay'",
]) assert(securityState.includes(marker), `durable state missing: ${marker}`);

const runtime = read('apps/api/src/staff-mcp/runtime.ts');
const application = read('apps/api/src/staff-mcp/d1-application-service.ts');
for (const marker of [
  'D1StaffMcpApplicationService',
  'STAFF_MCP_TOKEN_STATUS_SERVICE',
  "STAFF_MCP_CLEANUP_ENABLED !== 'true'",
  "disabledTools.add('read_task_screenshot_v1')",
]) assert(runtime.includes(marker), `production runtime missing: ${marker}`);
assert(!runtime.includes('STAFF_MCP_APPLICATION_SERVICE')
  && !runtime.includes('STAFF_MCP_TOKEN_STATUS_PROVIDER'),
'production runtime still depends on JavaScript object injection');
for (const marker of [
  'class D1StaffMcpApplicationService',
  'FROM buyer_customers',
  'FROM formal_orders',
  'FROM review_cases',
  'FROM buyer_refund_ledger_balances',
  'FROM seller_stores',
]) assert(application.includes(marker), `D1 application service missing: ${marker}`);

const tools = read('packages/contracts/src/staff-mcp.ts');
const toolBlock = tools.match(/STAFF_MCP_TOOL_NAMES = \[([\s\S]*?)\] as const/u)?.[1] ?? '';
assert((toolBlock.match(/'[a-z0-9_]+_v1'/gu) ?? []).length === 13,
  'Staff MCP v1 tool inventory must remain exactly 13');
for (const forbidden of ['write_', 'execute_', 'approve_', 'send_', 'pay_']) {
  assert(!toolBlock.includes(`'${forbidden}`), `formal write tool forbidden: ${forbidden}`);
}

for (const environment of ['staging', 'production']) {
  const template = read(`apps/api/wrangler.${environment}.template.jsonc`);
  for (const marker of [
    '"STAFF_MCP_ENABLED": "false"',
    '"STAFF_MCP_PRODUCTION_TRANSPORT_ENABLED": "false"',
    '"STAFF_MCP_LOCAL_MOCK_ENABLED": "false"',
    '"STAFF_MCP_CLEANUP_ENABLED": "false"',
    '"binding": "STAFF_MCP_TOKEN_STATUS_SERVICE"',
  ]) assert(template.includes(marker), `${environment} default is unsafe: ${marker}`);
  assert(!template.includes('"STAFF_MCP_BINDING_HASH_SECRET"'),
    `${environment} template contains managed Secret`);
}

for (const file of [
  'docs/contracts/STAFF_MCP_PRODUCTION_TRANSPORT_OAUTH.md',
  'docs/runbooks/STAFF_MCP_PRODUCTION_TRANSPORT_OAUTH.md',
  'docs/acceptance/STAFF_MCP_PRODUCTION_TRANSPORT_OAUTH.md',
  'scripts/preflight-staff-mcp-production.mjs',
]) assert(existsSync(path.join(root, file)), `evidence missing: ${file}`);
resolveChangeFile(
  'staff-mcp-production-transport-oauth',
  'specs/staff-mcp-agent/spec.md',
  root,
);

const evidence = read('docs/acceptance/STAFF_MCP_PRODUCTION_TRANSPORT_OAUTH.md');
for (const marker of [
  'LOCAL_IMPLEMENTATION_READY / PRODUCTION_NO_GO',
  'OPENAI_RESOURCES_TOUCHED=no',
  'CLOUDFLARE_RESOURCES_TOUCHED=no',
  'GITHUB_REMOTE_TOUCHED=no',
  'REMOTE_WRITES=no',
]) assert(evidence.includes(marker), `truthful acceptance missing: ${marker}`);

console.log(JSON.stringify({
  status: 'PASS',
  change: 'staff-mcp-production-transport-oauth',
  migration: '0038_GUARDED',
  transport: 'HTTPS_JSON_RPC_RFC9728_LOCAL',
  oauth: 'ANONYMOUS_RS256_JWKS_ROTATION_REVOCATION_FAIL_CLOSED',
  durable_state: 'D1_BINDING_REPLAY_RATE_CONTROL',
  external_calls: 0,
  production_go: 'NO_GO',
}, null, 2));
