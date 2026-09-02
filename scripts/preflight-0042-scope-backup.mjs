#!/usr/bin/env node
// DEFECT-003 自动化收口：0042 迁移在含 staff_marketplace_scopes 数据的环境会因 FK 拦截失败。
// 本脚本在生产/含数据环境部署 0042 前后运行：备份 scope 行 → （人工应用 0042）→ 恢复 scope 行。
// 用法：
//   node scripts/preflight-0042-scope-backup.mjs backup   # 部署前：导出 scope 行到 JSON
//   node scripts/preflight-0042-scope-backup.mjs restore  # 部署后：从 JSON 恢复 scope 行
// 仅适用于 wrangler d1 execute --remote（本地测试空库不需要此脚本）。
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKUP_FILE = path.join(root, 'backups', 'scope-rows-pre-0042.json');
const DB_NAME = process.env.D1_DATABASE_NAME ?? 'yueguangbai-v2-staging';
const CONFIG = process.env.WRANGLER_CONFIG ?? path.join(path.dirname(root), 'wrangler.staging.jsonc');

function d1(sql) {
  const result = execSync(
    `npx wrangler d1 execute ${DB_NAME} --remote --command "${sql.replace(/"/g, '\\"')}" --config "${CONFIG}" -y --json`,
    { cwd: root, encoding: 'utf8' },
  );
  return JSON.parse(result);
}

const mode = process.argv[2];
if (mode === 'backup') {
  const rows = d1('SELECT * FROM staff_marketplace_scopes');
  const data = rows?.[0]?.results ?? [];
  writeFileSync(BACKUP_FILE, JSON.stringify(data, null, 2));
  console.log(JSON.stringify({
    status: 'BACKED_UP',
    rows: data.length,
    file: BACKUP_FILE,
    note: '现在应用 0042 迁移，完成后运行 restore',
  }, null, 2));
} else if (mode === 'restore') {
  if (!existsSync(BACKUP_FILE)) {
    console.error(JSON.stringify({ status: 'ERROR', message: '备份文件不存在：' + BACKUP_FILE }));
    process.exit(1);
  }
  const data = JSON.parse(readFileSync(BACKUP_FILE, 'utf8'));
  if (data.length === 0) {
    console.log(JSON.stringify({ status: 'NOTHING_TO_RESTORE', rows: 0 }));
    process.exit(0);
  }
  for (const row of data) {
    const cols = Object.keys(row);
    const vals = cols.map(c => typeof row[c] === 'number' ? row[c] : `'${String(row[c]).replace(/'/g, "''")}'`);
    d1(`INSERT INTO staff_marketplace_scopes (${cols.join(',')}) VALUES (${vals.join(',')})`);
  }
  console.log(JSON.stringify({ status: 'RESTORED', rows: data.length }));
} else {
  console.error('用法: node scripts/preflight-0042-scope-backup.mjs backup|restore');
  process.exit(1);
}
