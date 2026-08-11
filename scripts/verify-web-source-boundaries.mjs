import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const productionFile = /\.(?:css|ts|tsx)$/u;
const testFile = /\.(?:test|spec)\.(?:ts|tsx)$/u;
const globalRules = Object.freeze([
  ['legacy_api_version', /\/api\/v2/u],
  ['browser_cookie_access', /document\.cookie/u],
  ['browser_storage', /\b(?:localStorage|sessionStorage)\b/u],
  ['unsafe_html', /dangerouslySetInnerHTML/u],
  ['storage_key_dto', /\b(?:object_key|permanent_url|signed_url)\b/u],
  ['api_source_import', /from ['"][^'"]*apps\/api/u],
  ['raw_error_output', /error\.(?:stack|message)|String\(error\)|JSON\.stringify\(error\)/u],
  ['silent_catch', /catch\s*\{\s*\}/u],
]);

export function findWebSourceBoundaryViolations(projectRoot) {
  const webRoot = path.join(projectRoot, 'apps/web/src');
  const files = walk(webRoot).filter((file) => productionFile.test(file) && !testFile.test(file));
  const violations = [];
  for (const file of files) {
    const relative = path.relative(projectRoot, file);
    const source = readFileSync(file, 'utf8');
    for (const [code, pattern] of globalRules) {
      if (pattern.test(source)) violations.push(`${code}:${relative}`);
    }
    if (/\/api\/(?:buyer-portal|seller-portal|staff\/)/u.test(source)
      && /\b(?:apiRequest|fetch|XMLHttpRequest)\b/u.test(source)
      && !/\b(?:identityApiRequest|withIdentity401Invalidation)\b/u.test(source)) {
      violations.push(`protected_transport_bypass:${relative}`);
    }
    if (relative.startsWith('apps/web/src/files/')
      && /(?:@ygb\/domain|packages\/domain)/u.test(source)) {
      violations.push(`web_domain_implementation_import:${relative}`);
    }
    if (relative.endsWith('/file-upload-transport.ts')
      && /setRequestHeader\(['"]Content-Type/iu.test(source)) {
      violations.push(`multipart_content_type_override:${relative}`);
    }
    if (relative.endsWith('/file-upload-operation.ts')
      && /\b(?:uploadToken|idempotencyKey)\b/u.test(source)) {
      violations.push(`upload_snapshot_private_material:${relative}`);
    }
    if (relative.endsWith('/file-read-operation.ts')
      && /\b(?:readToken|contentPath|objectUrl|bytes)\b/u.test(source)) {
      violations.push(`read_snapshot_private_material:${relative}`);
    }
    if (relative.includes('/auth/customer/') && /password/iu.test(relative)
      && /console\.|\bURLSearchParams\b/u.test(source)) {
      violations.push(`password_operation_exposure:${relative}`);
    }
  }
  return [...new Set(violations)].sort();
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  const projectRoot = path.resolve(import.meta.dirname, '..');
  const violations = findWebSourceBoundaryViolations(projectRoot);
  if (violations.length > 0) throw new Error(violations.join('\n'));
  console.log(JSON.stringify({
    status: 'PASS',
    boundary_rules: globalRules.length + 6,
    violations: 0,
    external_calls: 0,
  }, null, 2));
}
