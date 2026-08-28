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
  it('retains the stage 3 clean baseline chain with the order instruction domain', () => {
    const migrations = readdirSync(join(root, 'migrations'))
      .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name))
      .sort();
    expect(migrations).toHaveLength(32);
    expect(migrations).toContain('0016_order_instructions.sql');
    expect(migrations.at(-1)).toBe('0032_stage75_public_service_channels.sql');
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

  it('exposes only Buyer-safe keyword text without the storage JSON field', () => {
    const contract = text('packages/contracts/src/order-instruction.ts');
    expect(contract).toMatch(/search_keywords:\s*readonly string\[\]/u);
    expect(contract).not.toMatch(/keyword_(?:text|raw)|search_keywords_json/u);
  });

  it('publishes new instructions without a keyword asset batch', () => {
    const publish = text('apps/api/src/order-instructions/publish.ts');
    const routes = text('apps/api/src/order-instructions/routes.ts');
    expect(publish).toContain('orderedKeywords');
    expect(publish).not.toContain('requireReadyAssets');
    expect(publish).not.toContain('assetBatchId');
    expect(routes).not.toMatch(/\['asset_batch_id',\s*'expected_version'\]/u);
  });

  it('completes the Staff work item in the unchanged-content publish transaction', () => {
    const publish = text('apps/api/src/order-instructions/publish.ts');
    const unchanged = publish.slice(
      publish.indexOf('if (current?.content_hash === contentHash)'),
      publish.indexOf('const nextVersionNo = source.current_version_no + 1'),
    );
    expect(unchanged).toContain('prepareWorkItemCompletionStatements');
    expect(unchanged).toContain('completeIdempotencyStatement');
    expect(unchanged).toContain('assertIdempotencyCompletionStatement');
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
