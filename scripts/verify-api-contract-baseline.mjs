// Stage 4 API contract baseline verifier (D-054).
//
// The stage 3 version of this script derived its change scope from
// `git diff origin/main`, which both missed real contract changes while the
// local branch was ahead of its remote and could only pass after a push. The
// rebuilt verifier instead anchors on the committed artifacts themselves:
//
//   1. docs/contracts/V2_API_ROUTE_INVENTORY.md must not declare retired or
//      forbidden route families (machine acquisition, Staff MCP, keyword
//      images, Feishu, Rakuten/TikTok preparation, /api/v2 aliases);
//   2. the documented endpoint set must be duplicate-free and internally
//      consistent with its own stated totals;
//   3. bidirectional runtime↔inventory equality is enforced by the vitest
//      architecture guard `api-contract-baseline-alignment.test.ts`, which
//      loads the real Hono app and runs in `npm run verify:api-contract`.
//
// No git history or remote state participates in the decision, so the check
// is stable for a local-only branch that is ahead of origin.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const inventoryPath = path.join(root, 'docs/contracts/V2_API_ROUTE_INVENTORY.md');
const inventory = readFileSync(inventoryPath, 'utf8');

const documented = inventory
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => /^(GET|POST|PUT|PATCH|DELETE)\s+\//u.test(line));

const failures = [];
if (documented.length === 0) failures.push('route inventory declares no endpoints');
const duplicates = documented.filter((route, index) => documented.indexOf(route) !== index);
if (duplicates.length > 0) failures.push(`duplicate inventory entries: ${duplicates.join(', ')}`);

const forbiddenPatterns = [
  [/\/api\/v2\//u, '/api/v2 alias'],
  [/acquisition-machine/u, 'machine acquisition runtime'],
  [/acquisition\/funnel/u, 'machine-era acquisition funnel'],
  [/acquisition\/handoffs/u, 'machine-era acquisition handoffs'],
  [/acquisition\/reporting-config/u, 'machine attribution reporting config'],
  [/admin-business-dashboard\/(drill-down|trends|acquisition-daily)/u, 'retired dashboard drill-down/trend/daily surface'],
  [/staff-mcp/u, 'Staff MCP transport'],
  [/keyword-image|order-instructions\/[^/]+\/assets/u, 'keyword image assets'],
  [/feishu/u, 'Feishu runtime'],
  [/rakuten|tiktok/u, 'Rakuten/TikTok preparation routes'],
  [/platform-formal-orders|platform-order-evidence/u, 'platform_* parallel order model'],
];
// Forbidden families are checked against declared endpoint lines only — the
// prose may legitimately mention a retired family while explaining the rule.
for (const [pattern, label] of forbiddenPatterns) {
  const offending = documented.filter((route) => pattern.test(route));
  if (offending.length > 0) failures.push(`inventory still declares ${label}: ${offending.join(', ')}`);
}

const totalMatch = inventory.match(/现有 (\d+) 个唯一端点：(\d+) 个 `\/api\/\*`/u);
if (!totalMatch) {
  failures.push('inventory header must state the unique endpoint and /api/* totals');
} else {
  const total = Number(totalMatch[1]), api = Number(totalMatch[2]);
  if (documented.length !== total) {
    failures.push(`header total ${total} != documented ${documented.length} endpoints`);
  }
  const apiCount = documented.filter((route) => route.includes(' /api/')).length;
  if (apiCount !== api) {
    failures.push(`header /api/* total ${api} != documented ${apiCount}`);
  }
}

if (failures.length > 0) {
  throw new Error(`API contract baseline verification failed:\n- ${failures.join('\n- ')}`);
}

console.log(
  `API contract baseline clean: ${documented.length} documented endpoints ` +
  `(${documented.filter((route) => route.includes(' /api/')).length} /api/*), ` +
  'no retired route families, no duplicates; runtime equality is enforced by ' +
  'api-contract-baseline-alignment.test.ts.',
);
