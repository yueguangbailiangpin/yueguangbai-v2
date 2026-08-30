#!/usr/bin/env node
// Stage 7F-4 local-only CSS ownership and dead-rule guard.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB_ROOT = join(ROOT, 'apps/web');
const SOURCE_ROOT = join(WEB_ROOT, 'src');
const STYLE_ROOT = join(SOURCE_ROOT, 'styles');
const ICON_ROOT = join(SOURCE_ROOT, 'assets/material-symbols-rounded');
const MAIN_FILE = join(SOURCE_ROOT, 'main.tsx');

const RETIRED_ENTRIES = Object.freeze([
  'global.css',
  'design-freeze.css',
  'staff-shell-v2.css',
]);
const EXPECTED_IMPORTS = Object.freeze([
  'tokens.css',
  'portal-compat.css',
  'buyer-portal.css',
  'seller-portal.css',
  'base.css',
  'primitives.css',
  'staff-shell.css',
  'staff-pages.css',
  'staff-icons.css',
]);
const RETIRED_SELECTOR_TOKENS = new Set([
  'action-group',
  'business-completion-grid',
  'buyer-brand-bar',
  'buyer-brand-inner',
  'buyer-content',
  'buyer-main',
  'buyer-more-note',
  'buyer-partial-error',
  'buyer-product-action',
  'buyer-product-card',
  'buyer-product-card-detailed',
  'buyer-product-grid',
  'buyer-product-heading',
  'buyer-product-meta',
  'buyer-security-tools',
  'buyer-task-card',
  'codex-boundary-grid',
  'compact-list',
  'compact-row',
  'customer-handoff-strip',
  'customer-intake-grid',
  'dashboard-funnel',
  'dashboard-two-column',
  'desktop-table',
  'entry-trust-note',
  'filter-bar',
  'frozen-w1',
  'handoff-chip',
  'invitation-status',
  'mobile-list',
  'narrow-only',
  'product-version-summary',
  'section-heading',
  'seller-attention-card',
  'seller-attention-list',
  'seller-business-completion',
  'seller-context-bar',
  'seller-context-member',
  'seller-context-summary',
  'seller-list-card',
  'seller-main',
  'seller-metrics',
  'seller-mobile-brand',
  'seller-primary-nav',
  'seller-shell',
  'seller-side-navigation',
  'seller-sidebar',
  'seller-sidebar-brand',
  'seller-sidebar-member',
  'seller-store-selector',
  'seller-topbar',
  'seller-work-area',
  'seller-workspace',
  'staff-access-counts',
  'staff-access-section-title',
  'staff-account-actions',
  'staff-business-shell',
  'staff-context-bar',
  'staff-customer-heading',
  'staff-customer-security',
  'staff-detail',
  'staff-effect-timeline',
  'staff-effect-timeline-badge',
  'staff-effect-timeline-empty',
  'staff-effect-timeline-kind',
  'staff-effect-timeline-next',
  'staff-effect-timeline-state',
  'staff-fact',
  'staff-finance-market-group',
  'staff-finance-workspace',
  'staff-invitation-grid',
  'staff-invitation-link',
  'staff-invite-card',
  'staff-main',
  'staff-mobile-brand',
  'staff-nav-section',
  'staff-nav-section-label',
  'staff-order-detail',
  'staff-order-progress-grid',
  'staff-panes',
  'staff-primary-nav',
  'staff-queue',
  'staff-queue-footnote',
  'staff-refunds',
  'staff-role-editor',
  'staff-session-context',
  'staff-sidebar',
  'staff-sidebar-brand',
  'staff-sidebar-person',
  'staff-task-queue',
  'staff-task-row',
  'staff-today-completed',
  'staff-topbar-search',
  'staff-work-area',
  'staff-work-item',
  'staff-work-item-heading',
  'staff-work-list',
  'wide-only',
  'work-content',
  'work-shell',
]);

const DYNAMIC_CLASS_VALUES = new Set([
  'identity-buyer',
  'identity-seller',
  'identity-staff',
  'alert-info',
  'alert-success',
  'alert-warning',
  'alert-danger',
  'toast-info',
  'toast-success',
  'toast-danger',
  'status-neutral',
  'status-processing',
  'status-success',
  'status-warning',
  'status-danger',
  'status-expired',
  'status-conflict',
  'buyer-task-urgent',
  'buyer-task-action',
  'buyer-task-system',
]);

const DYNAMIC_SOURCE_MARKERS = Object.freeze([
  'identity-',
  'alert-',
  'toast-',
  'status-',
  'buyer-task-',
]);

