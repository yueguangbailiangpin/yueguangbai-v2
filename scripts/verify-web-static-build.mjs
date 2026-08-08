import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'apps/web/dist');
const webSource = path.join(root, 'apps/web/src');
const indexPath = path.join(dist, 'index.html');
if (!existsSync(indexPath)) throw new Error('web_dist_index_missing');
const files = walk(dist);
if (files.some((file) => file.endsWith('.map'))) {
  throw new Error('production_source_map_forbidden');
}
const html = readFileSync(indexPath, 'utf8');
if (/https?:\/\//iu.test(html)) throw new Error('external_asset_origin_forbidden');
const references = [...html.matchAll(/(?:src|href)="([^"]+)"/gu)]
  .map((match) => match[1])
  .filter((value) => value.startsWith('/'));
for (const reference of references) {
  const target = path.join(dist, reference.replace(/^\//u, ''));
  if (!existsSync(target)) throw new Error(`missing_static_asset:${reference}`);
}
const jsxInlineStyles = walk(webSource)
  .filter((file) => /\.[jt]sx$/u.test(file))
  .filter((file) => /\bstyle\s*=/u.test(readFileSync(file, 'utf8')));
if (jsxInlineStyles.length > 0) {
  throw new Error('jsx_inline_style_forbidden');
}
console.log(JSON.stringify({
  status: 'PASS',
  index: 'present',
  source_maps: 0,
  referenced_assets: references.length,
  jsx_inline_styles: 0,
  files: files.length,
  external_calls: 0,
}, null, 2));

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}
