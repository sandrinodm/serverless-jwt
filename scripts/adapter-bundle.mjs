import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { build } from 'vite-plus';

/**
 * Freezes a core-only consumer and its normalized included-module graph for the public verifier
 * entry.
 */
const result = await build({
  configFile: false,
  logLevel: 'silent',
  build: {
    write: false,
    target: 'es2023',
    minify: true,
    lib: { entry: resolve('packages/jwt-verifier/dist/index.mjs'), formats: ['es'] },
  },
});
/**
 * Flattens all build outputs for a stable core consumer measurement.
 */
const outputs = (Array.isArray(result) ? result : [result]).flatMap((entry) => entry.output);
/**
 * Selects executable chunks, excluding assets and maps from the measurement.
 */
const chunks = outputs.filter((entry) => entry.type === 'chunk');
/**
 * Measures the combined minified executable output in deterministic chunk order.
 */
const code = chunks.map((entry) => entry.code).join('\n');
/**
 * Captures exact raw size, gzip size and normalized module graph for comparison.
 */
const snapshot = {
  bytes: Buffer.byteLength(code),
  gzipBytes: gzipSync(code, { level: 9 }).byteLength,
  modules: [
    ...new Set(
      chunks.flatMap((entry) =>
        Object.keys(entry.modules).map((name) =>
          name
            .replace(process.cwd(), '<root>')
            .replace(/node_modules\/\.pnpm\/[^/]+\/node_modules\//g, 'node_modules/'),
        ),
      ),
    ),
  ].sort(),
};
/**
 * Checks both the shipped size and included modules against the reviewed core bundle.
 */
const baseline = JSON.parse(
  readFileSync(new URL('./adapter-bundle-baseline.json', import.meta.url), 'utf8'),
);
assert.deepEqual(
  snapshot,
  baseline,
  'Core consumer size or module graph differs from the baseline',
);
console.log(JSON.stringify(snapshot));
