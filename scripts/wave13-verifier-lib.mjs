import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export const root = path.resolve(import.meta.dirname, '..');
export function read(relative) {
  return readFileSync(path.join(root, relative), 'utf8');
}
export function filesUnder(relative, predicate = () => true) {
  const start = path.join(root, relative);
  const output = [];
  const visit = (current) => {
    for (const name of readdirSync(current)) {
      const absolute = path.join(current, name);
      if (statSync(absolute).isDirectory()) visit(absolute);
      else if (predicate(absolute)) output.push(absolute);
    }
  };
  visit(start);
  return output;
}
export function relative(absolute) {
  return path.relative(root, absolute).replaceAll(path.sep, '/');
}
export function assert(condition, message) {
  if (!condition) throw new Error(message);
}
export function assertContains(text, value, label) {
  assert(text.includes(value), `${label}: missing ${value}`);
}
export function assertNotContains(text, value, label) {
  assert(!text.includes(value), `${label}: forbidden ${value}`);
}
export function sourceFiles() {
  return filesUnder('.', (absolute) => /\.(?:ts|mjs|sql|md|json)$/u.test(absolute));
}
export function report(name, details) {
  console.log(JSON.stringify({ status: 'PASS', verifier: name, ...details }, null, 2));
}
