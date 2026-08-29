import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 7F-1 源码守卫：员工端不得重新引用已退役的旧布局类名与占位文案。
 * 清单只收录确认已清零的项；新增退役项时在对应提交中扩充本清单。
 */

const STAFF_DIR = import.meta.dirname;

function staffSourceFiles(dir: string = STAFF_DIR): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...staffSourceFiles(full));
    } else if (/\.tsx?$/u.test(entry) && !/\.test\./u.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

// 旧页面布局选择器（7F-1 起员工端清零；样式定义仍在 legacy 层服务未迁移页面）。
const RETIRED_LAYOUT_CLASSES = [
  'staff-panes',
  'frozen-w1',
  'staff-detail ',
  'customer-intake-workspace',
  'staff-task-queue',
  'staff-metric-card',
  'staff-workbench-heading',
  'staff-workbench-metrics',
  'staff-workbench-layout',
  'staff-order-filters',
  'staff-order-filter-grid',
  'staff-content-heading',
  'staff-business-shell',
  'staff-shell-body',
  'staff-main-content',
  'staff-work-area',
  'staff-nav-upcoming',
  'staff-nav-badge',
  'staff-sla-badge',
  'staff-recommended-row',
  'staff-round-icon',
];

// 占位与已退役业务入口文案（页面字符串中出现即失败）。
const RETIRED_TEXT = ['规划中', '可认领', '认领任务', '公共池', '获客中心', '抢任务'];

// 已退役的导航项 ID（staff-navigation 配置中出现即失败）。
const RETIRED_NAV_IDS = ['reviews-evidence', 'seller-settlements', 'archive', 'acquisition'];

const MATERIAL_SYMBOL_NAMES = [
  'dashboard',
  'groups',
  'storefront',
  'event_available',
  'receipt_long',
  'currency_exchange',
  'account_balance',
  'manage_accounts',
  'monitoring',
  'support_agent',
  'menu',
  'more_horiz',
  'add',
  'close',
  'settings',
  'search',
  'filter_alt',
  'person',
  'chevron_left',
  'chevron_right',
  'person_add',
  'task_alt',
  'warning',
  'inventory_2',
] as const;

describe('staff legacy source guard (7F-1)', () => {
  it('staff sources never reference retired layout class names', () => {
    const files = staffSourceFiles();
    expect(files.length).toBeGreaterThan(20);
    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const classNames = [...source.matchAll(/className="([^"]*)"/gu)].map((match) => match[1]!);
      for (const token of RETIRED_LAYOUT_CLASSES) {
        const name = token.trim();
        const usedInClass = classNames.some((value) => value.split(/\s+/u).includes(name));
        if (usedInClass) {
          violations.push(`${file}: ${name}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('staff sources never render placeholder or retired business text', () => {
    const violations: string[] = [];
    for (const file of staffSourceFiles().filter((path) => path.endsWith('.tsx'))) {
      const source = readFileSync(file, 'utf8');
      // staff-navigation.ts 的注释引用“规划中”说明退役语义，允许出现在注释里。
      const code = file.endsWith('staff-navigation.ts')
        ? source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gu, '')
        : source;
      for (const text of RETIRED_TEXT) {
        if (code.includes(`>${text}`) || code.includes(`'${text}'`) || code.includes(`"${text}"`)) {
          violations.push(`${file}: ${text}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('staff navigation never resurrects retired entries', () => {
    const source = readFileSync(join(STAFF_DIR, 'staff-navigation.ts'), 'utf8');
    for (const id of RETIRED_NAV_IDS) {
      expect(source, `nav id ${id}`).not.toContain(`id: '${id}'`);
    }
  });

  it('staff icons use local Material Symbols Rounded SVG twins without font ligatures', () => {
    const adapter = readFileSync(join(STAFF_DIR, '../ui/MoonwhiteIcon.tsx'), 'utf8');
    const staffReExport = readFileSync(join(STAFF_DIR, 'shared/MoonwhiteIcon.tsx'), 'utf8');
    const styles = readFileSync(join(STAFF_DIR, '../styles/staff-icons.css'), 'utf8');
    const assetsDir = join(STAFF_DIR, '../assets/material-symbols-rounded');
    const webAssetsDir = join(STAFF_DIR, '../assets');
    expect(adapter).toContain("import.meta.glob('../assets/material-symbols-rounded/*.svg'");
    expect(adapter).toContain("filled ? 'filled' : 'outline'");
    expect(adapter).toContain('viewBox="0 0 24 24"');
    expect(adapter).toContain('fill="currentColor"');
    expect(adapter).not.toContain('style=');
    expect(staffReExport).toContain("from '../../ui/MoonwhiteIcon'");
    expect(styles).not.toMatch(/@font-face|font-feature-settings|font-variation-settings|liga|material-symbols-rounded-staff\.ttf/u);
    expect(readdirSync(webAssetsDir)).not.toContain('material-symbols-rounded-staff.ttf');

    const svgAssets = readdirSync(assetsDir).filter((entry) => entry.endsWith('.svg'));
    expect(svgAssets).toHaveLength(MATERIAL_SYMBOL_NAMES.length * 2);
    for (const name of MATERIAL_SYMBOL_NAMES) {
      for (const variant of ['outline', 'filled'] as const) {
        const source = readFileSync(join(assetsDir, `${name}-${variant}.svg`), 'utf8');
        expect(source).toContain('aria-hidden="true"');
        expect(source).toContain('viewBox="0 0 24 24"');
        expect(source).toContain('fill="currentColor"');
        expect(source).toContain('matrix(0.025 0 0 0.025 0 24)');
        expect(source).toMatch(/<path\b[^>]*\bd="[^"]+"/u);
      }
    }

    const dashboardOutline = readFileSync(join(assetsDir, 'dashboard-outline.svg'), 'utf8');
    const dashboardFilled = readFileSync(join(assetsDir, 'dashboard-filled.svg'), 'utf8');
    expect(dashboardOutline).not.toBe(dashboardFilled);
  });

  it('buyer, seller, and shared UI sources use the same semantic adapter without Lucide', () => {
    const portalRoots = [
      join(STAFF_DIR, '../buyer'),
      join(STAFF_DIR, '../seller'),
      join(STAFF_DIR, '../ui'),
    ];
    const files: string[] = [];
    const visit = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) visit(full);
        else if (/\.tsx?$/u.test(entry) && !/\.test\./u.test(entry)) files.push(full);
      }
    };
    portalRoots.forEach(visit);
    const lucideFiles = files.filter((file) => readFileSync(file, 'utf8').includes('lucide-react'));
    expect(lucideFiles).toEqual([]);
    expect(readFileSync(join(STAFF_DIR, '../buyer/routes/BuyerFrame.tsx'), 'utf8')).toContain('MoonwhiteIcon');
    expect(readFileSync(join(STAFF_DIR, '../seller/routes/SellerLayout.tsx'), 'utf8')).toContain('MoonwhiteIcon');
    expect(readFileSync(join(STAFF_DIR, '../ui/primitives.tsx'), 'utf8')).toContain('MoonwhiteIcon');
  });

  it('staff typography exposes scoped hierarchy tokens and selectors', () => {
    const tokens = readFileSync(join(STAFF_DIR, '../styles/tokens.css'), 'utf8');
    const base = readFileSync(join(STAFF_DIR, '../styles/base.css'), 'utf8');
    const shell = readFileSync(join(STAFF_DIR, '../styles/staff-shell.css'), 'utf8');
    const pages = readFileSync(join(STAFF_DIR, '../styles/staff-pages.css'), 'utf8');

    for (const declaration of [
      '--staff-font-family:',
      '--staff-font-size-body: 15px',
      '--staff-font-size-nav: 15px',
      '--staff-font-size-group: 12px',
      '--staff-font-size-title: 32px',
      '--staff-font-size-title-mobile: 26px',
      '--staff-font-size-section: 18px',
      '--staff-font-size-task: 15px',
      '--staff-font-size-meta: 13px',
      '--staff-font-size-button: 15px',
      '--staff-font-weight-regular: 400',
      '--staff-font-weight-medium: 500',
      '--staff-font-weight-semibold: 600',
    ]) {
      expect(tokens, declaration).toContain(declaration);
    }

    expect(base).toContain('.staff-app {');
    expect(base).toContain('font-family: var(--staff-font-family);');
    expect(base).toContain('font-size: var(--staff-font-size-body);');
    expect(base).toContain('font-weight: var(--staff-font-weight-regular);');
    expect(base).toContain('-webkit-font-smoothing: subpixel-antialiased;');
    expect(shell).toContain('.staff-app .sa-nav__link');
    expect(shell).toContain('font-size: var(--staff-font-size-nav);');
    expect(shell).toContain('font-weight: var(--staff-font-weight-medium);');
    expect(shell).toContain('.staff-app .sa-nav__link.is-active');
    expect(shell).toContain('font-weight: var(--staff-font-weight-semibold);');
    expect(pages).toContain('.staff-app .sp-hello__title');
    expect(pages).toContain('font-size: var(--staff-font-size-title);');
    expect(pages).toContain('.staff-app .sp-workbench .sp-section-heading h2');
    expect(pages).toContain('font-size: var(--staff-font-size-section);');
    expect(pages).toContain('.staff-app .sp-workbench .sp-task-copy strong');
    expect(pages).toContain('font-size: var(--staff-font-size-task);');
  });
});
