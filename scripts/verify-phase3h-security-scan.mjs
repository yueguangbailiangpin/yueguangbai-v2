import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const files = walk(path.join(root, 'apps/api/src'))
  .filter((file) => /\.(ts|tsx)$/u.test(file));
const violations = [];
for (const file of files) {
  const relative = path.relative(root, file);
  const text = readFileSync(file, 'utf8');
  if (relative.includes('staff-assignment') && /TASK_(CLAIM|VIEW_OPEN)/u.test(text)) {
    violations.push(`${relative}: legacy public task permission`);
  }
  if (relative.endsWith('staff-assignment/routes.ts')
    && /(seller_organization_ids|store_ids|resource_scope_json)/u.test(text)) {
    violations.push(`${relative}: client scope authority`);
  }
}
const migrationNames = readdirSync(path.join(root, 'migrations'));
if (migrationNames.some((name) => /^002[1-9]_/u.test(name) || /^00[3-9][0-9]_/u.test(name))) {
  violations.push('migration 0021 or higher exists');
}
if (violations.length) throw new Error(violations.join('\n'));
console.log(JSON.stringify({ status: 'PASS', violations: 0 }, null, 2));
function walk(dir) { return readdirSync(dir).flatMap((name) => {
  const full = path.join(dir, name); return statSync(full).isDirectory() ? walk(full) : [full];
}); }
