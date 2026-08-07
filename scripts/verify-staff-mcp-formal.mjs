import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const activeSpec = 'openspec/changes/staff-mcp-agent-access/specs/staff-mcp-agent/spec.md';
const archivedSpec = 'openspec/specs/staff-mcp-agent/spec.md';
const spec = read(existsSync(resolve(root, activeSpec)) ? activeSpec : archivedSpec);
const adapter = read('apps/api/src/staff-mcp/server-adapter.ts');
const service = read('apps/api/src/staff-mcp/mock-application-service.ts');
const tools = read('apps/api/src/staff-mcp/tools.ts');
const tests = read('apps/api/src/staff-mcp/staff-mcp.test.ts');
const contract = read('docs/contracts/STAFF_MCP_V1.md');
const ownerChecklist = read('docs/runbooks/STAFF_MCP_EXTERNAL_ACTIVATION_CHECKLIST.md');
const archivedDelta = read('openspec/changes/archive/2026-08-07-staff-mcp-agent-access/specs/staff-mcp-agent/spec.md');

const requirements = [...spec.matchAll(/^### Requirement: (.+)$/gmu)]
  .map((match) => match[1]);
assert(requirements.length === 5, `expected 5 requirements, found ${requirements.length}`);

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

assert(contract.includes('本 Change 不创建 0035'), 'no-Migration decision missing');
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
  requirements: evidence.length,
  implementation_mappings: evidence.length,
  test_mappings: evidence.length,
  external_activation: 'HARD_DISABLED_UNCOMPLETED',
  migration: 'NO_0035_JUSTIFIED',
  exact_output_whitelist: 'DECLARED_AND_RUNTIME_ENFORCED',
  verified_session_validation: 'FAIL_CLOSED_BEFORE_KEYS',
}, null, 2));

function read(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

function assert(value, message) {
  if (!value) throw new Error(message);
}
