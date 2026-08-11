import { execFileSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import path from 'node:path';

const forbiddenTrackedFiles = new Set([
  '.dev.vars',
  '.env',
  '.env.local',
  'apps/api/.dev.vars',
  'apps/web/.env',
  'apps/web/.env.local',
]);

const patterns = [
  {
    label: 'OpenAI/DeepSeek API key',
    regex: /\bsk-[A-Za-z0-9_-]{20,}\b/gu,
  },
  {
    label: 'GitHub token',
    regex: /\b(?:ghp|gho|github_pat)_[A-Za-z0-9_]{20,}\b/gu,
  },
  {
    label: 'Google OAuth refresh token',
    regex: /\b1\/\/[A-Za-z0-9_-]{20,}\b/gu,
  },
  {
    label: 'literal secret assignment',
    regex: /\b(?:APP_SECRET|CLIENT_SECRET|REFRESH_TOKEN|API_KEY|ACCESS_TOKEN|ADMIN_SECRET|SESSION_SECRET)\b\s*[:=]\s*["'][^"'\n]{8,}["']/giu,
  },
];

const forbiddenLiterals = [
  ['9745', 'ba1f-1299-4342-b303-de7d4cf5c7df'].join(''),
  ['yueguangbai', '-images'].join(''),
];

const ignoredDirectories = new Set([
  '.git',
  '.wrangler',
  'node_modules',
  'dist',
  'coverage',
  '.vite',
  '.cache',
  'tmp',
  'temp',
]);

const ignoredExtensions = new Set([
  '.zip',
  '.gz',
  '.tgz',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.pdf',
  '.sqlite',
  '.db',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.mp4',
  '.mov',
  '.avi',
]);

function listProjectFiles() {
  try {
    return execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    ).split('\0').filter(Boolean);
  } catch {
    const files = [];
    const walk = (directory) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
        const absolute = path.join(directory, entry.name);
        const relative = path.relative(process.cwd(), absolute)
          .split(path.sep)
          .join('/');
        if (entry.isDirectory()) {
          walk(absolute);
        } else if (!ignoredExtensions.has(
          path.extname(entry.name).toLowerCase(),
        )) {
          files.push(relative);
        }
      }
    };
    walk(process.cwd());
    return files.sort();
  }
}

const projectFiles = listProjectFiles();
const projectFileSet = new Set(projectFiles);
const findings = [];

for (const file of forbiddenTrackedFiles) {
  if (projectFileSet.has(file)) {
    findings.push(`${file}: 不应提交本地密钥文件`);
  }
}

for (const file of projectFiles) {
  if (!existsSync(file)) continue;
  const stats = statSync(file);
  if (!stats.isFile() || stats.size > 2 * 1024 * 1024) continue;

  const bytes = readFileSync(file);
  if (bytes.includes(0)) continue;
  const content = bytes.toString('utf8');

  for (const literal of forbiddenLiterals) {
    if (content.includes(literal)) {
      findings.push(`${file}: 包含禁止迁入的旧资源标识`);
    }
  }

  for (const pattern of patterns) {
    if (
      pattern.label === 'literal secret assignment'
      && (file.startsWith('test/') || file.includes('.test.'))
    ) {
      continue;
    }

    pattern.regex.lastIndex = 0;
    let match;
    while ((match = pattern.regex.exec(content)) !== null) {
      const line = content.slice(0, match.index).split('\n').length;
      findings.push(`${file}:${line}: ${pattern.label}`);
    }
  }
}

if (findings.length > 0) {
  console.error('检测到疑似敏感信息或旧资源：');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(`敏感信息扫描通过（${projectFiles.length} 个项目文件）`);
