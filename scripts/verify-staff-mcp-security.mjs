import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const contract = read('packages/contracts/src/staff-mcp.ts');
const tools = read('apps/api/src/staff-mcp/tools.ts');
const server = read('apps/api/src/staff-mcp/server-adapter.ts');
const app = read('apps/api/src/app.ts');
const expected = [
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
];

const array = /STAFF_MCP_TOOL_NAMES = \[([\s\S]*?)\] as const;/u.exec(contract)?.[1] ?? '';
const actual = [...array.matchAll(/'([^']+)'/gu)].map((match) => match[1]);
assert(JSON.stringify(actual) === JSON.stringify(expected), 'Staff MCP tool registry drifted');
assert(actual.every((name) => name.endsWith('_v1')), 'unversioned MCP tool');
assert(actual.every((name) => !/(buyer|seller)[_.-]?mcp|sql|http|export|send|transfer|approve|finalize/iu.test(name)), 'forbidden tool registered');

const inputBlock = /DEFINITION_INPUTS[\s\S]*?const TITLES:/u.exec(tools)?.[0] ?? '';
for (const key of [
  'staff_id', 'role', 'scope', 'sql', 'http_path', 'expected_version',
  'idempotency_key', 'password', 'cookie', 'session', 'oauth_token',
  'provider_token', 'secret', 'object_key', 'drive_file_id',
]) {
  assert(!new RegExp(`\\b${key}\\s*:`, 'u').test(inputBlock), `forbidden input field: ${key}`);
}
assert(tools.includes('additionalProperties: false'), 'exact-object schema helper missing');
assert(expected.every((name) => new RegExp(`${name}: (?:exact|pagedInput)\\(`, 'u').test(inputBlock)), 'strict schema registry missing');
assert(tools.includes('maximum: STAFF_MCP_MAX_LIMIT'), 'list maximum missing');
assert(tools.includes('maxItems: 20'), 'payment draft batch bound missing');
assert(server.includes("aggregateType: 'MCP_TOOL_CALL'"), 'safe audit missing');
assert(server.includes("outcome: 'SUCCEEDED'"), 'success audit missing');
assert(server.includes("'AUDIT_UNAVAILABLE'"), 'audit fail-closed missing');
assert(server.includes('resolveAssignmentStaffAuthorization'), 'current Staff authorization resolution missing');
assert(server.includes('resolveStaffDataScope'), 'current Staff data scope resolution missing');
assert(!app.includes("'/mcp'"), 'public MCP endpoint must remain unregistered');

console.log(`Staff MCP security verifier passed: ${expected.length} Staff-only tools, no public endpoint.`);

function read(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

function assert(value, message) {
  if (!value) throw new Error(message);
}
