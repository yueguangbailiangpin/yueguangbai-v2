import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(process.cwd(), 'apps/web/src');
const files = [];
function walk(directory) { for (const entry of readdirSync(directory, { withFileTypes: true })) { const path = join(directory, entry.name); if (entry.isDirectory()) walk(path); else if (/\.(ts|tsx|css)$/.test(entry.name) && !/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) files.push(path); } }
walk(root);
const source = files.map((file) => readFileSync(file, 'utf8')).join('\n');
const forbidden = [/\/api\/v2/, /document\.cookie/, /localStorage|sessionStorage/, /dangerouslySetInnerHTML/, /object_key/, /permanent_url/, /signed_url/, /from ['"].*apps\/api/, /redux|mobx/i, /Moonlight White|Moonlight|月光白 V2/];
for (const rule of forbidden) { if (rule.test(source)) throw new Error(`wave14a security violation: ${rule}`); }
for (const required of ['credentials: \'include\'', 'CUSTOMER_TRANSPORT_INVALIDATION_GROUP', 'clearStaffTransport', 'safeReturnPath', 'fileTransferReducer', "'/api/customer-auth/logout'", 'staffProviderOrigin', 'data.session']) { if (!source.includes(required)) throw new Error(`required Wave 14A boundary missing: ${required}`); }
const rootEntry = readFileSync(join(root, 'App.tsx'), 'utf8').match(/export function RootEntry\(\)[\s\S]*?\n}/)?.[0] ?? '';
for (const forbiddenRootControl of ['买家入口', '卖家入口', '员工入口', '<Link']) { if (rootEntry.includes(forbiddenRootControl)) throw new Error(`root dedicated-link violation: ${forbiddenRootControl}`); }
const browserFixtures = readFileSync(join(process.cwd(), 'apps/web/e2e/foundation.spec.ts'), 'utf8');
if (!browserFixtures.includes('data: { session }')) throw new Error('Playwright fixture must use data.session');
if (!existsSync(join(process.cwd(), 'apps/web/dist/index.html'))) process.stdout.write('Wave 14A source security verifier passed (build artifact not present).\n'); else process.stdout.write('Wave 14A source and build security verifier passed.\n');
