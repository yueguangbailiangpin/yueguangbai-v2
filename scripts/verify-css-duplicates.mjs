#!/usr/bin/env node
// Static anti-regression gate: reject large byte-identical duplicate CSS
// blocks from re-entering the repository. Stage 7 accidentally appended the
// same 3,280-line stylesheet three times into global.css (≈9,840 redundant
// lines); this check fails if any tracked stylesheet ever contains two or
// more exact copies of a ≥256-line region again.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const STYLE_ROOT = fileURLToPath(new URL('../apps/web/src/styles/', import.meta.url));
const WINDOW_LINES = 256;
const IGNORED_FILES = new Set([]);

function listCssFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...listCssFiles(full));
    } else if (entry.endsWith('.css') && !IGNORED_FILES.has(entry)) {
      files.push(full);
    }
  }
  return files;
}

let failures = 0;
for (const file of listCssFiles(STYLE_ROOT)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  const seen = new Map();
  let duplicate = null;
  outer: for (let i = 0; i + WINDOW_LINES <= lines.length; i += 1) {
    const window = lines.slice(i, i + WINDOW_LINES).join('\n');
    const hash = createHash('sha256').update(window).digest('hex');
    const earlier = seen.get(hash);
    if (earlier === undefined) {
      seen.set(hash, i);
      continue;
    }
    if (i - earlier >= WINDOW_LINES) {
      duplicate = { earlier: earlier + 1, later: i + 1 };
      break outer;
    }
  }
  if (duplicate) {
    failures += 1;
    console.error(
      `✗ ${file}: lines ${duplicate.later}–${duplicate.later + WINDOW_LINES - 1} ` +
        `duplicate lines ${duplicate.earlier}–${duplicate.earlier + WINDOW_LINES - 1} ` +
        `(${WINDOW_LINES}+ identical lines)`,
    );
  } else {
    console.log(`✓ ${file}: no ${WINDOW_LINES}+ line exact duplicate blocks`);
  }
}

if (failures > 0) {
  console.error(
    `verify-css-duplicates: ${failures} stylesheet(s) contain large exact duplicate blocks; ` +
      'remove the redundant copies (keep one) before committing.',
  );
  process.exit(1);
}