function walkFiles(directory, predicate) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      files.push(...walkFiles(full, predicate));
    } else if (predicate(full, entry)) {
      files.push(full);
    }
  }
  return files;
}

function normalize(value) {
  return value.replace(/\s+/gu, ' ').trim();
}

function ruleContext(node) {
  const parents = [];
  for (let parent = node.parent; parent && parent.type !== 'root'; parent = parent.parent) {
    if (parent.type === 'atrule') {
      parents.unshift(normalize(parent.name + ' ' + (parent.params ?? '')));
    }
  }
  return parents.join('>');
}

function isInsideKeyframes(node) {
  for (let parent = node.parent; parent && parent.type !== 'root'; parent = parent.parent) {
    if (parent.type === 'atrule' && /keyframes$/iu.test(parent.name)) return true;
  }
  return false;
}

function ruleKey(node) {
  const declarations = (node.nodes ?? [])
    .filter((child) => child.type === 'decl')
    .map((child) => normalize(child.prop + ':' + child.value + (child.important ? '!important' : '')))
    .join(';');
  return ruleContext(node) + '\n' + normalize(node.selector ?? '') + '\n' + declarations;
}

function classTokensFromSelector(selector) {
  return [...(selector ?? '').matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/gu)].map((match) => match[1]);
}

function classTokensFromAst(root) {
  const classes = new Set();
  root.walkRules((rule) => {
    for (const token of classTokensFromSelector(rule.selector)) classes.add(token);
  });
  return classes;
}

function productionSourceReference(source, token) {
  const escaped = token.replace(/[.*+?^$()|[\]\\]/gu, '\\$&');
  return new RegExp('(^|[^A-Za-z0-9_-])' + escaped + '($|[^A-Za-z0-9_-])', 'u').test(source);
}

function assert(condition, message, failures) {
  if (condition) return;
  failures.push(message);
  console.error('✗ ' + message);
}

const failures = [];
const styleFiles = walkFiles(STYLE_ROOT, (_full, entry) => entry.endsWith('.css')).sort();
const sourceFiles = walkFiles(
  SOURCE_ROOT,
  (_full, entry) => /\.(ts|tsx)$/u.test(entry) && !/\.(test|spec)\./u.test(entry),
).sort();
const sourceText = sourceFiles.map((file) => readFileSync(file, 'utf8')).join('\n');
const mainText = readFileSync(MAIN_FILE, 'utf8');
const styleTexts = new Map(styleFiles.map((file) => [file, readFileSync(file, 'utf8')]));
const styleRoots = new Map(styleFiles.map((file) => [file, postcss.parse(styleTexts.get(file), { from: file })]));

const imports = [...mainText.matchAll(/import\s+['"]\.\/styles\/([^'"]+)['"];?/gu)].map((match) => match[1]);
assert(
  JSON.stringify(imports) === JSON.stringify(EXPECTED_IMPORTS),
  'main.tsx CSS import order must be the canonical 7F-4 order',
  failures,
);
for (const entry of RETIRED_ENTRIES) {
  assert(!existsSync(join(STYLE_ROOT, entry)), 'retired stylesheet must not exist: ' + entry, failures);
  assert(!mainText.includes(entry), 'retired stylesheet must not be named by main.tsx: ' + entry, failures);
  for (const [file, text] of styleTexts) {
    assert(!text.includes(entry), 'retired stylesheet name remains in ' + relative(ROOT, file) + ': ' + entry, failures);
  }
}

for (const [file, text] of styleTexts) {
  assert(!text.includes('--mw-'), 'legacy --mw-* token source remains in ' + relative(ROOT, file), failures);
}

const portalCompat = join(STYLE_ROOT, 'portal-compat.css');
const staffPages = join(STYLE_ROOT, 'staff-pages.css');
const portalClasses = classTokensFromAst(styleRoots.get(portalCompat));
for (const token of RETIRED_SELECTOR_TOKENS) {
  assert(!portalClasses.has(token), 'retired selector token returned to portal-compat.css: ' + token, failures);
}
const unreferencedPortalClasses = [...portalClasses].filter(
  (token) => !productionSourceReference(sourceText, token) && !DYNAMIC_CLASS_VALUES.has(token),
);
assert(
  unreferencedPortalClasses.length === 0,
  'portal-compat.css has unproved class selectors: ' + unreferencedPortalClasses.sort().join(', '),
  failures,
);

