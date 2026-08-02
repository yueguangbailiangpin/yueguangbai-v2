import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
function walk(directory: string): string[] {
  const absolute = join(root, directory);
  if (!existsSync(absolute)) return [];
  if (!statSync(absolute).isDirectory()) return [directory];
  return readdirSync(absolute).flatMap((name) => walk(join(directory, name)));
}

describe('seller self-pay isolation', () => {
  const sellerFiles = [
    'apps/api/src/seller-portal',
    'apps/api/src/seller-formal-orders',
    'apps/api/src/seller-reviews',
    'packages/contracts/src/seller-portal.ts',
  ].flatMap((path) => walk(path));
  const source = sellerFiles
    .filter((path) => /\.(?:ts|tsx)$/u.test(path)
      && !/\.test\.(?:ts|tsx)$/u.test(path))
    .map((path) => readFileSync(join(root, path), 'utf8'))
    .join('\n');

  it.each([
    'buyer_self_pay',
    'buyer_refundable_principal',
    'buyer_self_pay_contribution',
    'buyer_expected_principal_cny_fen',
  ])('excludes %s', (field) => {
    expect(source).not.toContain(field);
  });
});
