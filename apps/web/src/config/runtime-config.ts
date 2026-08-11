const apiPathname = /^\/api\/(?!v2(?:\/|$))[a-z0-9][a-z0-9_./:-]*$/i;
const queryKey = /^[a-z][a-z0-9_]*$/i;

export function approvedApiPath(path: string): boolean {
  if (!path.startsWith('/api/') || path.includes('..') || path.includes('#')
    || /[\u0000-\u001f\u007f]/u.test(path)) return false;
  let parsed: URL;
  try {
    parsed = new URL(path, 'https://api-path.invalid');
  } catch {
    return false;
  }
  if (parsed.origin !== 'https://api-path.invalid'
    || !apiPathname.test(parsed.pathname)
    || `${parsed.pathname}${parsed.search}` !== path) return false;
  for (const [key, value] of parsed.searchParams) {
    if (!queryKey.test(key) || value.length > 500) return false;
  }
  return true;
}
