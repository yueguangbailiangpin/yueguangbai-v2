const apiPathname = /^\/api\/(?!v2(?:\/|$))[a-z0-9][a-z0-9_./:-]*$/i;
const queryKey = /^[a-z][a-z0-9_]*$/i;

export type RuntimeConfig = Readonly<{ staffProviderOrigin: string }>;

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

export function runtimeConfig(environment: ImportMetaEnv = import.meta.env): RuntimeConfig {
  const candidate = environment['VITE_STAFF_PROVIDER_ORIGIN'] ?? 'https://open.feishu.cn';
  const url = new URL(candidate);
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('invalid_staff_provider_origin');
  }
  return Object.freeze({ staffProviderOrigin: url.origin });
}
