import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Pinned original and candidate patched development-host bytes; no public artifact changes.
 */
const evidence = JSON.parse(
  readFileSync(new URL('../e2e/netlify-logging-patch.json', import.meta.url), 'utf8'),
);

/**
 * Asserts the exact development CLI version and its intentionally patched request-logger bytes.
 */
export function assertNetlifyLoggingPatch(application: string): void {
  const root = join(application, 'node_modules/netlify-cli');
  assert.equal(
    JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
    evidence.version,
  );
  const hash = createHash('sha256')
    .update(readFileSync(join(root, evidence.file)))
    .digest('hex');
  assert.equal(hash, evidence.patchedSha256, 'Netlify CLI request-logger patch hash mismatch');
}

/**
 * Applies the same narrow reviewed development-only patch in npm consumers, which ignore pnpm
 * patches.
 */
export function applyNetlifyLoggingPatch(application: string): void {
  assert.equal(
    JSON.parse(readFileSync(join(application, 'node_modules/netlify-cli/package.json'), 'utf8'))
      .version,
    evidence.version,
  );
  const file = join(application, 'node_modules/netlify-cli', evidence.file);
  const source = readFileSync(file, 'utf8');
  const hash = createHash('sha256').update(source).digest('hex');
  if (hash === evidence.patchedSha256) {
    assertNetlifyLoggingPatch(application);
    return;
  }

  assert.equal(hash, evidence.originalSha256, 'Refusing to patch unreviewed Netlify CLI bytes');
  const patched = source
    .replace("import expressLogging from 'express-logging';\n", '')
    .replace(
      "    app.use(expressLogging(console, {\n        blacklist: ['/favicon.ico'],\n    }));\n",
      '',
    );
  assert.equal(createHash('sha256').update(patched).digest('hex'), evidence.patchedSha256);
  writeFileSync(file, patched);
  assertNetlifyLoggingPatch(application);
}
