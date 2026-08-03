import type { Identity } from '../auth/session';

const allowed: Readonly<Record<Identity, readonly string[]>> = Object.freeze({
  buyer: ['/buyer'], seller: ['/seller'], staff: ['/staff'],
});

export function safeReturnPath(value: string | null, identity: Identity): string {
  if (value === null || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return allowed[identity][0] ?? '/';
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin || !allowed[identity].some((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`))) return allowed[identity][0] ?? '/';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return allowed[identity][0] ?? '/'; }
}
