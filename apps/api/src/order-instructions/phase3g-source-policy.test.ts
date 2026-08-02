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
  it('retains 0021 and allows only the consecutive Wave 11 migrations after it', () => {
    const migrations = readdirSync(join(root, 'migrations'))
      .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name))
      .sort();
    expect(migrations.slice(-4)).toEqual([
      '0021_order_instructions.sql',
      '0022_review_submission_metadata.sql',
      '0023_seller_payables.sql',
      '0024_seller_payments_allocations.sql',
    ]);
    expect(migrations.some((name) => /^0025/u.test(name))).toBe(false);
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