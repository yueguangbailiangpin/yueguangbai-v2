import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const bundle = await build({
  stdin: {
    contents: `
      import { anonymousSellerPartnerFixture } from ${JSON.stringify(
        path.resolve('tools/imports/seller-partner/fixtures/anonymous-fixture.ts'),
      )};
      import { previewSellerPartnerImport } from ${JSON.stringify(
        path.resolve('tools/imports/seller-partner/index.ts'),
      )};
      export { anonymousSellerPartnerFixture, previewSellerPartnerImport };
    `,
    resolveDir: process.cwd(),
    sourcefile: 'seller-partner-dry-run-entry.ts',
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
});
const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'seller-import-dry-run-'));
const temporaryModule = path.join(temporaryDirectory, 'entry.mjs');
writeFileSync(temporaryModule, bundle.outputFiles[0].text);
const { anonymousSellerPartnerFixture, previewSellerPartnerImport } =
  await import(pathToFileURL(temporaryModule).href);

const plan = await previewSellerPartnerImport(anonymousSellerPartnerFixture);
const exceptionCounts = {};
for (const record of plan.records) {
  if (record.exceptionCode) {
    exceptionCounts[record.exceptionCode] =
      (exceptionCounts[record.exceptionCode] ?? 0) + 1;
  }
}
console.log(JSON.stringify({
  status: 'LOCAL_DRY_RUN_ONLY',
  manifest_hash: plan.manifestHash,
  counts: plan.counts,
  exception_counts: exceptionCounts,
  external_calls: 0,
  database_writes: 0,
  tencent_docs_writes: 0,
  invitations_sent: 0,
}, null, 2));
rmSync(temporaryDirectory, { recursive: true, force: true });
