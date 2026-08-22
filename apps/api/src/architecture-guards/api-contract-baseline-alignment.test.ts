import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACQUISITION_HTTP_PATHS,
  ADMIN_BUSINESS_DASHBOARD_PATHS,
  BUYER_SELF_REGISTRATION_HTTP_PATHS,
  CUSTOMER_SECURITY_HTTP_PATHS,
  CUSTOMER_AUTH_HTTP_PATHS,
  FILE_HTTP_LIFECYCLE_PATHS,
  FILE_HTTP_PURPOSE_ROUTES,
  MARKETPLACE_FOUNDATION_HTTP_PATHS,
  SELLER_FORMAL_ORDER_PORTAL_HTTP_PATHS,
  SELLER_ORDER_CHAT_SCREENSHOT_HTTP_PATHS,
  SELLER_PORTAL_HTTP_PATHS,
  SELLER_REVIEW_PORTAL_HTTP_PATHS,
  STAFF_AUTH_PATHS,
  STAFF_BUYER_REFUND_PATHS,
  STAFF_ORDER_EVIDENCE_PATHS,
} from '@ygb/contracts';
import app from '../index';

const root = path.resolve(process.cwd());
const inventoryPath = path.join(root, 'docs/contracts/V2_API_ROUTE_INVENTORY.md');
const methods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

function normalizeRoutePath(value: string): string {
  return value.endsWith('/') && value !== '/' ? value.slice(0, -1) : value;
}

function registeredRoutes(): string[] {
  const entries = app.routes
    .map((route) => `${route.method.toUpperCase()} ${normalizeRoutePath(route.path)}`)
    .filter((route) => methods.has(route.slice(0, route.indexOf(' '))));
  const blocks: string[] = [];
  for (const entry of entries) if (blocks.at(-1) !== entry) blocks.push(entry);
  return blocks;
}

function documentedRoutes(): string[] {
  return readFileSync(inventoryPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^(GET|POST|PUT|PATCH|DELETE)\s+\//u.test(line));
}

function stringsDeep(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsDeep);
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(stringsDeep);
  }
  return [];
}

function productionWebFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionWebFiles(entryPath);
    if (!/\.(ts|tsx)$/u.test(entry.name) || /\.test\./u.test(entry.name)) return [];
    return [entryPath];
  });
}

describe('API contract baseline alignment', () => {
  it('matches the documented inventory to the default app route table', () => {
    const actual = registeredRoutes().sort();
    const documented = documentedRoutes().sort();
    expect(new Set(actual).size, 'non-contiguous duplicate registration').toBe(actual.length);
    expect(documented, 'route inventory drift').toEqual(actual);
    expect(actual).toHaveLength(254);
    expect(actual.filter((route) => route.startsWith('GET /api/'))).not.toHaveLength(0);
    expect(actual.some((route) => route.includes('/api/v2/'))).toBe(false);
  });

  it('keeps every shared HTTP path constant registered', () => {
    const constants = [
      ACQUISITION_HTTP_PATHS,
      ADMIN_BUSINESS_DASHBOARD_PATHS,
      CUSTOMER_AUTH_HTTP_PATHS,
      BUYER_SELF_REGISTRATION_HTTP_PATHS,
      CUSTOMER_SECURITY_HTTP_PATHS,
      STAFF_AUTH_PATHS,
      SELLER_PORTAL_HTTP_PATHS,
      SELLER_FORMAL_ORDER_PORTAL_HTTP_PATHS,
      SELLER_ORDER_CHAT_SCREENSHOT_HTTP_PATHS,
      SELLER_REVIEW_PORTAL_HTTP_PATHS,
      STAFF_ORDER_EVIDENCE_PATHS,
      STAFF_BUYER_REFUND_PATHS,
      FILE_HTTP_PURPOSE_ROUTES,
      FILE_HTTP_LIFECYCLE_PATHS,
      MARKETPLACE_FOUNDATION_HTTP_PATHS,
    ];
    const actual = new Set(registeredRoutes());
    const missing = stringsDeep(constants)
      .filter((value) => value.startsWith('/api/'))
      .filter((value) => ![...actual].some((route) => route.endsWith(` ${value}`)))
      .sort();
    expect(missing).toEqual([]);
  });

  it('keeps production frontend adapter paths inside the registered API boundary', () => {
    const actual = new Set(registeredRoutes());
    const files = [
      path.join(root, 'apps/web/src/api'),
      path.join(root, 'apps/web/src/buyer/api'),
      path.join(root, 'apps/web/src/auth'),
      path.join(root, 'apps/web/src/files'),
      path.join(root, 'apps/web/src/buyer/registration'),
      path.join(root, 'apps/web/src/staff'),
    ].flatMap(productionWebFiles);
    const candidates = files.flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return [...source.matchAll(/['`](\/api\/[^'`"?]*)/gu)].flatMap((match) => (
        match[1] ? [match[1]] : []
      ));
    }).filter((candidate) => candidate !== '/api/' && !candidate.includes('/api/v2'));
    const missing = candidates
      .filter((candidate) => !candidate.includes('${'))
      .filter((candidate) => ![...actual].some((route) => {
        const pathName = route.slice(route.indexOf(' ') + 1);
        return pathName === candidate || pathName.startsWith(`${candidate}/`);
      }))
      .sort();
    expect(missing).toEqual([]);
  });

  it('keeps live contract documentation on /api and cursor semantics', () => {
    const conventions = readFileSync(path.join(root, 'docs/contracts/V2_API_CONVENTIONS.md'), 'utf8');
    const codeBlocks = [...conventions.matchAll(/```[\s\S]*?```/gu)].map((match) => match[0]).join('\\n');
    expect(codeBlocks).not.toContain('/api/v2');
    expect(codeBlocks).not.toContain('page_size');
    expect(codeBlocks).not.toContain('total_pages');
    expect(conventions).toContain('cursor');
    expect(conventions).toContain('next_cursor');
  });
});
