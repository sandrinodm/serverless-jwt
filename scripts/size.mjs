import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { build } from 'vite-plus';

/**
 * Measures the minified core plus every used jose module, using Vite's bundled Rolldown.
 */
const bundle = await build({
  configFile: false,
  build: {
    target: 'es2023',
    write: false,
    minify: true,
    lib: {
      entry: resolve('packages/jwt-verifier/dist/index.mjs'),
      formats: ['es'],
      fileName: () => 'core.mjs',
    },
  },
});
/**
 * Collects emitted bundle chunks from either supported bundler result shape.
 */
const outputs = (Array.isArray(bundle) ? bundle : [bundle]).flatMap((entry) => entry.output);
/**
 * Combines emitted JavaScript bytes for the exact root-consumer size measurement.
 */
const code = outputs
  .filter((entry) => entry.type === 'chunk')
  .map((entry) => entry.code)
  .join('\n');
assert.ok(code.length > 0, 'No core bundle was measured');
/**
 * Measures the compressed consumer size using the fixed maximum gzip level.
 */
const gzipBytes = gzipSync(code, { level: 9 }).byteLength;
/**
 * Locates the checked-in size budget without depending on the caller working directory.
 */
const file = new URL('./size-budget.json', import.meta.url);
if (process.argv.includes('--record')) {
  writeFileSync(
    file,
    JSON.stringify(
      {
        baselineGzipBytes: gzipBytes,
        maxGzipBytes: Math.ceil(gzipBytes * 1.05),
        measuredOn: '2026-11-11',
        bundler: 'Vite+ 1.5.0 bundled Rolldown; ES2023; minify true; gzip level 9',
      },
      null,
      2,
    ) + '\n',
  );
}

/**
 * Loads the unchanged reviewed size ceiling for comparison with the current consumer bundle.
 */
const budget = JSON.parse(readFileSync(file, 'utf8'));
assert.ok(
  gzipBytes <= budget.maxGzipBytes,
  `Core gzip ${gzipBytes} exceeds ${budget.maxGzipBytes}`,
);
console.log(JSON.stringify({ gzipBytes, budget: budget.maxGzipBytes }));
