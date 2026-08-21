import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const manifestPath = args[args.indexOf('--manifest') + 1]
  || '/tmp/current-reservable-live-manifest.json';
const nowArgument = args[args.indexOf('--now') + 1];
const now = nowArgument ? Number(nowArgument) : Date.now();
if (!Number.isSafeInteger(now) || now < 0) throw new Error('INVALID_NOW');

const bundle = await build({
  stdin: {
    contents: `
      import { readLiveManifest, createStagingImportPlan, serializeStagingImportPlan } from ${JSON.stringify(
        path.resolve('tools/imports/current-product-seller-mapping/staging-import-plan.ts'),
      )};
      export { readLiveManifest, createStagingImportPlan, serializeStagingImportPlan };
    `,
    resolveDir: process.cwd(),
    sourcefile: 'staging-import-plan-entry.ts',
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
});
const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'staging-import-plan-'));
const temporaryModule = path.join(temporaryDirectory, 'entry.mjs');
writeFileSync(temporaryModule, bundle.outputFiles[0].text);
try {
  const {
    readLiveManifest,
    createStagingImportPlan,
    serializeStagingImportPlan,
  } = await import(pathToFileURL(temporaryModule).href);
  const manifest = await readLiveManifest(manifestPath);
  const plan = await createStagingImportPlan(manifest, { now });
  process.stdout.write(serializeStagingImportPlan(plan));
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
