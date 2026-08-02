import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
function text(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}
function allFiles(directory: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(join(root, directory))) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const relative = join(directory, entry);
    if (statSync(join(root, relative)).isDirectory()) result.push(...allFiles(relative));
    else result.push(relative);
  }
  return result;
}

describe('Phase 3G static source policy', () => {
  it('publishes no 0022 migration', () => {
    expect(readdirSync(join(root, 'migrations')).some((name) => /^0022/u.test(name))).toBe(false);
  });

  it('does not use public/claimable/unassigned work items', () => {
    const source = allFiles('apps/api/src/order-instructions')
      .filter((name) => !name.endsWith('.test.ts'))
      .map(text).join('\n');
    expect(source).not.toMatch(/['"](?:PUBLIC|CLAIMABLE|UNASSIGNED)['"]/u);
  });

  it('does not use TASK_CLAIM in the new module', () => {
    const source = allFiles('apps/api/src/order-instructions')
      .filter((name) => !name.endsWith('.test.ts'))
      .map(text).join('\n');
    expect(source).not.toMatch(/['"]TASK_CLAIM['"]/u);
  });

  it('does not expose object keys in instruction DTO contracts', () => {
    expect(text('packages/contracts/src/order-instruction.ts')).not.toContain('object_key');
  });

  it('does not expose keyword text in instruction DTO contracts', () => {
    expect(text('packages/contracts/src/order-instruction.ts')).not.toMatch(
      /keyword_(?:text|raw)|search_keywords/u,
    );
  });

  it('allows only PNG output from the generator', () => {
    const contract = text('packages/contracts/src/order-instruction.ts');
    expect(contract).toContain("mime: 'image/png'");
    expect(contract).not.toContain("mime: 'image/svg+xml'");
  });

  it('contains no bundled font binaries', () => {
    const roots = ['apps', 'packages', 'scripts', 'migrations'];
    expect(roots.flatMap(allFiles).some((name) => /\.(?:ttf|otf|woff2?)$/iu.test(name))).toBe(false);
  });
});
