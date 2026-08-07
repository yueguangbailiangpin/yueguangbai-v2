import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const vitest = resolve(root, 'node_modules/vitest/vitest.mjs');
const result = spawnSync(process.execPath, [
  vitest,
  'run',
  'apps/api/src/staff-mcp/staff-mcp.test.ts',
  '-t',
  'conforms to initialize/tools/list/tools/call',
], {
  cwd: root,
  encoding: 'utf8',
  env: {
    ...process.env,
    STAFF_MCP_ENABLED: 'true',
    STAFF_MCP_LOCAL_MOCK_ENABLED: 'true',
  },
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.status !== 0) process.exit(result.status ?? 1);
console.log('Staff MCP local dry-run passed; no external provider or network call was used.');
