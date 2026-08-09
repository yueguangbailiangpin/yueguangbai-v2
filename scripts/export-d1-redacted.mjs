import { chmodSync, existsSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wranglerBinary = path.join(
  repositoryRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler',
);

const URL_PATTERN = /https?:\/\/[^\s"'<>]+/giu;
const CREDENTIAL_PATTERN = /((?:x-amz-[a-z-]+|x-goog-[a-z-]+|(?:access|refresh)_token|client_secret|authorization)\s*[=:]\s*)[^\s&"']+/giu;

export function redactProviderOutput(value) {
  return String(value)
    .replace(URL_PATTERN, '[REDACTED_URL]')
    .replace(CREDENTIAL_PATTERN, '$1[REDACTED]')
    .replace(/(Bearer\s+)[^\s"']+/giu, '$1[REDACTED]');
}

export function parseExportArgs(values) {
  const result = { config: null, database: null, mode: null, output: null };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value?.startsWith('--')) throw new Error('invalid_argument');
    const key = value.slice(2);
    if (key === 'remote' || key === 'local') {
      if (result.mode) throw new Error('exactly_one_export_mode_required');
      result.mode = key;
      continue;
    }
    const next = values[index + 1];
    if (!next || next.startsWith('--')) throw new Error(`missing_value:${key}`);
    if (key === 'config') result.config = path.resolve(next);
    else if (key === 'database') result.database = next;
    else if (key === 'output') result.output = path.resolve(next);
    else throw new Error(`unsupported_argument:${key}`);
    index += 1;
  }
  if (!result.mode) throw new Error('exactly_one_export_mode_required');
  if (!result.database) throw new Error('missing_argument:database');
  if (!result.output) throw new Error('missing_argument:output');
  return result;
}

export function buildWranglerArgs(input) {
  const args = ['d1', 'export', input.database, '--output', input.output, `--${input.mode}`,
    '--skip-confirmation'];
  if (input.config) args.unshift('--config', input.config);
  return args;
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..'
    && !path.isAbsolute(relative));
}

function validateOutputPath(output) {
  if (isWithin(repositoryRoot, output)) {
    throw new Error('export_output_inside_repository_forbidden');
  }
  if (existsSync(output)) throw new Error('export_output_exists');
  const parent = path.dirname(output);
  const parentStat = statSync(parent, { throwIfNoEntry: false });
  if (!parentStat?.isDirectory()) throw new Error('export_output_parent_missing');
  if ((parentStat.mode & 0o077) !== 0) throw new Error('export_output_parent_not_private');
}

export async function runRedactedExport(input, options = {}) {
  validateOutputPath(input.output);
  const executable = options.wranglerBinary ?? wranglerBinary;
  const child = spawn(executable, buildWranglerArgs(input), {
    cwd: repositoryRoot,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });

  const safeStdout = redactProviderOutput(stdout);
  const safeStderr = redactProviderOutput(stderr);
  if (safeStdout) process.stdout.write(safeStdout);
  if (safeStderr) process.stderr.write(safeStderr);
  if (result.code !== 0) {
    throw new Error(`wrangler_export_failed:${result.code ?? result.signal ?? 'unknown'}`);
  }
  const outputStat = statSync(input.output, { throwIfNoEntry: false });
  if (!outputStat?.isFile() || outputStat.size < 1) throw new Error('export_output_missing_or_empty');
  chmodSync(input.output, 0o600);
  return Object.freeze({ status: 'PASS', output_bytes: outputStat.size });
}

async function main() {
  try {
    const input = parseExportArgs(process.argv.slice(2));
    const result = await runRedactedExport(input);
    console.log(JSON.stringify({
      status: result.status,
      mode: input.mode,
      output_bytes: result.output_bytes,
      signed_urls: 'REDACTED_BEFORE_TERMINAL_OUTPUT',
    }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'export_failed');
    process.exitCode = 1;
  }
}

const invokedAsCli = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedAsCli) await main();
