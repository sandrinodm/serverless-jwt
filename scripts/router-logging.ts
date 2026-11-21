import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Pinned original and candidate patched development-host bytes; no public artifact changes.
 */
const evidence = JSON.parse(
  readFileSync(new URL('../e2e/router-logging-patch.json', import.meta.url), 'utf8'),
);

/**
 * Asserts the exact development CLI version and its intentionally patched request-logger bytes.
 */
export function assertRouterLoggingPatch(application: string): void {
  const root = join(application, 'node_modules/@react-router/serve');
  assert.equal(
    JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
    evidence.version,
  );
  const hash = createHash('sha256')
    .update(readFileSync(join(root, evidence.file)))
    .digest('hex');
  assert.equal(hash, evidence.patchedSha256, 'Router CLI request-logger patch hash mismatch');
}

/**
 * Applies the same narrow reviewed development-only patch in npm consumers, which ignore pnpm
 * patches.
 */
export function applyRouterLoggingPatch(application: string): void {
  assert.equal(
    JSON.parse(
      readFileSync(join(application, 'node_modules/@react-router/serve/package.json'), 'utf8'),
    ).version,
    evidence.version,
  );
  const file = join(application, 'node_modules/@react-router/serve', evidence.file);
  const source = readFileSync(file, 'utf8');
  const hash = createHash('sha256').update(source).digest('hex');
  if (hash === evidence.patchedSha256) {
    assertRouterLoggingPatch(application);
    return;
  }

  assert.equal(hash, evidence.originalSha256, 'Refusing to patch unreviewed Router CLI bytes');
  const patched = source
    .replace('import morgan from "morgan";\n', '')
    .replace('\tapp.use(morgan("tiny"));\n', '');
  assert.equal(createHash('sha256').update(patched).digest('hex'), evidence.patchedSha256);
  writeFileSync(file, patched);
  assertRouterLoggingPatch(application);
}
