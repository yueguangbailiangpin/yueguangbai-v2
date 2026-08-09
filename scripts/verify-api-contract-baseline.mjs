import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { resolveChangeRoot } from './verifier-utils.mjs';

const repo = process.cwd();
const tracked = execFileSync('git', ['diff', '--name-only', 'origin/main', '--'], {
  cwd: repo,
  encoding: 'utf8',
}).trim().split('\n').filter(Boolean);
const untracked = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
  cwd: repo,
  encoding: 'utf8',
}).split('\n').filter((line) => line.startsWith('?? ')).map((line) => line.slice(3));
const changed = [...new Set([...tracked, ...untracked])].sort();

const allowed = new Set([
  'package.json',
  'docs/contracts/V2_API_CONVENTIONS.md',
  'docs/contracts/V2_API_ROUTE_INVENTORY.md',
  'apps/api/src/api-contract-baseline-alignment.test.ts',
  'scripts/verify-api-contract-baseline.mjs',
  'openspec/specs/api-contract-governance/spec.md',
]);
const changeRoot = `${path.relative(
  repo,
  resolveChangeRoot('api-contract-baseline-alignment', repo),
).split(path.sep).join('/')}/`;
const unexpected = changed.filter((file) => !allowed.has(file)
  && !file.startsWith(changeRoot));
if (unexpected.length) {
  throw new Error(`API contract baseline must not change runtime/schema/dependencies: ${unexpected.join(', ')}`);
}

const forbidden = changed.filter((file) => /^(migrations\/|package-lock\.json$|apps\/api\/src\/(?!api-contract-baseline-alignment\.test\.ts)|packages\/contracts\/src\/|apps\/web\/src\/)/u.test(file));
if (forbidden.length) {
  throw new Error(`Forbidden behavior/schema/dependency change: ${forbidden.join(', ')}`);
}

console.log(`API contract baseline scope clean (${changed.length} changed paths; no migrations, route registration, business contracts, adapters, or dependencies).`);