for (const marker of DYNAMIC_SOURCE_MARKERS) {
  assert(sourceText.includes(marker), 'dynamic class family source marker is missing: ' + marker, failures);
}
const maintainedClasses = new Set();
for (const root of styleRoots.values()) {
  for (const token of classTokensFromAst(root)) maintainedClasses.add(token);
}
const dynamicBaseRequirements = [
  'buyer-task-row',
  'buyer-task-urgent',
  'buyer-task-system',
  'alert',
  'alert-info',
  'alert-success',
  'alert-warning',
  'alert-danger',
  'status-badge',
  'status-neutral',
  'status-processing',
  'status-success',
  'status-warning',
  'status-danger',
  'status-expired',
  'status-conflict',
  'identity-buyer',
  'identity-seller',
  'identity-staff',
  'toast',
  'toast-success',
  'toast-danger',
];
for (const token of dynamicBaseRequirements) {
  assert(maintainedClasses.has(token), 'dynamic/current class family lost maintained CSS: ' + token, failures);
}
for (const token of ['staff-order-evidence-grid', 'staff-ref-section', 'staff-ref-danger']) {
  assert(classTokensFromAst(styleRoots.get(staffPages)).has(token), 'Staff page ownership missing: ' + token, failures);
}

const duplicateRules = new Map();
for (const [file, root] of styleRoots) {
  root.walkRules((rule) => {
    if (isInsideKeyframes(rule)) return;
    const key = ruleKey(rule);
    const prior = duplicateRules.get(key);
    if (prior) {
      assert(
        false,
        'exact same-context CSS rule is owned twice: ' +
          relative(ROOT, prior.file) +
          ':' +
          prior.line +
          ' and ' +
          relative(ROOT, file) +
          ':' +
          rule.source?.start?.line,
        failures,
      );
    } else {
      duplicateRules.set(key, { file, line: rule.source?.start?.line ?? 0 });
    }
  });
}

const WINDOW_LINES = 256;
for (const file of styleFiles) {
  const lines = styleTexts.get(file).split('\n');
  const seen = new Map();
  let duplicate = null;
  for (let index = 0; index + WINDOW_LINES <= lines.length; index += 1) {
    const window = lines.slice(index, index + WINDOW_LINES).join('\n');
    const hash = createHash('sha256').update(window).digest('hex');
    const prior = seen.get(hash);
    if (prior !== undefined && index - prior >= WINDOW_LINES) {
      duplicate = { earlier: prior + 1, later: index + 1 };
      break;
    }
    if (prior === undefined) seen.set(hash, index);
  }
  assert(
    duplicate === null,
    'CSS contains a 256-line exact duplicate block: ' +
      relative(ROOT, file) +
      ' lines ' +
      duplicate?.later +
      '–' +
      (duplicate ? duplicate.later + WINDOW_LINES - 1 : ''),
    failures,
  );
}

const iconFiles = readdirSync(ICON_ROOT).filter((entry) => entry.endsWith('.svg'));
const iconBases = [...new Set(iconFiles.map((entry) => entry.replace(/-(outline|filled)\.svg$/u, '')))].sort();
assert(iconBases.length >= 20, 'local Material Symbols Rounded SVG inventory is unexpectedly small', failures);
for (const base of iconBases) {
  assert(iconFiles.includes(base + '-outline.svg'), 'missing local outline icon twin: ' + base, failures);
  assert(iconFiles.includes(base + '-filled.svg'), 'missing local filled icon twin: ' + base, failures);
}
const iconAdapter = readFileSync(join(SOURCE_ROOT, 'ui/MoonwhiteIcon.tsx'), 'utf8');
assert(iconAdapter.includes('material-symbols-rounded/*.svg'), 'local Material Symbols adapter glob is missing', failures);
assert(iconAdapter.includes("filled' : 'outline"), 'Material Symbols outline/filled adapter is missing', failures);
assert(!sourceText.includes('lucide-react'), 'Lucide dependency returned to production web source', failures);

console.log(
  JSON.stringify(
    {
      status: failures.length === 0 ? 'PASS' : 'FAIL',
      css_files: styleFiles.map((file) => relative(ROOT, file)),
      canonical_imports: imports,
      portal_compat_classes: portalClasses.size,
      production_source_files: sourceFiles.length,
      dynamic_families: DYNAMIC_SOURCE_MARKERS,
      local_material_symbol_bases: iconBases.length,
      exact_rule_keys_checked: duplicateRules.size,
      failures,
    },
    null,
    2,
  ),
);
if (failures.length > 0) process.exit(1);
