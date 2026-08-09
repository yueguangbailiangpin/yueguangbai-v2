import {
  invariant as assert,
  readRepositoryFile as read,
  repositoryRoot as root,
  resolveChangeFile,
} from './verifier-utils.mjs';

const spec = read('openspec/specs/staff-mcp-agent/spec.md');
const adapter = read('apps/api/src/staff-mcp/server-adapter.ts');
const service = read('apps/api/src/staff-mcp/mock-application-service.ts');
const tools = read('apps/api/src/staff-mcp/tools.ts');
const tests = read('apps/api/src/staff-mcp/staff-mcp.test.ts');
const contract = read('docs/contracts/STAFF_MCP_V1.md');
const ownerChecklist = read('docs/runbooks/STAFF_MCP_EXTERNAL_ACTIVATION_CHECKLIST.md');
const archivedDelta = read(resolveChangeFile(
  'staff-mcp-agent-access',
  'specs/staff-mcp-agent/spec.md',
  root,
));

const requirements = [...spec.matchAll(/^### Requirement: (.+)$/gmu)]
  .map((match) => match[1]);
assert(new Set(requirements).size === requirements.length, 'authoritative MCP requirements must be uniquely named');

const evidence = [
  {
    requirement: 'MCP authenticates one current Staff actor per session',
    implementation: [adapter, 'validateVerifiedSession', 'resolveAssignmentStaffAuthorization', 'resolveStaffDataScope'],
    test: [tests, 'validates verifier sessions', 'forged Staff identity', 'Personal DENY'],
  },
  {
    requirement: 'Staff MCP v1 exposes bounded read and draft tools only',
    implementation: [tools, 'STAFF_MCP_OUTPUT_SCHEMAS', 'projectStaffMcpStructuredResult', 'additionalProperties: false'],
    test: [tests, 'fails closed on undeclared, mistyped, oversized or over-limit Application Service output', 'Buyer/Seller tools'],
  },
  {
    requirement: 'Necessary raw business data is permitted but credentials remain forbidden',
    implementation: [service, 'fullWechatRequired', 'fileAudienceAuthorized'],
    test: [tests, 'allows one authorized screenshot', 'credential/bulk paths'],
  },
  {
    requirement: 'Untrusted content cannot instruct tools or expand authority',
    implementation: [service, '不可信数据', 'recordByDraftObject'],
    test: [tests, 'prompt injection/OCR/customer text', 'prompt-injection-escalate'],
  },
  {
    requirement: 'Every MCP call is auditable and independently disableable',
    implementation: [adapter, "aggregateType: 'MCP_TOOL_CALL'", 'AUDIT_UNAVAILABLE'],
    test: [tests, 'immutable low-sensitivity audits', 'global/per-tool kill switches'],
  },
];

for (const row of evidence) {
  assert(requirements.includes(row.requirement), `missing spec requirement: ${row.requirement}`);
  const [implementation, ...markers] = row.implementation;
  assert(markers.every((marker) => implementation.includes(marker)), `implementation gap: ${row.requirement}`);
  const [test, ...testMarkers] = row.test;
  assert(testMarkers.every((marker) => test.includes(marker)), `test gap: ${row.requirement}`);
}
assert(requirements.length >= evidence.length,
  `authoritative MCP requirement set cannot be smaller than the ${evidence.length} critical invariants`);

assert(contract.includes('原 `staff-mcp-agent-access` Change 的 NO_SCHEMA_CHANGE 是当时历史事实'),
  'historical no-Migration decision missing');
assert(contract.includes('0038_staff_mcp_production_transport_oauth.sql'),
  'current production transport Migration decision missing');
assert(contract.includes('2026-08-07'), 'official documentation retrieval date missing');
assert(!spec.includes('TBD - created by archiving'), 'main spec Purpose still contains archive placeholder');
assert(spec.includes('Staff-only MCP v1'), 'accurate main spec Purpose missing');
assert(archivedDelta.includes('positive runtime output projection'), 'archived delta output whitelist missing');
assert(archivedDelta.includes('Malformed verified-session response'), 'archived delta verified-session scenario missing');
assert(contract.includes('STAFF_MCP_OUTPUT_SCHEMAS'), 'contract output whitelist evidence missing');
assert(ownerChecklist.includes('本清单全部未执行'), 'external gate disclosure missing');
assert((ownerChecklist.match(/- \[ \]/gu) ?? []).length >= 20, 'external owner gates were accidentally completed');

console.log(JSON.stringify({
  status: 'PASS',
  change: 'staff-mcp-agent-access',
  authoritative_requirements: requirements.length,
  critical_requirements: evidence.length,
  implementation_mappings: evidence.length,
  test_mappings: evidence.length,
  external_activation: 'HARD_DISABLED_UNCOMPLETED',
  migration: 'HISTORICAL_NO_0035_CURRENT_0038',
  exact_output_whitelist: 'DECLARED_AND_RUNTIME_ENFORCED',
  verified_session_validation: 'FAIL_CLOSED_BEFORE_KEYS',
}, null, 2));
