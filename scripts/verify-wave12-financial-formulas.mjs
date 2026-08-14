import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const testFile = 'apps/api/src/internal-finance/wave12-financial-formula-equivalence.test.ts';
const result = spawnSync(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['exec', 'vitest', 'run', testFile],
  { cwd: root, stdio: 'inherit' },
);
if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(`financial formula behavior test failed with exit ${result.status}`);
}
console.log(JSON.stringify({
  status: 'PASS',
  executable_behavior_equivalence: true,
  production_view: 'internal_order_finance_positions',
  domain_module: 'packages/domain/src/finance/calculations.ts',
  cases: ['zero', 'partial', 'reversal', 'overpayment', 'integer-boundary'],
}, null, 2));
